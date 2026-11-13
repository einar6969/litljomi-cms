import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = { id: '00000000-0000-4000-8000-0000000000f1', slug: 'acme', name: 'Acme', status: 'active' as 'active' | 'suspended' };
const ASSET = '00000000-0000-4000-8000-0000000000a1';
const PATH = `${TENANT.id}/${ASSET}/rugbraud.jpg`;

const state = vi.hoisted(() => ({
  tenant: null as unknown,
  row: { data: null as unknown, error: null as { code: string } | null },
  signed: { data: { signedUrl: '' } as { signedUrl: string } | null, error: null as { message: string } | null },
  calls: [] as unknown[][],
  signs: [] as unknown[][],
}));

vi.mock('@/lib/tenant', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/tenant')>()), currentTenant: vi.fn(async () => state.tenant) }));
vi.mock('@/lib/supabase/server', () => ({
  createEditorClient: vi.fn(async () => {
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'is']) chain[method] = (...args: unknown[]) => (state.calls.push([method, ...args]), chain);
    chain.maybeSingle = async () => state.row;
    return {
      from: (table: string) => (state.calls.push(['from', table]), chain),
      storage: { from: (bucket: string) => ({ createSignedUrl: async (...args: unknown[]) => (state.signs.push([bucket, ...args]), state.signed) }) },
    };
  }),
}));

const { GET } = await import('../[assetId]/original/route');
const get = (assetId: string) => GET(new Request('http://localhost/'), { params: Promise.resolve({ tenant: 'acme', assetId }) });

beforeEach(() => {
  state.tenant = { ...TENANT };
  state.row = { data: { original_path: PATH }, error: null };
  state.signed = { data: { signedUrl: `http://127.0.0.1:54321/storage/v1/object/sign/media-private/${PATH}?token=t` }, error: null };
  state.calls = [];
  state.signs = [];
});

describe('the original route', () => {
  it("signs the original of the tenant's file for 600 seconds and sends the browser to it, never cached", async () => {
    const response = await get(ASSET);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(state.signed.data!.signedUrl);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(state.calls).toEqual([
      ['from', 'asset_list'],
      ['select', 'original_path'],
      ['eq', 'id', ASSET],
      ['eq', 'tenant_id', TENANT.id],
      ['is', 'archived_at', null],
    ]);
    expect(state.signs).toEqual([['media-private', PATH, 600]]);
  });

  it('answers 404 for a malformed id, an unknown or suspended tenant, a file it cannot see, or one it cannot sign', async () => {
    expect((await get('x')).status).toBe(404);
    expect((await get(ASSET.toUpperCase())).status).toBe(404);
    expect(state.calls).toEqual([]);
    state.tenant = null;
    expect((await get(ASSET)).status).toBe(404);
    state.tenant = { ...TENANT, status: 'suspended' };
    expect((await get(ASSET)).status).toBe(404);
    expect(state.signs).toEqual([]);
    state.tenant = { ...TENANT };
    state.row = { data: null, error: null };
    expect((await get(ASSET)).status).toBe(404);
    state.row = { data: { original_path: PATH }, error: null };
    state.signed = { data: null, error: { message: 'Object not found' } };
    expect((await get(ASSET)).status).toBe(404);
  });

  it('throws a database error with its code only', async () => {
    state.row = { data: null, error: { code: '57014' } };
    await expect(get(ASSET)).rejects.toThrow('asset_list: 57014');
  });
});
