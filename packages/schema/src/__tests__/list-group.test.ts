import { describe, expect, it } from 'vitest';
import { fakeCtx } from './helpers.ts';
import {
  ProjectionError,
  defineType,
  entryContentHash,
  extendType,
  generateDeliveryTypes,
  group,
  image,
  list,
  newItemKey,
  number,
  projectEntry,
  reference,
  richText,
  select,
  text,
  type EntrySummary,
  type PublicAsset,
} from '../index.ts';

const A = '11111111-1111-4111-8111-111111111111';
const B = '33333333-3333-4333-8333-333333333333';
const E = '22222222-2222-4222-8222-222222222222';
const F = '44444444-4444-4444-8444-444444444444';

const asset = (id: string, o: Partial<PublicAsset> = {}): PublicAsset => ({
  id,
  url: `https://cdn.example.is/${id}.jpg`,
  width: 800,
  height: 600,
  mime: 'image/jpeg',
  alt: 'Sjálfgefið',
  focal: null,
  caption: null,
  credit: null,
  ...o,
});
const summary = (id: string, o: Partial<EntrySummary> = {}): EntrySummary => ({
  id,
  type: 'event',
  slug: `s-${id.slice(0, 4)}`,
  title: `Titill ${id.slice(0, 4)}`,
  path: `/events/s-${id.slice(0, 4)}`,
  ...o,
});

const img = (id: string, alt = 'Mynd') => ({ _ref: id, _kind: 'asset', alt });
const ref = (id: string) => ({ _ref: id, _kind: 'entry' });

// A list of group of image and reference (the plan's nesting case), plus a list of plain text and
// a group that holds a list.
const slide = group({
  label: 'Skyggna',
  fields: {
    caption: text({ label: 'Texti', required: true }),
    picture: image({ label: 'Mynd', required: true }),
    link: reference({ label: 'Tengill', to: ['event'] }),
  },
});
const t = defineType({
  name: 'page',
  version: 1,
  label: 'Síða',
  fields: {
    title: text({ label: 'Titill', required: true }),
    slides: list(slide, { label: 'Skyggnur', max: 5 }),
    tags: list(text({ label: 'Merki' }), { label: 'Merki' }),
    info: group({
      label: 'Upplýsingar',
      fields: {
        phone: text({ label: 'Sími' }),
        related: list(reference({ label: 'Tengt', to: ['event'] }), { label: 'Tengt' }),
      },
    }),
  },
  preview: { title: 'title' },
  orderBy: 'title',
});

const data = {
  title: 'Forsíða',
  slides: [
    { _key: 'k1', value: { caption: 'Fyrsta', picture: img(A), link: ref(E) } },
    { _key: 'k2', value: { caption: 'Önnur', picture: img(B, ''), link: null } },
  ],
  tags: [
    { _key: 't1', value: 'a' },
    { _key: 't2', value: 'b' },
  ],
  info: { phone: '555 1234', related: [{ _key: 'r1', value: ref(F) }] },
};
const ctx = fakeCtx({
  assets: { [A]: asset(A), [B]: asset(B, { focal: { x: 0.2, y: 0.8 } }) },
  entries: { [E]: summary(E), [F]: summary(F) },
});
const issuesOf = (r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) => (r.success ? [] : r.error!.issues.map((i) => i.path));

describe('group: definition', () => {
  it('exposes its kind, label, required flag and a frozen copy of its fields', () => {
    const fields = { a: text({ label: 'A' }) };
    const g = group({ label: 'G', fields });
    expect(g).toMatchObject({ kind: 'group', label: 'G', required: false });
    expect(Object.keys(g.fields)).toEqual(['a']);
    (fields as Record<string, unknown>).b = text({ label: 'B' });
    expect(Object.keys(g.fields)).toEqual(['a']);
    expect(Object.isFrozen(g.fields)).toBe(true);
  });
  it('refuses no fields, invalid keys and a non-plain fields object', () => {
    expect(() => group({ label: 'G', fields: {} })).toThrow(/at least one field/);
    expect(() => group({ label: 'G', fields: { 'a-b': text({ label: 'A' }) } })).toThrow(/^group: invalid field key "a-b"/);
    expect(() => group({ label: 'G', fields: { _key: text({ label: 'A' }) } })).toThrow(/invalid field key/);
    expect(() => group({ label: 'G', fields: { constructor: text({ label: 'A' }) } })).toThrow(/invalid field key/);
    expect(() => group({ label: 'G', fields: Object.create({ x: 1 }) as Record<string, never> })).toThrow(/plain object/);
  });
  it('withOptions keeps the kind and fields and changes label and required', () => {
    const g = slide.withOptions({ label: 'S', required: true });
    expect(g).toMatchObject({ kind: 'group', label: 'S', required: true });
    expect(g.fields).toEqual(slide.fields);
    const u = extendType(t, { fieldOverrides: { info: { required: true } } });
    expect(u.fields.info).toMatchObject({ kind: 'group', required: true });
  });
});

describe('list: definition', () => {
  it('exposes its kind, label, item kind and bounds', () => {
    const l = list(text({ label: 'X' }), { label: 'L', min: 1, max: 3 });
    expect(l).toMatchObject({ kind: 'list', label: 'L', required: false, min: 1, max: 3 });
    expect(l.of.kind).toBe('text');
  });
  it('refuses bounds that are negative, fractional or crossed', () => {
    expect(() => list(text({ label: 'X' }), { label: 'L', min: -1 })).toThrow(/min/);
    expect(() => list(text({ label: 'X' }), { label: 'L', max: 1.5 })).toThrow(/max/);
    expect(() => list(text({ label: 'X' }), { label: 'L', min: 3, max: 2 })).toThrow(/greater than max/);
  });
  it('withOptions keeps the item kind and bounds', () => {
    const l = list(text({ label: 'X' }), { label: 'L', max: 2 }).withOptions({ required: true });
    expect(l).toMatchObject({ kind: 'list', label: 'L', required: true, max: 2 });
    expect(l.publishSchema().safeParse([]).success).toBe(false);
  });
  it('newItemKey gives distinct keys that the validator accepts', () => {
    const keys = Array.from({ length: 50 }, () => newItemKey());
    expect(new Set(keys).size).toBe(50);
    const l = list(text({ label: 'X' }), { label: 'L' });
    expect(l.publishSchema().safeParse(keys.map((_key) => ({ _key, value: 'x' }))).success).toBe(true);
  });
});

describe('list and group: validation', () => {
  it('accepts the nested document in drafts and on publish', () => {
    expect(t.draftValidator().safeParse(data).success).toBe(true);
    expect(t.publishValidator().safeParse(data).success).toBe(true);
  });
  it('drafts accept empty required values at any depth; publish refuses them, pointing at the item', () => {
    const partial = { title: 'X', slides: [{ _key: 'k1', value: { caption: '' } }, { _key: 'k2', value: null }] };
    expect(t.draftValidator().safeParse(partial).success).toBe(true);
    const paths = issuesOf(t.publishValidator().safeParse(partial));
    expect(paths).toContainEqual(['slides', 0, 'value', 'caption']);
    expect(paths).toContainEqual(['slides', 0, 'value', 'picture']);
    expect(paths).toContainEqual(['slides', 1, 'value']);
  });
  it('checks the nested kinds in drafts too (wrong type, malformed reference)', () => {
    const bad = { slides: [{ _key: 'k1', value: { caption: 42, link: { _ref: 'nope', _kind: 'entry' } } }] };
    const paths = issuesOf(t.draftValidator().safeParse(bad));
    expect(paths).toContainEqual(['slides', 0, 'value', 'caption']);
    expect(paths).toContainEqual(['slides', 0, 'value', 'link', '_ref']);
  });
  it('requires a valid, unique item key, in drafts too', () => {
    for (const items of [
      [{ value: 'a' }],
      [{ _key: '', value: 'a' }],
      [{ _key: 'a b', value: 'a' }],
      [{ _key: 'x'.repeat(65), value: 'a' }],
      [{ _key: 7, value: 'a' }],
      [
        { _key: 'same', value: 'a' },
        { _key: 'same', value: 'b' },
      ],
      'a',
      { _key: 'k', value: 'a' },
    ]) {
      expect(t.draftValidator().safeParse({ tags: items }).success, JSON.stringify(items)).toBe(false);
      expect(t.publishValidator().safeParse({ title: 'X', tags: items }).success, JSON.stringify(items)).toBe(false);
    }
    const dup = t.draftValidator().safeParse({ tags: [{ _key: 'same', value: 'a' }, { _key: 'same', value: 'b' }] });
    expect(issuesOf(dup)).toEqual([['tags', 1, '_key']]);
  });
  it('max applies to drafts and publish; min and required only on publish', () => {
    const l = list(text({ label: 'X' }), { label: 'L', min: 2, max: 3 });
    const items = (n: number) => Array.from({ length: n }, (_, i) => ({ _key: `k${i}`, value: 'x' }));
    expect(l.draftSchema().safeParse(items(1)).success).toBe(true);
    expect(l.draftSchema().safeParse(items(4)).success).toBe(false);
    expect(l.publishSchema().safeParse(items(1)).success).toBe(false);
    expect(l.publishSchema().safeParse(items(2)).success).toBe(true);
    expect(l.publishSchema().safeParse(items(4)).success).toBe(false);
    expect(l.publishSchema().safeParse(null).success).toBe(true);
    const req = list(text({ label: 'X' }), { label: 'L', required: true });
    expect(req.draftSchema().safeParse([]).success).toBe(true);
    expect(req.draftSchema().safeParse(undefined).success).toBe(true);
    expect(req.publishSchema().safeParse([]).success).toBe(false);
    expect(req.publishSchema().safeParse(null).success).toBe(false);
    expect(req.publishSchema().safeParse(items(1)).success).toBe(true);
  });
  it('an absent optional group is not looked into; a present one enforces its required fields', () => {
    const g = group({ label: 'G', fields: { a: text({ label: 'A', required: true }) } });
    expect(g.publishSchema().safeParse(null).success).toBe(true);
    expect(g.publishSchema().safeParse({}).success).toBe(false);
    expect(g.withOptions({ required: true }).publishSchema().safeParse(null).success).toBe(false);
    expect(g.draftSchema().safeParse({}).success).toBe(true);
  });
  it('strips unknown keys inside groups and items, as at the top level', () => {
    const parsed = t.draftValidator().parse({ info: { phone: '1', extra: 'x' }, tags: [{ _key: 'k', value: 'a', extra: 1 }] });
    expect(parsed).toEqual({ info: { phone: '1' }, tags: [{ _key: 'k', value: 'a' }] });
  });
  it('on publish every item holds a value, even when the item kind is optional', () => {
    const empty = { title: 'X', tags: [{ _key: 't1', value: 'a' }, { _key: 't2', value: null }, { _key: 't3' }] };
    expect(t.draftValidator().safeParse(empty).success).toBe(true);
    expect(issuesOf(t.publishValidator().safeParse(empty))).toEqual([
      ['tags', 1, 'value'],
      ['tags', 2, 'value'],
    ]);
  });
  it('a list can hold any kind, lists of lists included', () => {
    const grid = list(list(number({ label: 'N', integer: true }), { label: 'Röð', max: 2 }), { label: 'Tafla' });
    const ok = [{ _key: 'r1', value: [{ _key: 'c1', value: 1 }, { _key: 'c2', value: 2 }] }];
    expect(grid.publishSchema().safeParse(ok).success).toBe(true);
    const bad = [{ _key: 'r1', value: [{ _key: 'c1', value: 1.5 }] }];
    expect(issuesOf(grid.publishSchema().safeParse(bad))).toEqual([[0, 'value', 0, 'value']]);
  });
});

describe('list and group: projection', () => {
  it('resolves images and references inside lists and groups like top-level ones, keeping item keys', () => {
    expect(projectEntry(t, data, ctx)).toEqual({
      title: 'Forsíða',
      slides: [
        { _key: 'k1', value: { caption: 'Fyrsta', picture: { ...asset(A), alt: 'Mynd' }, link: summary(E) } },
        { _key: 'k2', value: { caption: 'Önnur', picture: { ...asset(B, { focal: { x: 0.2, y: 0.8 } }), alt: '' }, link: null } },
      ],
      tags: [
        { _key: 't1', value: 'a' },
        { _key: 't2', value: 'b' },
      ],
      info: { phone: '555 1234', related: [{ _key: 'r1', value: summary(F) }] },
    });
  });
  it('a reference or image that cannot resolve projects as null in its item; the item stays', () => {
    const out = projectEntry(t, data, fakeCtx({ assets: { [A]: asset(A) }, entries: {} }));
    const slides = out.slides as { _key: string; value: Record<string, unknown> }[];
    expect(slides.map((s) => s._key)).toEqual(['k1', 'k2']);
    expect(slides[0]!.value.link).toBeNull();
    expect(slides[1]!.value.picture).toBeNull();
    expect(out.info).toEqual({ phone: '555 1234', related: [{ _key: 'r1', value: null }] });
  });
  it('absent lists, groups and nested fields project as null', () => {
    expect(projectEntry(t, { title: 'X' }, ctx)).toEqual({ title: 'X', slides: null, tags: null, info: null });
    expect(projectEntry(t, { title: 'X', info: {} }, ctx).info).toEqual({ phone: null, related: null });
  });
  it('rich text inside a list is projected by the rich-text kind', () => {
    const u = defineType({
      name: 'faq',
      version: 1,
      label: 'F',
      fields: { title: text({ label: 'T' }), answers: list(richText({ label: 'Svar' }), { label: 'Svör' }) },
      preview: { title: 'title' },
      orderBy: 'title',
    });
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Já.' }] }] };
    const out = projectEntry(u, { answers: [{ _key: 'a', value: doc }] }, ctx);
    expect((out.answers as { value: unknown }[])[0]!.value).toMatchObject({ type: 'doc' });
  });
  it('a reference of the wrong type deep inside is refused with its full path', () => {
    const wrong = fakeCtx({ assets: { [A]: asset(A), [B]: asset(B) }, entries: { [E]: summary(E, { type: 'news' }), [F]: summary(F) } });
    let error: unknown;
    try {
      projectEntry(t, data, wrong);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ProjectionError);
    expect((error as ProjectionError).issues).toHaveLength(1);
    expect((error as ProjectionError).issues[0]).toMatchObject({ code: 'custom', path: ['slides', 0, 'value', 'link', '_ref'] });
    expect((error as Error).message).toMatch(/^cannot project page: slides\.0\.value\.link\._ref: references an entry of type "news"/);
    const deep = fakeCtx({ assets: { [A]: asset(A), [B]: asset(B) }, entries: { [E]: summary(E), [F]: summary(F, { type: 'news' }) } });
    expect(() => projectEntry(t, data, deep)).toThrow(/info\.related\.0\.value\._ref/);
  });
});

describe('list and group: content hash', () => {
  const hash = (d: unknown) => entryContentHash({ id: 'x', data: projectEntry(t, d, ctx) });
  it('changes when list items are reordered', () => {
    const swapped = { ...data, slides: [data.slides[1]!, data.slides[0]!] };
    expect(hash(swapped)).not.toBe(hash(data));
    const tagsSwapped = { ...data, tags: [data.tags[1]!, data.tags[0]!] };
    expect(hash(tagsSwapped)).not.toBe(hash(data));
  });
  it('is stable under key order inside groups and items', () => {
    const reordered = {
      info: { related: [{ value: { _kind: 'entry', _ref: F }, _key: 'r1' }], phone: '555 1234' },
      tags: data.tags.map((x) => ({ value: x.value, _key: x._key })),
      slides: data.slides.map((s) => ({ value: { link: s.value.link, picture: s.value.picture, caption: s.value.caption }, _key: s._key })),
      title: 'Forsíða',
    };
    expect(hash(reordered)).toBe(hash(data));
  });
  it('changes with a resolved summary deep inside', () => {
    const other = fakeCtx({ assets: { [A]: asset(A), [B]: asset(B, { focal: { x: 0.2, y: 0.8 } }) }, entries: { [E]: summary(E), [F]: summary(F, { title: 'Nýtt' }) } });
    expect(entryContentHash({ id: 'x', data: projectEntry(t, data, other) })).not.toBe(hash(data));
  });
});

describe('list and group: delivery types', () => {
  it('declares nested lists and groups inline, each nullable', () => {
    const out = generateDeliveryTypes([t]);
    expect(out).toContain(
      '  slides: Array<{ _key: string; value: { caption: string | null; picture: PublicAsset | null; link: EntrySummary | null; } | null }> | null;',
    );
    expect(out).toContain('  tags: Array<{ _key: string; value: string | null }> | null;');
    expect(out).toContain('  info: { phone: string | null; related: Array<{ _key: string; value: EntrySummary | null }> | null; } | null;');
  });
  it('quotes select values inside a list', () => {
    const l = list(select({ label: 'S', options: [{ value: 'a', label: 'A' }] }), { label: 'L' });
    expect(l.tsType()).toBe('Array<{ _key: string; value: "a" | null }> | null');
  });
});
