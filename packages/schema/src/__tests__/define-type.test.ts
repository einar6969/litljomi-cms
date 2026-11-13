import { describe, expect, it } from 'vitest';
import { date, datetime, defineType, extendType, image, isManuallyOrdered, link, MANUAL_ORDER, text } from '../index.ts';

const t = defineType({
  name: 't',
  version: 1,
  label: 'T',
  fields: { title: text({ label: 'Titill', required: true, max: 5 }) },
  preview: { title: 'title' },
  orderBy: 'title',
});

describe('defineType', () => {
  it('draft validator accepts empty required fields; publish validator rejects them', () => {
    expect(t.draftValidator().safeParse({}).success).toBe(true);
    expect(t.publishValidator().safeParse({}).success).toBe(false);
    expect(t.publishValidator().safeParse({ title: 'abcdef' }).success).toBe(false);
    expect(t.publishValidator().safeParse({ title: 'abc' }).success).toBe(true);
  });

  it('still checks types and limits on draft', () => {
    expect(t.draftValidator().safeParse({ title: 5 }).success).toBe(false);
    expect(t.draftValidator().safeParse({ title: 'abcdef' }).success).toBe(false);
    expect(t.draftValidator().safeParse({ title: null }).success).toBe(true);
  });

  it('strips unknown keys on draft parse', () => {
    expect(t.draftValidator().parse({ title: 'a', junk: 1 })).toEqual({ title: 'a' });
  });

  it('maps title and sort_at columns', () => {
    const n = defineType({
      name: 'n',
      version: 1,
      label: 'N',
      fields: { title: text({ label: 'T' }), when: date({ label: 'D' }) },
      preview: { title: 'title' },
      orderBy: 'when',
    });
    expect(n.queryColumns({ title: 'Hæ', when: '2025-01-02' })).toEqual({ title: 'Hæ', sortAt: '2025-01-02' });
    expect(n.queryColumns({})).toEqual({ title: null, sortAt: null });
    expect(n.queryColumns(null)).toEqual({ title: null, sortAt: null });
  });

  it("cuts a title at the column's 500 characters, so a long heading is not refused on every save", () => {
    const n = defineType({ name: 'n', version: 1, label: 'N', fields: { title: text({ label: 'T' }) }, preview: { title: 'title' }, orderBy: 'title' });
    expect(n.queryColumns({ title: 'a'.repeat(500) }).title).toBe('a'.repeat(500));
    expect(n.queryColumns({ title: 'a'.repeat(501) }).title).toBe('a'.repeat(500));
    // Characters as the database counts them: an emoji is one, and is never split.
    expect(n.queryColumns({ title: '😀'.repeat(501) }).title).toBe('😀'.repeat(500));
  });

  it('promotes sort_at (a timestamp column) only from a date or datetime field: a type ordered by a text field saves none', () => {
    const byTitle = defineType({ name: 'n', version: 1, label: 'N', fields: { title: text({ label: 'T' }) }, preview: { title: 'title' }, orderBy: 'title' });
    expect(byTitle.queryColumns({ title: 'Lokað á morgun' })).toEqual({ title: 'Lokað á morgun', sortAt: null });
    const byDateTime = defineType({ name: 'n', version: 1, label: 'N', fields: { title: text({ label: 'T' }), at: datetime({ label: 'D' }) }, preview: { title: 'title' }, orderBy: 'at' });
    expect(byDateTime.queryColumns({ at: '2025-01-02T10:00:00Z' }).sortAt).toBe('2025-01-02T10:00:00Z');
  });
});

// A12: a type whose entries editors put in order (spec §5.1). The order is not in the document, so
// sort_at stays null and nothing else about the type changes.
describe("defineType with orderBy: 'manual'", () => {
  const manual = defineType({
    name: 'partner',
    version: 1,
    label: 'Partner',
    fields: { title: text({ label: 'T' }), since: date({ label: 'D' }) },
    preview: { title: 'title' },
    orderBy: 'manual',
  });

  it('is manually ordered; a type ordered by a field is not', () => {
    expect(manual.orderBy).toBe(MANUAL_ORDER);
    expect(isManuallyOrdered(manual)).toBe(true);
    expect(isManuallyOrdered(t)).toBe(false);
  });

  it('promotes the title and no sort_at, even with a date field in the document', () => {
    expect(manual.queryColumns({ title: 'Samstarf', since: '2025-01-02' })).toEqual({ title: 'Samstarf', sortAt: null });
  });

  it('keeps its validators: the order is not a field', () => {
    expect(manual.draftValidator().parse({ title: 'a', manual: 1 })).toEqual({ title: 'a' });
    expect(manual.publishValidator().safeParse({ title: 'a' }).success).toBe(true);
  });

  it("refuses a field named 'manual' when the type is ordered manually, so orderBy can mean only one thing", () => {
    expect(() =>
      defineType({ name: 'x', version: 1, label: 'X', fields: { title: text({ label: 'T' }), manual: text({ label: 'M' }) }, preview: { title: 'title' }, orderBy: 'manual' }),
    ).toThrow(/manual/);
    // A field called manual is still fine on a type ordered by another field.
    expect(() =>
      defineType({ name: 'x', version: 1, label: 'X', fields: { title: text({ label: 'T' }), manual: text({ label: 'M' }) }, preview: { title: 'title' }, orderBy: 'title' }),
    ).not.toThrow();
  });

  it('extendType keeps the manual order', () => {
    const extended = extendType(manual, { label: 'Samstarfsaðili' });
    expect(isManuallyOrdered(extended)).toBe(true);
    expect(() => extendType(manual, { extraFields: { manual: text({ label: 'M' }) } })).toThrow(/manual/);
  });
});

describe('extendType', () => {
  it('overrides labels and adds fields without changing the base', () => {
    const ext = extendType(t, {
      label: 'T2',
      fieldOverrides: { title: { label: 'Fyrirsögn', required: false } },
      extraFields: { note: text({ label: 'Athugasemd', multiline: true }) },
    });
    expect(ext.label).toBe('T2');
    expect(ext.fields.title?.label).toBe('Fyrirsögn');
    expect(Object.keys(ext.fields)).toEqual(['title', 'note']);
    expect(ext.publishValidator().safeParse({}).success).toBe(true);
    expect(ext.publishValidator().safeParse({ title: 'abcdef' }).success).toBe(false);

    expect(t.label).toBe('T');
    expect(t.fields.title.label).toBe('Titill');
    expect(Object.keys(t.fields)).toEqual(['title']);
    expect(t.publishValidator().safeParse({}).success).toBe(false);
  });

  it('rejects unknown overrides and duplicate extra fields', () => {
    expect(() => extendType(t, { fieldOverrides: { nope: { label: 'x' } } })).toThrow();
    expect(() => extendType(t, { extraFields: { title: link({ label: 'x' }) } })).toThrow();
  });
});

describe('type metadata', () => {
  const A = '11111111-1111-4111-8111-111111111111';
  const withMedia = defineType({
    name: 'm',
    version: 3,
    label: 'M',
    fields: { title: text({ label: 'T' }), pic: image({ label: 'I' }), when: date({ label: 'D' }) },
    preview: { title: 'title', media: 'pic' },
    orderBy: 'when',
    transforms: { 2: (d) => ({ ...(d as object), upgraded: true }) },
  });

  it('keeps preview.media', () => {
    expect(withMedia.preview).toEqual({ title: 'title', media: 'pic' });
    expect(withMedia.draftValidator().safeParse({ pic: { _ref: A, _kind: 'asset', alt: '' } }).success).toBe(true);
  });

  it('extendType keeps name, version, preview, orderBy and transforms', () => {
    const ext = extendType(withMedia, { label: 'M2', fieldOverrides: { pic: { label: 'Mynd' } } });
    expect(ext.name).toBe('m');
    expect(ext.version).toBe(3);
    expect(ext.preview).toEqual({ title: 'title', media: 'pic' });
    expect(ext.orderBy).toBe('when');
    expect(ext.transforms).toBe(withMedia.transforms);
    expect(ext.transforms?.[2]?.({})).toEqual({ upgraded: true });
  });

  it('draft date rejects the empty string (empty is stored as null)', () => {
    expect(withMedia.draftValidator().safeParse({ when: '' }).success).toBe(false);
    expect(withMedia.draftValidator().safeParse({ when: null }).success).toBe(true);
  });
});

describe('defineType field keys', () => {
  const build = (fields: Record<string, ReturnType<typeof text>>) =>
    defineType({ name: 'k', version: 1, label: 'K', fields, preview: { title: 'title' }, orderBy: 'title' });
  const ok = { title: text({ label: 'T' }) };

  it.each(['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty'])('rejects the reserved key %s', (key) => {
    expect(() => build(Object.defineProperty({ ...ok }, key, { value: text({ label: 'X' }), enumerable: true }))).toThrow(/field key/);
  });
  it.each(['', '1a', 'a b', 'a-b', 'a.b', '_a', 'a$', 'é', 'a\n'])('rejects the non-identifier key %j', (key) => {
    expect(() => build({ ...ok, [key]: text({ label: 'X' }) })).toThrow(/field key/);
  });
  it('caps keys at 64 characters, as the database does (decision 29)', () => {
    expect(() => build({ ...ok, ['a'.repeat(64)]: text({ label: 'X' }) })).not.toThrow();
    expect(() => build({ ...ok, ['a'.repeat(65)]: text({ label: 'X' }) })).toThrow(/field key/);
  });
  it.each(['title', 'secondaryImage', 'a1', 'snake_case', 'A'])('accepts the key %s', (key) => {
    expect(() => build({ ...ok, [key]: text({ label: 'X' }) })).not.toThrow();
  });
  it('rejects a fields object whose prototype is set, such as a literal __proto__ key', () => {
    const inherited = { extra: text({ label: 'X' }) };
    expect(() =>
      defineType({ name: 'p', version: 1, label: 'P', fields: { __proto__: inherited as never, title: text({ label: 'T' }) }, preview: { title: 'title' }, orderBy: 'title' }),
    ).toThrow(/prototype/);
    expect(() =>
      defineType({ name: 'p', version: 1, label: 'P', fields: Object.create({ extra: text({ label: 'X' }) }), preview: { title: 'title' }, orderBy: 'title' } as never),
    ).toThrow(/prototype/);
  });
  it('accepts a null-prototype fields object', () => {
    const fields = Object.assign(Object.create(null), { title: text({ label: 'T' }) });
    expect(() => defineType({ name: 'p', version: 1, label: 'P', fields, preview: { title: 'title' }, orderBy: 'title' })).not.toThrow();
  });
});
