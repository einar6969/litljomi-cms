import { describe, expect, it } from 'vitest';
import {
  boolean,
  compareSchema,
  date,
  defineModule,
  defineType,
  group,
  image,
  link,
  list,
  moduleSnapshot,
  number,
  reference,
  select,
  text,
  updateSnapshot,
  type AnyFieldKind,
  type ContentType,
  type ModuleSnapshot,
  type Transform,
} from '../index.ts';

// Fixture modules (plan M2-18): one `article` type at version 1, changed one way per test.

const baseFields = (): Record<string, AnyFieldKind> => ({
  title: text({ label: 'Title', required: true, max: 200 }),
  published: date({ label: 'Published' }),
  rating: number({ label: 'Rating', min: 0, max: 5, integer: true }),
  featured: boolean({ label: 'Featured' }),
  category: select({ label: 'Category', options: [{ value: 'news', label: 'News' }, { value: 'blog', label: 'Blog' }] }),
  related: reference({ label: 'Related', to: ['article', 'page'] }),
  source: link({ label: 'Source' }),
  cover: image({ label: 'Cover' }),
  meta: group({ label: 'Meta', fields: { author: text({ label: 'Author' }), tags: list(text({ label: 'Tag' }), { label: 'Tags', max: 10 }) } }),
});

function articleModule(fields: Record<string, AnyFieldKind>, version = 1, transforms?: Record<number, Transform>, extraTypes: ContentType[] = []) {
  const article = defineType<Record<string, AnyFieldKind>>({ name: 'article', version, label: 'Article', fields, preview: { title: 'title' }, orderBy: 'published', transforms });
  const page = defineType({ name: 'page', version: 1, label: 'Page', fields: { title: text({ label: 'Title' }) }, preview: { title: 'title' }, orderBy: 'title' });
  return defineModule({ tenant: 'fixture', locale: 'is', branding: { name: 'Fixture' }, types: [article, page, ...extraTypes], structure: [], site: {} });
}

const previous: ModuleSnapshot = moduleSnapshot(articleModule(baseFields()));
const without = (key: string): Record<string, AnyFieldKind> => {
  const { [key]: _, ...rest } = baseFields();
  return rest;
};
const identity: Transform = (d) => d as Record<string, unknown>;

describe('moduleSnapshot', () => {
  it('records each type with its version, transform keys and fields with kind and options, without labels', () => {
    const s = moduleSnapshot(articleModule(baseFields(), 2, { 1: identity }));
    expect(s.tenant).toBe('fixture');
    expect(Object.keys(s.types)).toEqual(['article', 'page']);
    const a = s.types.article!;
    expect(a.version).toBe(2);
    expect(a.transforms).toEqual([1]);
    expect(a.fields.title).toEqual({ kind: 'text', required: true, max: 200, multiline: false });
    expect(a.fields.rating).toEqual({ kind: 'number', required: false, min: 0, max: 5, integer: true });
    expect(a.fields.category).toEqual({ kind: 'select', required: false, values: ['news', 'blog'] });
    expect(a.fields.related).toEqual({ kind: 'reference', required: false, to: ['article', 'page'] });
    expect(a.fields.source).toEqual({ kind: 'link', required: false, entryTypes: null });
    expect(a.fields.meta).toEqual({
      kind: 'group',
      required: false,
      fields: {
        author: { kind: 'text', required: false, multiline: false },
        tags: { kind: 'list', required: false, max: 10, of: { kind: 'text', required: false, multiline: false } },
      },
    });
    expect(JSON.stringify(s)).not.toContain('Title');
    expect(a.retired).toEqual({});
  });

  it('is plain JSON: a round trip gives the same snapshot', () => {
    expect(JSON.parse(JSON.stringify(previous))).toEqual(previous);
  });
});

describe('compareSchema', () => {
  it('passes an identical module with nothing to report', () => {
    const r = compareSchema(previous, articleModule(baseFields()));
    expect(r.errors).toEqual([]);
    expect(r.changes).toEqual([]);
  });

  it('passes an additive change (new optional field, new type, loosened options) and lists it', () => {
    const extra = defineType({ name: 'event', version: 1, label: 'Event', fields: { title: text({ label: 'T' }) }, preview: { title: 'title' }, orderBy: 'title' });
    const fields = {
      ...baseFields(),
      subtitle: text({ label: 'Subtitle' }),
      title: text({ label: 'Titill', required: true, max: 300 }),
      category: select({ label: 'Category', options: [{ value: 'news', label: 'News' }, { value: 'blog', label: 'Blog' }, { value: 'faq', label: 'FAQ' }] }),
    };
    const r = compareSchema(previous, articleModule(fields, 1, undefined, [extra]));
    expect(r.errors).toEqual([]);
    expect(r.changes.join('\n')).toContain('article.subtitle');
    expect(r.changes.join('\n')).toContain('event');
  });

  it('ignores label changes entirely', () => {
    const fields = { ...baseFields(), title: text({ label: 'Titill', required: true, max: 200 }) };
    expect(compareSchema(previous, articleModule(fields))).toEqual({ errors: [], changes: [] });
  });

  const breaking: Array<[string, Record<string, AnyFieldKind>, RegExp]> = [
    ['a removed field', without('rating'), /article\.rating: field removed/],
    ['a rename (removal plus addition)', { ...without('rating'), score: number({ label: 'Score' }) }, /article\.rating: field removed/],
    ['a new required field', { ...baseFields(), lead: text({ label: 'Lead', required: true }) }, /article\.lead: new required field/],
    ['a kind change', { ...baseFields(), rating: text({ label: 'Rating' }) }, /article\.rating: kind changed from number to text/],
    ['an optional field made required', { ...baseFields(), cover: image({ label: 'Cover', required: true }) }, /article\.cover: now required/],
    ['a lower text max', { ...baseFields(), title: text({ label: 'Title', required: true, max: 100 }) }, /article\.title: max lowered from 200 to 100/],
    ['a raised number min', { ...baseFields(), rating: number({ label: 'Rating', min: 1, max: 5, integer: true }) }, /article\.rating: min raised/],
    ['a removed select value', { ...baseFields(), category: select({ label: 'C', options: [{ value: 'news', label: 'News' }] }) }, /article\.category: value "blog" removed/],
    ['a removed reference target', { ...baseFields(), related: reference({ label: 'R', to: ['article'] }) }, /article\.related: target type "page" removed/],
    ['a link narrowed to entry types', { ...baseFields(), source: link({ label: 'S', entryTypes: ['page'] }) }, /article\.source: entry types narrowed/],
    [
      'a nested field removed from a group',
      { ...baseFields(), meta: group({ label: 'Meta', fields: { tags: list(text({ label: 'Tag' }), { label: 'Tags', max: 10 }) } }) },
      /article\.meta\.author: field removed/,
    ],
    [
      'a list item kind change',
      { ...baseFields(), meta: group({ label: 'Meta', fields: { author: text({ label: 'A' }), tags: list(number({ label: 'Tag' }), { label: 'Tags', max: 10 }) } }) },
      /article\.meta\.tags\[\]: kind changed from text to number/,
    ],
  ];

  for (const [what, fields, message] of breaking) {
    it(`fails ${what} without a version bump, naming the type and field`, () => {
      const r = compareSchema(previous, articleModule(fields));
      expect(r.errors.join('\n')).toMatch(message);
      expect(r.errors.join('\n')).toMatch(/bump article's version to 2 and add transform 1/);
    });

    it(`passes ${what} with a version bump and a transform`, () => {
      const r = compareSchema(previous, articleModule(fields, 2, { 1: identity }));
      expect(r.errors).toEqual([]);
      expect(r.changes.join('\n')).toMatch(message);
    });
  }

  it('fails a breaking change with a version bump but no transform', () => {
    const r = compareSchema(previous, articleModule(without('rating'), 2));
    expect(r.errors.join('\n')).toMatch(/article: version raised from 1 to 2 without transform 1/);
  });

  it('fails a version bump of two with only one transform', () => {
    const r = compareSchema(previous, articleModule(without('rating'), 3, { 2: identity }));
    expect(r.errors.join('\n')).toMatch(/article: version raised from 1 to 3 without transform 1/);
  });

  it('fails a lowered version', () => {
    const prev = moduleSnapshot(articleModule(baseFields(), 3, { 1: identity, 2: identity }));
    const r = compareSchema(prev, articleModule(baseFields(), 2, { 1: identity }));
    expect(r.errors.join('\n')).toMatch(/article: version lowered from 3 to 2/);
  });

  it('fails a removed type', () => {
    const page = defineType({ name: 'page', version: 1, label: 'Page', fields: { title: text({ label: 'Title' }) }, preview: { title: 'title' }, orderBy: 'title' });
    const m = defineModule({ tenant: 'fixture', locale: 'is', branding: { name: 'F' }, types: [page], structure: [], site: {} });
    expect(compareSchema(previous, m).errors.join('\n')).toMatch(/article: type removed/);
  });

  it('fails a field name reused with another kind, even with a version bump and transform', () => {
    // Version 2 removed `rating` (with a transform); the snapshot remembers it.
    const v2 = updateSnapshot(previous, moduleSnapshot(articleModule(without('rating'), 2, { 1: identity })));
    expect(v2.types.article!.retired).toEqual({ rating: 'number' });
    const reused = { ...without('rating'), rating: text({ label: 'Rating' }) };
    const r = compareSchema(v2, articleModule(reused, 3, { 1: identity, 2: identity }));
    expect(r.errors.join('\n')).toMatch(/article\.rating: field name reused with kind text \(it was number\)/);
    // The same kind again is allowed (an additive optional field).
    const back = { ...without('rating'), rating: number({ label: 'Rating' }) };
    expect(compareSchema(v2, articleModule(back, 2, { 1: identity })).errors).toEqual([]);
  });

  it('remembers removed nested fields too', () => {
    const fields = { ...baseFields(), meta: group({ label: 'Meta', fields: { author: text({ label: 'A' }) } }) };
    const v2 = updateSnapshot(previous, moduleSnapshot(articleModule(fields, 2, { 1: identity })));
    expect(v2.types.article!.retired).toEqual({ 'meta.tags': 'list', 'meta.tags[]': 'text' });
    const reused = { ...baseFields(), meta: group({ label: 'Meta', fields: { author: text({ label: 'A' }), tags: text({ label: 'Tags' }) } }) };
    expect(compareSchema(v2, articleModule(reused, 2, { 1: identity })).errors.join('\n')).toMatch(/article\.meta\.tags: field name reused with kind text \(it was list\)/);
  });
});

describe('updateSnapshot', () => {
  it('keeps the retired names of earlier snapshots', () => {
    const v2 = updateSnapshot(previous, moduleSnapshot(articleModule(without('rating'), 2, { 1: identity })));
    // v3 drops `featured`; `rating` stays retired from v2.
    const v3 = updateSnapshot(v2, moduleSnapshot(articleModule(without('featured'), 3, { 1: identity, 2: identity })));
    expect(v3.types.article!.retired).toMatchObject({ rating: 'number', featured: 'boolean' });
  });

  it('starts from an empty history when there is no previous snapshot', () => {
    expect(updateSnapshot(null, previous)).toEqual(previous);
  });
});
