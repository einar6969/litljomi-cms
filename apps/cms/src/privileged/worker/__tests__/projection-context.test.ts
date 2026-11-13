import { describe, expect, it } from 'vitest';
import {
  ProjectionError,
  defineModule,
  defineType,
  newsType,
  projectEntry,
  reference,
  resolveAsset,
  resolveEntry,
  text,
  type SiteEntry,
} from '@litljomi/cms-schema';
import { buildProjectionContext, contextFromRead, localStackOrigin, publicMediaUrl, type ReadRef } from '../projection-context';

const site = defineModule({
  tenant: 'prufa',
  locale: 'is',
  branding: { name: 'Prufa' },
  types: [newsType],
  structure: [],
  site: {
    news: {
      path: (e: SiteEntry) => {
        if (e.slug === null) throw new Error('no slug');
        return `/frettir/${e.slug}`;
      },
      checks: () => [],
    },
  },
});

const mediaUrl = (p: string) => `https://media.example/${p}`;

describe('buildProjectionContext', () => {
  const ctx = buildProjectionContext({
    module: site,
    entries: [
      { id: 'e1', type: 'news', slug: 'braud', title: 'Brauð', sortAt: null },
      { id: 'e2', type: 'news', slug: null, title: 'Án slóðar', sortAt: null },
      { id: 'e3', type: 'event', slug: 'x', title: 'Viðburður', sortAt: null },
    ],
    assets: [
      { id: 'a1', filename: 'a.jpg', mime: 'image/jpeg', width: 800, height: 600, focal_x: 0.5, focal_y: 0.25, default_alt: 'Alt', public_path: 'prufa/a1/a.jpg', caption: 'Kanilsnúðar á bakka', credit: 'Anna Önnudóttir' },
      { id: 'a2', filename: 'b.jpg', mime: 'image/jpeg', width: 10, height: 10, focal_x: null, focal_y: null, default_alt: null, public_path: 'prufa/a2/b.jpg', caption: null, credit: null },
      { id: 'a3', filename: 'c.jpg', mime: 'image/jpeg', width: 10, height: 10, focal_x: null, focal_y: null, default_alt: null, public_path: null, caption: null, credit: null },
    ],
    mediaUrl,
    localMediaOrigin: null,
  });

  it('resolves an entry to its summary, with the path from the module\'s site integration', () => {
    expect(resolveEntry(ctx, 'e1')).toEqual({ id: 'e1', type: 'news', slug: 'braud', title: 'Brauð', path: '/frettir/braud' });
  });
  it('gives a null path when the integration cannot compute one or the type has no site pages', () => {
    expect(resolveEntry(ctx, 'e2')?.path).toBeNull();
    expect(resolveEntry(ctx, 'e3')?.path).toBeNull();
  });
  it('resolves an entry it was not given (not published) to null', () => {
    expect(resolveEntry(ctx, 'nope')).toBeNull();
  });
  it('resolves a public asset to its URL, size, default alt, focal point, caption and credit', () => {
    expect(resolveAsset(ctx, 'a1')).toEqual({
      id: 'a1',
      url: 'https://media.example/prufa/a1/a.jpg',
      width: 800,
      height: 600,
      mime: 'image/jpeg',
      alt: 'Alt',
      focal: { x: 0.5, y: 0.25 },
      caption: 'Kanilsnúðar á bakka',
      credit: 'Anna Önnudóttir',
    });
    expect(resolveAsset(ctx, 'a2')).toMatchObject({ alt: '', focal: null, caption: null, credit: null });
  });
  it('resolves an asset without a public path, or unknown, to null', () => {
    expect(resolveAsset(ctx, 'a3')).toBeNull();
    expect(resolveAsset(ctx, 'nope')).toBeNull();
  });
});

describe('contextFromRead', () => {
  type EntryRef = Extract<ReadRef, { kind: 'entry' }>;
  const ref = (o: Partial<EntryRef>): EntryRef => ({
    path: '$."x"',
    kind: 'entry',
    id: 'e1',
    published: true,
    archived: false,
    type: 'news',
    slug: 'braud',
    title: 'Brauð',
    ...o,
  });

  it('keeps published, not archived entries and not archived assets; the rest resolve to null', () => {
    const ctx = contextFromRead(
      [
        ref({ id: 'e1' }),
        ref({ id: 'e2', published: false, title: null }),
        ref({ id: 'e3', archived: true }),
        { path: '$."i"', kind: 'asset', id: 'a1', published: true, archived: false, filename: 'a.jpg', mime: 'image/jpeg', width: 1, height: 1, focal_x: null, focal_y: null, default_alt: 'A', public_path: 'prufa/a1/a.jpg', caption: 'Myndatexti', credit: 'Ljósmyndari' },
        { path: '$."j"', kind: 'asset', id: 'a2', published: true, archived: true, filename: 'b.jpg', mime: 'image/jpeg', width: 1, height: 1, focal_x: null, focal_y: null, default_alt: null, public_path: 'prufa/a2/b.jpg', caption: null, credit: null },
      ],
      site,
      mediaUrl,
      null,
    );
    expect(resolveEntry(ctx, 'e1')?.path).toBe('/frettir/braud');
    expect(resolveEntry(ctx, 'e2')).toBeNull();
    expect(resolveEntry(ctx, 'e3')).toBeNull();
    expect(resolveAsset(ctx, 'a1')?.url).toBe('https://media.example/prufa/a1/a.jpg');
    expect(resolveAsset(ctx, 'a1')).toMatchObject({ caption: 'Myndatexti', credit: 'Ljósmyndari' });
    expect(resolveAsset(ctx, 'a2')).toBeNull();
  });

  it('resolves a reference field through the read: published target to its summary, unpublished to null, other type refused (M2-04)', () => {
    const E1 = '11111111-1111-4111-8111-111111111111';
    const E2 = '22222222-2222-4222-8222-222222222222';
    const E3 = '33333333-3333-4333-8333-333333333333';
    const page = defineType({
      name: 'page',
      version: 1,
      label: 'Síða',
      fields: { title: text({ label: 'Titill' }), related: reference({ label: 'Tengt', to: ['news'] }) },
      preview: { title: 'title' },
      orderBy: 'title',
    });
    const ctx = contextFromRead(
      [ref({ id: E1 }), ref({ id: E2, published: false, type: null, slug: null, title: null }), ref({ id: E3, type: 'event', slug: 'x' })],
      site,
      mediaUrl,
      null,
    );
    const related = (id: string) => projectEntry(page, { related: { _ref: id, _kind: 'entry' } }, ctx).related;
    expect(related(E1)).toEqual({ id: E1, type: 'news', slug: 'braud', title: 'Brauð', path: '/frettir/braud' });
    expect(related(E2)).toBeNull();
    expect(() => related(E3)).toThrow(ProjectionError);
  });
});

describe('publicMediaUrl', () => {
  it('is the media-public object URL under the Supabase URL, each segment encoded', () => {
    expect(publicMediaUrl('https://x.supabase.co', 'prufa/a1/mynd með bili.jpg')).toBe(
      'https://x.supabase.co/storage/v1/object/public/media-public/prufa/a1/mynd%20me%C3%B0%20bili.jpg',
    );
    expect(publicMediaUrl('https://x.supabase.co/', 'p/a/b.jpg')).toBe('https://x.supabase.co/storage/v1/object/public/media-public/p/a/b.jpg');
  });
});

// Enhancement A4: the stack's own address decides whether http media are delivered.
describe('localStackOrigin', () => {
  it('is the origin of a local stack: an http Supabase URL on a loopback host', () => {
    expect(localStackOrigin('http://127.0.0.1:54321')).toBe('http://127.0.0.1:54321');
    expect(localStackOrigin('http://127.0.0.1:54331/')).toBe('http://127.0.0.1:54331');
    expect(localStackOrigin('http://localhost:54321')).toBe('http://localhost:54321');
  });
  it('is null for a hosted project and for any address that is not loopback', () => {
    for (const url of ['https://abcdefghijklmnopqrst.supabase.co', 'http://abcdefghijklmnopqrst.supabase.co', 'https://127.0.0.1:54321', 'http://10.0.0.1:54321', 'http://0.0.0.0:54321', ''])
      expect(localStackOrigin(url), url).toBeNull();
  });
});

describe("a local stack's media", () => {
  const LOCAL = 'http://127.0.0.1:54331';
  const asset = { id: 'a1', filename: 'a.jpg', mime: 'image/jpeg', width: 8, height: 6, focal_x: null, focal_y: null, default_alt: null, public_path: 'prufa/a1/a.jpg' };
  const context = (base: string) =>
    buildProjectionContext({ module: site, entries: [], assets: [asset], mediaUrl: (p) => publicMediaUrl(base, p), localMediaOrigin: localStackOrigin(base) });

  it("resolves to the stack's own http address when the stack is local", () => {
    expect(resolveAsset(context(LOCAL), 'a1')?.url).toBe(`${LOCAL}/storage/v1/object/public/media-public/prufa/a1/a.jpg`);
  });
  it('resolves to null for an http address on a host that is not loopback', () => {
    expect(resolveAsset(context('http://abcdefghijklmnopqrst.supabase.co'), 'a1')).toBeNull();
    expect(resolveAsset(context('http://10.0.0.1:54331'), 'a1')).toBeNull();
  });
  it('resolves to the https address of a hosted project, as before', () => {
    expect(resolveAsset(context('https://abcdefghijklmnopqrst.supabase.co'), 'a1')?.url).toBe(
      'https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/media-public/prufa/a1/a.jpg',
    );
  });
  it('contextFromRead carries the local origin too', () => {
    const ctx = contextFromRead(
      [{ path: '$."i"', kind: 'asset', published: true, archived: false, ...asset }],
      site,
      (p) => publicMediaUrl(LOCAL, p),
      localStackOrigin(LOCAL),
    );
    expect(resolveAsset(ctx, 'a1')?.url).toBe(`${LOCAL}/storage/v1/object/public/media-public/prufa/a1/a.jpg`);
  });
});
