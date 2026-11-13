import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createCmsClient, type Bundle, type Pointer, type PublicAsset } from '../index.ts';

// Media library L3: the file's caption and credit are additive fields of format 1 (spec §7.2),
// delivered with every image, as `focal` was before them.
const pointer: Pointer = { format: 1, tenant: 't', release: 7, bundle: 'releases/7.json', generatedAt: 'x' };
const bundleWith = (pic: Record<string, unknown>): Bundle => ({
  format: 1,
  tenant: 't',
  release: 7,
  generatedAt: 'x',
  entries: {
    news: [
      {
        id: 'e', revisionId: 'r', contentHash: 'h', slug: 'a', title: null, sortAt: null,
        firstPublishedAt: 'x', lastPublishedAt: 'x', schemaVersion: 1, data: { pic },
      },
    ],
  },
});
const base = { id: 'a1', url: 'https://cdn.example/t/a1/a.jpg', width: 8, height: 6, mime: 'image/jpeg', alt: 'Brauð' };

async function read(bundle: Bundle): Promise<PublicAsset> {
  const fetch = vi.fn(async (url: string | URL | Request) =>
    new Response(JSON.stringify(String(url).endsWith('current.json') ? pointer : bundle), { status: 200 }),
  );
  const client = createCmsClient({ deliveryBaseUrl: 'https://cdn.example/delivery', tenant: 't', fetch: fetch as unknown as typeof globalThis.fetch });
  const entry = await client.getEntry<{ pic: PublicAsset }>('news', 'a');
  if (entry === null) throw new Error('the entry is missing');
  return entry.data.pic;
}

describe('PublicAsset caption and credit (format 1, additive)', () => {
  it('types both as optional and nullable, so an image from an older bundle is still a PublicAsset', () => {
    expectTypeOf<PublicAsset['caption']>().toEqualTypeOf<string | null | undefined>();
    expectTypeOf<PublicAsset['credit']>().toEqualTypeOf<string | null | undefined>();
    expectTypeOf<Omit<PublicAsset, 'caption' | 'credit'>>().toExtend<PublicAsset>();
  });

  it('reads a bundle with them through the client, unchanged', async () => {
    const pic = await read(bundleWith({ ...base, focal: null, caption: 'Kanilsnúðar á bakka', credit: 'Anna Önnudóttir' }));
    expect(pic.caption).toBe('Kanilsnúðar á bakka');
    expect(pic.credit).toBe('Anna Önnudóttir');
  });

  it('reads a bundle written before they were delivered: both are absent, nothing else changes', async () => {
    const pic = await read(bundleWith(base));
    expect(pic).toEqual(base);
    expect(pic.caption ?? null).toBeNull();
    expect(pic.credit ?? null).toBeNull();
  });
});
