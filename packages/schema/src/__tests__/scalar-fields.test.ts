// M2-03: the scalar field kinds `number`, `boolean`, `select` and `datetime` (spec §5.1, §5.2, §7.2).
import { describe, expect, it } from 'vitest';
import { fakeCtx } from './helpers.ts';
import {
  boolean,
  contentHash,
  datetime,
  defineType,
  extendType,
  generateDeliveryTypes,
  number,
  projectEntry,
  select,
  text,
  type AnyFieldKind,
} from '../index.ts';

const ok = (f: AnyFieldKind, v: unknown, mode: 'draft' | 'publish' = 'publish') =>
  (mode === 'draft' ? f.draftSchema() : f.publishSchema()).safeParse(v).success;

const SIZES = [
  { value: 'small', label: 'Lítið' },
  { value: 'large', label: 'Stórt' },
];

/** One required field of each kind: draft accepts it empty, publish refuses it. */
const requiredFields: Record<string, AnyFieldKind> = {
  number: number({ label: 'N', required: true }),
  boolean: boolean({ label: 'B', required: true }),
  select: select({ label: 'S', required: true, options: SIZES }),
  datetime: datetime({ label: 'D', required: true }),
};

describe.each(Object.entries(requiredFields))('%s: required', (kind, f) => {
  it('has its kind, label and required flag', () => {
    expect(f.kind).toBe(kind);
    expect(f.required).toBe(true);
  });
  it.each([null, undefined])('draft accepts an empty value (%s), publish refuses it', (v) => {
    expect(ok(f, v, 'draft')).toBe(true);
    expect(ok(f, v)).toBe(false);
  });
  it('withOptions keeps the kind and changes label and required', () => {
    const g = f.withOptions({ label: 'Nýtt', required: false });
    expect(g.kind).toBe(kind);
    expect(g.label).toBe('Nýtt');
    expect(ok(g, null)).toBe(true);
    expect(f.required).toBe(true);
  });
  it('projects an absent value as null', () => {
    expect(f.project(undefined, fakeCtx({}))).toBeNull();
    expect(f.project(null, fakeCtx({}))).toBeNull();
  });
});

describe.each([
  ['number', number({ label: 'N' })],
  ['boolean', boolean({ label: 'B' })],
  ['select', select({ label: 'S', options: SIZES })],
  ['datetime', datetime({ label: 'D' })],
] as const)('%s: optional', (_kind, f) => {
  it('publish accepts an empty value', () => {
    expect(ok(f, null)).toBe(true);
    expect(ok(f, undefined)).toBe(true);
  });
});

describe('number', () => {
  const plain = number({ label: 'N' });
  it('accepts finite numbers, including zero and negatives', () => {
    for (const v of [0, -3, 1.5, 1e6]) expect(ok(plain, v)).toBe(true);
  });
  it.each([['1'], [''], [true], [Number.NaN], [Number.POSITIVE_INFINITY], [{}], [[1]]])('refuses %s in draft and publish', (v) => {
    expect(ok(plain, v, 'draft')).toBe(false);
    expect(ok(plain, v)).toBe(false);
  });
  it('refuses values outside min and max, in draft and publish', () => {
    const f = number({ label: 'N', min: 1, max: 10 });
    for (const mode of ['draft', 'publish'] as const) {
      expect(ok(f, 1, mode)).toBe(true);
      expect(ok(f, 10, mode)).toBe(true);
      expect(ok(f, 0.99, mode)).toBe(false);
      expect(ok(f, 10.01, mode)).toBe(false);
    }
  });
  it('integer refuses fractions and unsafe integers', () => {
    const f = number({ label: 'N', integer: true });
    expect(ok(f, 4)).toBe(true);
    expect(ok(f, -4)).toBe(true);
    expect(ok(f, 4.5, 'draft')).toBe(false);
    expect(ok(f, 4.5)).toBe(false);
    expect(ok(f, 2 ** 53)).toBe(false);
  });
  it('exposes its options for the editor', () => {
    const f = number({ label: 'N', min: 0, max: 5, integer: true });
    expect([f.min, f.max, f.integer]).toEqual([0, 5, true]);
    expect([plain.min, plain.max, plain.integer]).toEqual([undefined, undefined, false]);
  });
  it('refuses inconsistent options at definition time', () => {
    expect(() => number({ label: 'N', min: 5, max: 1 })).toThrow(/min/);
    expect(() => number({ label: 'N', min: Number.NaN })).toThrow(/min/);
    expect(() => number({ label: 'N', max: Number.POSITIVE_INFINITY })).toThrow(/max/);
  });
  it('projects the stored number and has a number delivery type', () => {
    expect(plain.project(2.5, fakeCtx({}))).toBe(2.5);
    expect(plain.tsType()).toBe('number | null');
  });
  it('withOptions keeps min, max and integer', () => {
    const g = number({ label: 'N', min: 0, max: 5, integer: true }).withOptions({ required: true });
    expect([g.min, g.max, g.integer, g.required]).toEqual([0, 5, true, true]);
    expect(ok(g, 6)).toBe(false);
  });
});

describe('boolean', () => {
  const f = boolean({ label: 'B' });
  it('accepts true and false; a required boolean accepts false', () => {
    expect(ok(f, true)).toBe(true);
    expect(ok(f, false)).toBe(true);
    expect(ok(boolean({ label: 'B', required: true }), false)).toBe(true);
  });
  it.each([['true'], [0], [1], [''], [{}]])('refuses %s in draft and publish', (v) => {
    expect(ok(f, v, 'draft')).toBe(false);
    expect(ok(f, v)).toBe(false);
  });
  it('projects the stored value and has a boolean delivery type', () => {
    expect(f.project(false, fakeCtx({}))).toBe(false);
    expect(f.tsType()).toBe('boolean | null');
  });
});

describe('select', () => {
  const f = select({ label: 'S', options: SIZES });
  it('accepts only the listed values', () => {
    expect(ok(f, 'small')).toBe(true);
    expect(ok(f, 'large')).toBe(true);
    for (const mode of ['draft', 'publish'] as const) {
      expect(ok(f, 'medium', mode)).toBe(false);
      expect(ok(f, 'Small', mode)).toBe(false);
      expect(ok(f, '', mode)).toBe(false);
      expect(ok(f, 1, mode)).toBe(false);
      expect(ok(f, ['small'], mode)).toBe(false);
    }
  });
  it('refuses a value that is only a label', () => {
    expect(ok(f, 'Lítið')).toBe(false);
  });
  it('exposes a copy of its options for the editor', () => {
    expect(f.options).toEqual(SIZES);
    expect(f.options).not.toBe(SIZES);
    expect(Object.isFrozen(f.options)).toBe(true);
  });
  it('refuses an empty list, duplicate or empty values, and empty labels at definition time', () => {
    expect(() => select({ label: 'S', options: [] })).toThrow(/at least one/);
    expect(() => select({ label: 'S', options: [SIZES[0]!, { value: 'small', label: 'Annað' }] })).toThrow(/duplicate value "small"/);
    expect(() => select({ label: 'S', options: [{ value: '', label: 'Tómt' }] })).toThrow(/empty value/);
    expect(() => select({ label: 'S', options: [{ value: 'x', label: '' }] })).toThrow(/empty label/);
  });
  it('projects the stored value', () => {
    expect(f.project('large', fakeCtx({}))).toBe('large');
  });
  it('has a delivery type that is the union of its values', () => {
    expect(f.tsType()).toBe('"small" | "large" | null');
    expect(select({ label: 'S', options: [{ value: `it's "q"`, label: 'Q' }] }).tsType()).toBe(`"it's \\"q\\"" | null`);
  });
  it('withOptions keeps the options', () => {
    const g = f.withOptions({ label: 'Stærð', required: true });
    expect(g.options).toEqual(SIZES);
    expect(ok(g, 'medium')).toBe(false);
    expect(ok(g, null)).toBe(false);
  });
});

describe('datetime', () => {
  const f = datetime({ label: 'D' });
  it.each([
    '2026-12-01T18:30Z',
    '2026-12-01T18:30:00Z',
    '2026-12-01T18:30:00.123Z',
    '2026-12-01T18:30:00+00:00',
    '2026-12-01T00:00:00-05:30',
    '2024-02-29T23:59:59+14:00',
  ])('accepts %s', (v) => {
    expect(ok(f, v, 'draft')).toBe(true);
    expect(ok(f, v)).toBe(true);
  });
  it.each([
    ['no offset', '2026-12-01T18:30:00'],
    ['a date only', '2026-12-01'],
    ['a space for T', '2026-12-01 18:30:00Z'],
    ['lower-case z', '2026-12-01T18:30:00z'],
    ['an impossible date', '2025-02-29T10:00:00Z'],
    ['hour 24', '2026-12-01T24:00:00Z'],
    ['minute 60', '2026-12-01T18:60:00Z'],
    ['second 60', '2026-12-01T18:30:60Z'],
    ['an offset hour of 24', '2026-12-01T18:30:00+24:00'],
    ['an offset without a colon', '2026-12-01T18:30:00+0000'],
    ['an offset minute of 60', '2026-12-01T18:30:00+01:60'],
    ['more than millisecond precision', '2026-12-01T18:30:00.1234Z'],
    ['an empty string', ''],
    ['surrounding whitespace', ' 2026-12-01T18:30:00Z'],
  ])('refuses %s in draft and publish', (_what, v) => {
    expect(ok(f, v, 'draft')).toBe(false);
    expect(ok(f, v)).toBe(false);
  });
  it('refuses a non-string (a Date or a timestamp number)', () => {
    expect(ok(f, new Date())).toBe(false);
    expect(ok(f, 1_764_614_400_000)).toBe(false);
  });
  it('stores and projects the string as written, offset kept', () => {
    expect(f.publishSchema().parse('2026-12-01T18:30:00-05:30')).toBe('2026-12-01T18:30:00-05:30');
    expect(f.project('2026-12-01T18:30:00-05:30', fakeCtx({}))).toBe('2026-12-01T18:30:00-05:30');
    expect(f.tsType()).toBe('string | null');
  });
});

describe('scalar kinds in a type', () => {
  const t = defineType({
    name: 'concert',
    version: 1,
    label: 'Tónleikar',
    fields: {
      title: text({ label: 'Titill', required: true }),
      seats: number({ label: 'Sæti', min: 0, integer: true }),
      free: boolean({ label: 'Ókeypis' }),
      size: select({ label: 'Stærð', options: SIZES, required: true }),
      doors: datetime({ label: 'Húsið opnar', required: true }),
    },
    preview: { title: 'title' },
    orderBy: 'doors',
  });
  const data = { title: 'Jól', seats: 120, free: false, size: 'large', doors: '2026-12-01T19:00:00Z' };

  it('draft accepts an empty entry and publish names the required scalar fields', () => {
    expect(t.draftValidator().safeParse({}).success).toBe(true);
    const r = t.publishValidator().safeParse({ title: 'x' });
    expect(r.success ? [] : r.error.issues.map((i) => i.path[0]).sort()).toEqual(['doors', 'size']);
  });
  it('a draft with a wrong-typed scalar is refused', () => {
    expect(t.draftValidator().safeParse({ seats: '12' }).success).toBe(false);
    expect(t.draftValidator().safeParse({ free: 'no' }).success).toBe(false);
  });
  it('projects every scalar, with false and 0 kept and absent fields null', () => {
    const out = projectEntry(t, { ...data, seats: 0, junk: 1 }, fakeCtx({}));
    expect(out).toEqual({ title: 'Jól', seats: 0, free: false, size: 'large', doors: '2026-12-01T19:00:00Z' });
    expect(projectEntry(t, { title: 'Jól', size: 'small', doors: data.doors }, fakeCtx({}))).toEqual({
      title: 'Jól',
      seats: null,
      free: null,
      size: 'small',
      doors: data.doors,
    });
  });
  it('contentHash of the projection is stable under key order, and changes with any scalar', () => {
    const reversed = Object.fromEntries(Object.entries(data).reverse());
    const h = contentHash(projectEntry(t, data, fakeCtx({})));
    expect(contentHash(projectEntry(t, reversed, fakeCtx({})))).toBe(h);
    expect(contentHash(projectEntry(t, { ...data, free: true }, fakeCtx({})))).not.toBe(h);
    expect(contentHash(projectEntry(t, { ...data, seats: 121 }, fakeCtx({})))).not.toBe(h);
    expect(contentHash(projectEntry(t, { ...data, size: 'small' }, fakeCtx({})))).not.toBe(h);
    expect(contentHash(projectEntry(t, { ...data, doors: '2026-12-01T19:00:00+01:00' }, fakeCtx({})))).not.toBe(h);
  });
  it('the sort column takes a datetime orderBy value', () => {
    expect(t.queryColumns(data)).toEqual({ title: 'Jól', sortAt: '2026-12-01T19:00:00Z' });
  });
  it('extendType overrides work on the scalar kinds', () => {
    const ext = extendType(t, { fieldOverrides: { size: { required: false }, doors: { label: 'Opnun', required: false } } });
    expect(ext.fields.doors?.label).toBe('Opnun');
    expect(ext.publishValidator().safeParse({ title: 'x' }).success).toBe(true);
  });
  it('generates delivery types for each scalar kind', () => {
    const out = generateDeliveryTypes([t]);
    expect(out).toContain('export interface ConcertEntry {');
    expect(out).toContain('  seats: number | null;');
    expect(out).toContain('  free: boolean | null;');
    expect(out).toContain('  size: "small" | "large" | null;');
    expect(out).toContain('  doors: string | null;');
  });
});
