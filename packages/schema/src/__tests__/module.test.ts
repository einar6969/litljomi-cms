import { describe, expect, it } from 'vitest';
import { defineModule, newsType, type ModuleManifest } from '../index.ts';

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
});
