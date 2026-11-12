import { describe, expect, it } from 'vitest';
import { defineModule, defineType, isSingleton, newsType, RESERVED_TYPE_NAMES, structureItems, text, type ModuleManifest } from '../index.ts';

describe('newsType', () => {
  it('has the library shape', () => {
    expect(newsType.name).toBe('news');
    expect(newsType.version).toBe(1);
    expect(Object.keys(newsType.fields)).toEqual(['title', 'date', 'excerpt', 'image', 'body', 'source']);
    expect(newsType.preview).toEqual({ title: 'title', media: 'image' });
    expect(newsType.orderBy).toBe('date');
  });
  it('requires title, date and image to publish', () => {
    const r = newsType.publishValidator().safeParse({});
    expect(r.success).toBe(false);
    const paths = r.success ? [] : r.error.issues.map((i) => i.path[0]).sort();
    expect(paths).toEqual(['date', 'image', 'title']);
  });
  it('limits title to 200 and excerpt to 400 characters', () => {
    const draft = newsType.draftValidator();
    expect(draft.safeParse({ title: 'x'.repeat(201) }).success).toBe(false);
    expect(draft.safeParse({ title: 'x'.repeat(200) }).success).toBe(true);
    expect(draft.safeParse({ excerpt: 'x'.repeat(401) }).success).toBe(false);
    expect(draft.safeParse({ excerpt: 'a\nb' }).success).toBe(true);
  });
  it('uses neutral English labels', () => {
    expect(Object.values(newsType.fields).map((f) => f.label)).toEqual(['Title', 'Date', 'Excerpt', 'Image', 'Body', 'Source']);
  });
});

describe('defineModule', () => {
  it('returns the manifest unchanged', () => {
    const m: ModuleManifest = { tenant: 't', locale: 'is', branding: { name: 'T' }, types: [], structure: [], site: {} };
    expect(defineModule(m)).toBe(m);
  });

  // A type's list is the editor's page /t/<tenant>/<type>; a type named after one of the editor's
  // own pages there (/t/<tenant>/assets/…) could never be reached (A10).
  it('refuses a type named after one of the editor\'s own pages', () => {
    expect(RESERVED_TYPE_NAMES).toContain('assets');
    for (const name of RESERVED_TYPE_NAMES) {
      const type = defineType({ name, version: 1, label: name, fields: { title: text({ label: 'Title' }) }, preview: { title: 'title' }, orderBy: 'title' });
      const m: ModuleManifest = { tenant: 't', locale: 'is', branding: { name: 'T' }, types: [type], structure: [{ type: name, label: name }], site: {} };
      expect(() => defineModule(m)).toThrow(new RegExp(`type "${name}" is the name of an editor page`));
    }
  });
});

describe('structure (M2-09; spec §3.2)', () => {
  const type = (name: string) => defineType({ name, version: 1, label: name, fields: { title: text({ label: 'Title' }) }, preview: { title: 'title' }, orderBy: 'title' });
  const manifest = (structure: ModuleManifest['structure']): ModuleManifest => ({
    tenant: 't',
    locale: 'is',
    branding: { name: 'T' },
    types: [type('news'), type('page'), type('settings')],
    structure,
    site: {},
  });

  it('accepts groups, order and singletons', () => {
    const m = manifest([
      { group: 'Efni', items: [{ type: 'page', label: 'Síður' }, { type: 'news', label: 'Fréttir' }] },
      { type: 'settings', label: 'Stillingar', singleton: true },
    ]);
    expect(defineModule(m)).toBe(m);
  });
  it('refuses an unknown type, at the top level and in a group', () => {
    expect(() => defineModule(manifest([{ type: 'nope', label: 'X' }]))).toThrow(/structure: unknown type "nope"/);
    expect(() => defineModule(manifest([{ group: 'G', items: [{ type: 'nope', label: 'X' }] }]))).toThrow(/structure: unknown type "nope"/);
  });
  it('refuses a type listed twice, also across groups', () => {
    expect(() => defineModule(manifest([{ type: 'news', label: 'A' }, { type: 'news', label: 'B' }]))).toThrow(/structure: type "news" is listed twice/);
    expect(() =>
      defineModule(manifest([{ group: 'G', items: [{ type: 'news', label: 'A' }] }, { group: 'H', items: [{ type: 'news', label: 'B' }] }])),
    ).toThrow(/structure: type "news" is listed twice/);
  });
  it('refuses an empty group, a duplicate group and empty labels', () => {
    expect(() => defineModule(manifest([{ group: 'G', items: [] }]))).toThrow(/structure: group "G" is empty/);
    expect(() =>
      defineModule(manifest([{ group: 'G', items: [{ type: 'news', label: 'A' }] }, { group: 'G', items: [{ type: 'page', label: 'B' }] }])),
    ).toThrow(/structure: group "G" is listed twice/);
    expect(() => defineModule(manifest([{ type: 'news', label: ' ' }]))).toThrow(/structure: type "news" has no label/);
    expect(() => defineModule(manifest([{ group: '', items: [{ type: 'news', label: 'A' }] }]))).toThrow(/structure: a group has no label/);
  });
});

describe('structureItems and isSingleton', () => {
  const m = {
    structure: [
      { type: 'news', label: 'Fréttir' },
      { group: 'G', items: [{ type: 'page', label: 'Síður' }, { type: 'settings', label: 'Stillingar', singleton: true }] },
    ],
  } as ModuleManifest;
  it('lists the items in navigation order', () => {
    expect(structureItems(m).map((i) => i.type)).toEqual(['news', 'page', 'settings']);
  });
  it('knows the singleton types', () => {
    expect(isSingleton(m, 'settings')).toBe(true);
    expect(isSingleton(m, 'news')).toBe(false);
    expect(isSingleton(m, 'unlisted')).toBe(false);
  });
});
