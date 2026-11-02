import { describe, expect, it } from 'vitest';
import { defineModule, newsType, resolveAsset, resolveEntry, type SiteEntry } from '@litljomi/cms-schema';
import { buildProjectionContext, contextFromRead, publicMediaUrl, type ReadRef } from '../projection-context';

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
      { id: 'a1', filename: 'a.jpg', mime: 'image/jpeg', width: 800, height: 600, focal_x: 0.5, focal_y: 0.25, default_alt: 'Alt', public_path: 'prufa/a1/a.jpg' },
      { id: 'a2', filename: 'b.jpg', mime: 'image/jpeg', width: 10, height: 10, focal_x: null, focal_y: null, default_alt: null, public_path: 'prufa/a2/b.jpg' },
      { id: 'a3', filename: 'c.jpg', mime: 'image/jpeg', width: 10, height: 10, focal_x: null, focal_y: null, default_alt: null, public_path: null },
    ],
    mediaUrl,
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
  it('resolves a public asset to its URL, size, default alt and focal point', () => {
    expect(resolveAsset(ctx, 'a1')).toEqual({
      id: 'a1',
      url: 'https://media.example/prufa/a1/a.jpg',
      width: 800,
      height: 600,
      mime: 'image/jpeg',
      alt: 'Alt',
      focal: { x: 0.5, y: 0.25 },
    });
    expect(resolveAsset(ctx, 'a2')).toMatchObject({ alt: '', focal: null });
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
        { path: '$."i"', kind: 'asset', id: 'a1', published: true, archived: false, filename: 'a.jpg', mime: 'image/jpeg', width: 1, height: 1, focal_x: null, focal_y: null, default_alt: 'A', public_path: 'prufa/a1/a.jpg' },
        { path: '$."j"', kind: 'asset', id: 'a2', published: true, archived: true, filename: 'b.jpg', mime: 'image/jpeg', width: 1, height: 1, focal_x: null, focal_y: null, default_alt: null, public_path: 'prufa/a2/b.jpg' },
      ],
      site,
      mediaUrl,
    );
    expect(resolveEntry(ctx, 'e1')?.path).toBe('/frettir/braud');
    expect(resolveEntry(ctx, 'e2')).toBeNull();
    expect(resolveEntry(ctx, 'e3')).toBeNull();
    expect(resolveAsset(ctx, 'a1')?.url).toBe('https://media.example/prufa/a1/a.jpg');
    expect(resolveAsset(ctx, 'a2')).toBeNull();
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
