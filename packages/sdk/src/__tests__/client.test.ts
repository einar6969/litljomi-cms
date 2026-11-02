import { describe, expect, it, vi } from 'vitest';
import { createCmsClient, type Bundle, type BundleEntry, type Pointer } from '../index.ts';

const entry = (id: string, slug: string | null): BundleEntry => ({
  id, revisionId: 'r' + id, contentHash: 'h' + id, slug, title: null, sortAt: null,
  firstPublishedAt: '2026-01-01T00:00:00Z', lastPublishedAt: '2026-01-01T00:00:00Z', schemaVersion: 1, data: { n: id },
});
const bundle: Bundle = { format: 1, tenant: 't', release: 5, generatedAt: 'x', entries: { news: [entry('1', 'a'), entry('2', 'b')] } };
const pointer: Pointer = { format: 1, tenant: 't', release: 5, bundle: 'releases/5.json', generatedAt: 'x' };
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });

function setup(p: unknown = pointer, b: unknown = bundle) {
  const fetch = vi.fn(async (url: string | URL | Request) =>
    String(url).endsWith('current.json') ? json(p) : json(b),
  );
  const client = createCmsClient({ deliveryBaseUrl: 'https://cdn.example/delivery', tenant: 't', fetch: fetch as unknown as typeof globalThis.fetch });
  return { fetch, client };
}

describe('createCmsClient', () => {
  it('fetches the pointer with tag cms and revalidate 3600, then the bundle with force-cache', async () => {
    const { fetch, client } = setup();
    expect(await client.getBundle()).toEqual(bundle);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(1, 'https://cdn.example/delivery/t/current.json', { next: { tags: ['cms'], revalidate: 3600 } });
    expect(fetch).toHaveBeenNthCalledWith(2, 'https://cdn.example/delivery/t/releases/5.json', { cache: 'force-cache' });
  });
  it('never uses no-store', async () => {
    const { fetch, client } = setup();
    await client.getEntries('news');
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [, init] of fetch.mock.calls as unknown as Array<[unknown, { cache?: string; next?: { revalidate?: number | false } }]>) {
      expect(init.cache).not.toBe('no-store');
      expect(init.next?.revalidate).not.toBe(0);
    }
  });
  it('tolerates a trailing slash on the base URL', async () => {
    const fetch = vi.fn(async (url: string | URL | Request) => (String(url).endsWith('current.json') ? json(pointer) : json(bundle)));
    const c = createCmsClient({ deliveryBaseUrl: 'https://cdn.example/d/', tenant: 't', fetch: fetch as unknown as typeof globalThis.fetch });
    await c.getBundle();
    expect(fetch.mock.calls[0]?.[0]).toBe('https://cdn.example/d/t/current.json');
  });
  it('getEntries and getEntry', async () => {
    const { client } = setup();
    expect((await client.getEntries('news')).map((e) => e.id)).toEqual(['1', '2']);
    expect(await client.getEntries('missing')).toEqual([]);
    expect((await client.getEntry('news', 'b'))?.id).toBe('2');
    expect(await client.getEntry('news', 'zz')).toBeNull();
  });
  it('throws on pointer format 2 and on bundle format 2', async () => {
    await expect(setup({ ...pointer, format: 2 }).client.getBundle()).rejects.toThrow(/format/);
    await expect(setup(pointer, { ...bundle, format: 2 }).client.getBundle()).rejects.toThrow(/format/);
  });
  it('throws on a failed response, a foreign tenant and an unexpected bundle path', async () => {
    const failing = createCmsClient({ deliveryBaseUrl: 'https://x', tenant: 't', fetch: (async () => json({}, 404)) as unknown as typeof fetch });
    await expect(failing.getBundle()).rejects.toThrow();
    await expect(setup({ ...pointer, tenant: 'other' }).client.getBundle()).rejects.toThrow(/tenant/);
    for (const b of ['../x.json', 'https://evil/x.json', '/releases/5.json', 'releases/5.json?x=1']) {
      await expect(setup({ ...pointer, bundle: b }).client.getBundle()).rejects.toThrow(/bundle/);
    }
  });
  it('throws when the bundle names another tenant or another release than the pointer', async () => {
    await expect(setup(pointer, { ...bundle, tenant: 'other' }).client.getBundle()).rejects.toThrow(/tenant/);
    await expect(setup(pointer, { ...bundle, release: 6 }).client.getBundle()).rejects.toThrow(/release/);
    await expect(setup(pointer, { ...bundle, release: undefined }).client.getBundle()).rejects.toThrow(/release/);
  });
});
