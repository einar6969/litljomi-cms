import { describe, expect, it } from 'vitest';
import { fakeCtx } from './helpers.ts';
import {
  ProjectionError,
  date,
  defineType,
  extendType,
  image,
  link,
  projectEntry,
  richText,
  text,
  type EntrySummary,
  type PublicAsset,
} from '../index.ts';

const A = '11111111-1111-4111-8111-111111111111';
const B = '33333333-3333-4333-8333-333333333333';
const E = '22222222-2222-4222-8222-222222222222';

const asset = (url: string): PublicAsset => ({
  id: A,
  url,
  width: 800,
  height: 600,
  mime: 'image/jpeg',
  alt: 'default alt',
  focal: { x: 0.5, y: 0.25 },
});
const summary = (o: Partial<EntrySummary> = {}): EntrySummary => ({
  id: E,
  type: 'news',
  slug: 'frett',
  title: 'Frétt',
  path: '/frettir/frett',
  ...o,
});

const t = defineType({
  name: 'article',
  version: 1,
  label: 'Grein',
  fields: {
    title: text({ label: 'Titill', required: true }),
    when: date({ label: 'Dagsetning' }),
    pic: image({ label: 'Mynd', required: true }),
    body: richText({ label: 'Texti' }),
    related: link({ label: 'Tengill' }),
  },
  preview: { title: 'title', media: 'pic' },
  orderBy: 'when',
});

const data = {
  title: 'Halló',
  pic: { _ref: A, _kind: 'asset', alt: 'per-use alt' },
  related: { entry: { _ref: E, _kind: 'entry' } },
  junk: 1,
};

describe('projectEntry', () => {
  it('projects images, links and absent fields; strips unknown keys', () => {
    const out = projectEntry(t, data, fakeCtx({ assets: { [A]: asset('https://m.test/a.jpg') }, entries: { [E]: summary() } }));
    expect(out).toEqual({
      title: 'Halló',
      when: null,
      pic: { ...asset('https://m.test/a.jpg'), alt: 'per-use alt' },
      body: null,
      related: { entry: summary() },
    });
  });

  it('reference to an unpublished entry projects as null', () => {
    const out = projectEntry(t, data, fakeCtx({ assets: { [A]: asset('https://m.test/a.jpg') }, entries: {} }));
    expect(out.related).toEqual({ entry: null });
  });

  it('external links project their canonical href', () => {
    const out = projectEntry(t, { ...data, related: { href: 'HTTPS://Example.com' } }, fakeCtx({ assets: { [A]: asset('https://m.test/a.jpg') } }));
    expect(out.related).toEqual({ href: 'https://example.com/' });
  });

  it('an image with a missing asset projects as null', () => {
    expect(projectEntry(t, data, fakeCtx({})).pic).toBeNull();
  });

  it('only https asset urls and root-relative entry paths are accepted from the context', () => {
    for (const url of ['data:image/png;base64,AA', 'javascript:alert(1)', '//evil.com/a.jpg', 'http://m.test/a.jpg']) {
      expect(projectEntry(t, data, fakeCtx({ assets: { [A]: asset(url) } })).pic).toBeNull();
    }
    for (const path of ['//evil.com', 'javascript:alert(1)', 'data:text/html,x', '/\\evil.com']) {
      const out = projectEntry(t, data, fakeCtx({ entries: { [E]: summary({ path }) } }));
      expect(out.related).toEqual({ entry: summary({ path: null }) });
    }
  });

  it('delivers asset urls in canonical form and refuses credentials (Task 15 security r1)', () => {
    expect(projectEntry(t, data, fakeCtx({ assets: { [A]: asset('https:m.test/a.jpg') } })).pic).toMatchObject({
      url: 'https://m.test/a.jpg',
    });
    expect(projectEntry(t, data, fakeCtx({ assets: { [A]: asset('https://u:p@m.test/a.jpg') } })).pic).toBeNull();
  });

  it('projects rich text through the context, dropping unsafe resolver output', () => {
    const body = {
      type: 'doc',
      content: [
        { type: 'image', attrs: { asset: { _ref: B, _kind: 'asset' }, alt: 'x' } },
        { type: 'image', attrs: { asset: { _ref: A, _kind: 'asset' }, alt: 'y' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'l', marks: [{ type: 'link', attrs: { entry: { _ref: E, _kind: 'entry' } } }] }] },
      ],
    };
    const ctx = fakeCtx({
      assets: { [A]: asset('https://m.test/a.jpg'), [B]: asset('data:image/png;base64,AA') },
      entries: { [E]: summary({ path: '//evil.com' }) },
    });
    const out = projectEntry(t, { ...data, body }, ctx);
    expect(out.body).toEqual({
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: 'https://m.test/a.jpg', width: 800, height: 600, alt: 'y', caption: undefined } },
        { type: 'paragraph', content: [{ type: 'text', text: 'l' }] },
      ],
    });
  });

  it('rejects data that fails the publish validator', () => {
    expect(() => projectEntry(t, { title: 'x' }, fakeCtx({}))).toThrow(ProjectionError);
    expect(() => projectEntry(t, { ...data, title: 5 }, fakeCtx({}))).toThrow(ProjectionError);
  });
});

describe('image and richText fields', () => {
  it('validate stored shapes', () => {
    const s = image({ label: 'I', required: true });
    expect(s.publishSchema().safeParse({ _ref: A, _kind: 'asset', alt: '' }).success).toBe(true);
    expect(s.publishSchema().safeParse({ _ref: A, _kind: 'entry', alt: '' }).success).toBe(false);
    expect(s.publishSchema().safeParse({ _ref: A, _kind: 'asset' }).success).toBe(false);
    expect(s.publishSchema().safeParse({ _ref: 'x', _kind: 'asset', alt: '' }).success).toBe(false);
    expect(s.publishSchema().safeParse(null).success).toBe(false);
    expect(s.draftSchema().safeParse(null).success).toBe(true);
    expect(s.tsType()).toBe('PublicAsset | null');
  });
  it('richText validates the v1 document, optional by default', () => {
    const r = richText({ label: 'R' });
    expect(r.publishSchema().safeParse(null).success).toBe(true);
    expect(r.publishSchema().safeParse({ type: 'doc', content: [{ type: 'bogus' }] }).success).toBe(false);
    expect(richText({ label: 'R', required: true }).publishSchema().safeParse(undefined).success).toBe(false);
  });
  it('withOptions keeps the kind and changes label and required', () => {
    for (const f of [image({ label: 'I' }), richText({ label: 'R' })]) {
      const g = f.withOptions({ label: 'Nýtt', required: true });
      expect(g.kind).toBe(f.kind);
      expect(g.label).toBe('Nýtt');
      expect(g.required).toBe(true);
      expect(g.publishSchema().safeParse(null).success).toBe(false);
      expect(f.label).not.toBe('Nýtt');
      expect(f.required).toBe(false);
    }
  });
  it('extendType overrides work on image and richText', () => {
    const ext = extendType(t, { fieldOverrides: { pic: { label: 'Aukamynd', required: false }, body: { label: 'Meginmál' } } });
    expect(ext.fields.pic?.label).toBe('Aukamynd');
    expect(ext.fields.body?.label).toBe('Meginmál');
    expect(ext.publishValidator().safeParse({ title: 'x' }).success).toBe(true);
    expect(t.publishValidator().safeParse({ title: 'x' }).success).toBe(false);
  });
});

describe('link projection', () => {
  it('has a projected type that matches tsType', () => {
    expect(link({ label: 'L' }).tsType()).toBe('{ href: string } | { entry: EntrySummary | null } | null');
  });
});
