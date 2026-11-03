import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Answer = { data?: unknown; error?: { code?: string; message?: string } | null; status?: number };

const state = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  tables: {} as Record<string, Answer>,
  rpc: {} as Record<string, Answer>,
  object: null as { data: Blob | null; error: { message: string } | null } | null,
  signed: { data: { signedUrl: 'http://127.0.0.1:54321/storage/v1/object/sign/media-private/x?token=t' }, error: null } as {
    data: { signedUrl: string } | null;
    error: { message: string } | null;
  },
  calls: [] as { name: string; args: unknown }[],
  queries: [] as { table: string; columns: string; filters: [string, unknown][] }[],
  storage: [] as { bucket: string; method: string; args: unknown[] }[],
}));

const fake = {
  auth: { getUser: async () => ({ data: { user: state.user }, error: state.user ? null : { name: 'AuthSessionMissingError' } }) },
  from(table: string) {
    const query = { table, columns: '', filters: [] as [string, unknown][] };
    state.queries.push(query);
    const chain = {
      select: (columns: string) => ((query.columns = columns), chain),
      eq: (column: string, value: unknown) => (query.filters.push([column, value]), chain),
      maybeSingle: async () => ({ data: null, error: null, ...state.tables[table] }),
    };
    return chain;
  },
  async rpc(name: string, args: unknown) {
    state.calls.push({ name, args });
    return { data: null, error: null, status: 200, ...state.rpc[name] };
  },
  storage: {
    from: (bucket: string) => ({
      download: async (...args: unknown[]) => (state.storage.push({ bucket, method: 'download', args }), state.object),
      createSignedUrl: async (...args: unknown[]) => (state.storage.push({ bucket, method: 'createSignedUrl', args }), state.signed),
    }),
  },
};
vi.mock('@/lib/supabase/server', () => ({ createEditorClient: vi.fn(async () => fake) }));

const { assetPreviewAction, registerAssetAction, updateAssetAction } = await import('../asset-actions');

const TENANT_ID = '00000000-0000-4000-8000-0000000000f1';
const OTHER_TENANT = '00000000-0000-4000-8000-0000000000f2';
const ASSET = '00000000-0000-4000-8000-0000000000a1';
const registry = await import('@/modules/registry');
const SLUG = registry.modules[0]!.tenant;
const FILE = 'mynd.jpg';
const PATH = `${TENANT_ID}/${ASSET}/${FILE}`;

const jpeg = new Uint8Array(await sharp({ create: { width: 40, height: 30, channels: 3, background: '#c87828' } }).jpeg().toBuffer());
const png = new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } }).png().toBuffer());
const blobOf = (bytes: Uint8Array) => new Blob([Uint8Array.from(bytes)]);

beforeEach(() => {
  state.user = { id: 'u1' };
  state.calls = [];
  state.queries = [];
  state.storage = [];
  state.tables = {
    my_tenants: { data: { id: TENANT_ID, slug: SLUG, name: 'T', status: 'active' } },
    asset_list: { data: { id: ASSET, tenant_id: TENANT_ID, original_path: PATH, default_alt: 'Brauð', focal_x: 0.5, focal_y: 0.25 } },
  };
  state.rpc = { register_asset: { data: ASSET }, update_asset: {} };
  state.object = { data: blobOf(jpeg), error: null };
});

describe('registerAssetAction', () => {
  it('reads the uploaded object with the editor session and registers the metadata derived from its bytes', async () => {
    await expect(registerAssetAction(SLUG, ASSET, PATH, FILE)).resolves.toEqual({ ok: true, assetId: ASSET });
    expect(state.queries[0]).toEqual({ table: 'my_tenants', columns: 'id, slug, name, status', filters: [['slug', SLUG]] });
    expect(state.storage).toEqual([{ bucket: 'media-private', method: 'download', args: [PATH] }]);
    expect(state.calls).toEqual([
      {
        name: 'register_asset',
        args: {
          p_asset_id: ASSET,
          p_tenant_id: TENANT_ID,
          p_original_path: PATH,
          p_filename: FILE,
          p_mime: 'image/jpeg',
          p_bytes: jpeg.byteLength,
          p_width: 40,
          p_height: 30,
          p_sha256: createHash('sha256').update(jpeg).digest('hex'),
        },
      },
    ]);
  });

  it('rejects an object whose real type is not JPEG, PNG or WebP, or not the type its name says', async () => {
    state.object = { data: new Blob([new TextEncoder().encode('%PDF-1.4\n%%EOF\n')]), error: null };
    await expect(registerAssetAction(SLUG, ASSET, PATH, FILE)).resolves.toEqual({ ok: false, code: 'type' });
    state.object = { data: blobOf(png), error: null };
    await expect(registerAssetAction(SLUG, ASSET, PATH, FILE)).resolves.toEqual({ ok: false, code: 'type' });
    expect(state.calls).toEqual([]);
  });

  it('accepts a PNG named .png', async () => {
    state.object = { data: blobOf(png), error: null };
    const path = `${TENANT_ID}/${ASSET}/mynd.png`;
    await expect(registerAssetAction(SLUG, ASSET, path, 'mynd.png')).resolves.toEqual({ ok: true, assetId: ASSET });
    expect(state.calls[0]?.args).toMatchObject({ p_mime: 'image/png', p_width: 8, p_height: 8 });
  });

  it('rejects an object over 20 MB without registering it', async () => {
    state.object = { data: new Blob([new Uint8Array(20971521)]), error: null };
    await expect(registerAssetAction(SLUG, ASSET, PATH, FILE)).resolves.toEqual({ ok: false, code: 'size' });
    expect(state.calls).toEqual([]);
  });

  it.each([
    ['a non-canonical asset id', SLUG, ASSET.toUpperCase(), `${TENANT_ID}/${ASSET.toUpperCase()}/${FILE}`, FILE],
    ['an asset id that is no UUID', SLUG, 'x', `${TENANT_ID}/x/${FILE}`, FILE],
    ['a path in another tenant', SLUG, ASSET, `${OTHER_TENANT}/${ASSET}/${FILE}`, FILE],
    ['a path of another asset', SLUG, ASSET, `${TENANT_ID}/${OTHER_TENANT}/${FILE}`, FILE],
    ['a path with another filename', SLUG, ASSET, `${TENANT_ID}/${ASSET}/annad.jpg`, FILE],
    ['a filename with a folder', SLUG, ASSET, `${TENANT_ID}/${ASSET}/a/b.jpg`, 'a/b.jpg'],
    ['a filename with ..', SLUG, ASSET, `${TENANT_ID}/${ASSET}/../x.jpg`, '../x.jpg'],
    ['a filename that is not a safe name', SLUG, ASSET, `${TENANT_ID}/${ASSET}/Mynd 1.jpg`, 'Mynd 1.jpg'],
    ['a filename of another type', SLUG, ASSET, `${TENANT_ID}/${ASSET}/mynd.gif`, 'mynd.gif'],
    ['a malformed tenant slug', 'Not a slug', ASSET, PATH, FILE],
  ])('rejects %s before reading anything', async (_name, slug, assetId, path, filename) => {
    await expect(registerAssetAction(slug, assetId, path, filename)).resolves.toEqual({ ok: false, code: 'invalid' });
    expect(state.storage).toEqual([]);
    expect(state.calls).toEqual([]);
  });

  it('rejects arguments that are not strings', async () => {
    await expect(registerAssetAction({} as unknown as string, ASSET, PATH, FILE)).resolves.toEqual({ ok: false, code: 'invalid' });
    await expect(registerAssetAction(SLUG, ASSET, 7 as unknown as string, FILE)).resolves.toEqual({ ok: false, code: 'invalid' });
    await expect(registerAssetAction(SLUG, ASSET, PATH, null as unknown as string)).resolves.toEqual({ ok: false, code: 'invalid' });
    expect(state.storage).toEqual([]);
  });

  it('rejects a tenant the editor is not a member of, and a suspended one, before reading the object', async () => {
    state.tables.my_tenants = { data: null };
    await expect(registerAssetAction(SLUG, ASSET, PATH, FILE)).resolves.toEqual({ ok: false, code: 'invalid' });
    state.tables.my_tenants = { data: { id: TENANT_ID, slug: SLUG, name: 'T', status: 'suspended' } };
    await expect(registerAssetAction(SLUG, ASSET, PATH, FILE)).resolves.toEqual({ ok: false, code: 'invalid' });
    expect(state.storage).toEqual([]);
    expect(state.calls).toEqual([]);
  });

  it('answers auth without a session', async () => {
    state.user = null;
    await expect(registerAssetAction(SLUG, ASSET, PATH, FILE)).resolves.toEqual({ ok: false, code: 'auth' });
    expect(state.storage).toEqual([]);
  });

  it('answers the generic error when the object cannot be read or the database refuses, never the raw message', async () => {
    state.object = { data: null, error: { message: 'Object not found' } };
    await expect(registerAssetAction(SLUG, ASSET, PATH, FILE)).resolves.toEqual({ ok: false, code: 'error' });
    state.object = { data: blobOf(jpeg), error: null };
    state.rpc.register_asset = { error: { code: 'P0001', message: 'forbidden' } };
    await expect(registerAssetAction(SLUG, ASSET, PATH, FILE)).resolves.toEqual({ ok: false, code: 'error' });
    // Decision 39.3: the tenant suspended between the action's check and the call.
    state.rpc.register_asset = { error: { code: 'P0001', message: 'tenant_inactive' } };
    await expect(registerAssetAction(SLUG, ASSET, PATH, FILE)).resolves.toEqual({ ok: false, code: 'error' });
    state.rpc.register_asset = { error: { code: '23505', message: 'duplicate key value violates unique constraint "assets_pkey"' } };
    await expect(registerAssetAction(SLUG, ASSET, PATH, FILE)).resolves.toEqual({ ok: false, code: 'error' });
    state.rpc.register_asset = { error: { code: 'PGRST303', message: 'JWT expired' }, status: 401 };
    await expect(registerAssetAction(SLUG, ASSET, PATH, FILE)).resolves.toEqual({ ok: false, code: 'auth' });
  });

  it('answers the generic error when my_tenants fails', async () => {
    state.tables.my_tenants = { error: { code: '42501', message: 'permission denied for view my_tenants' } };
    await expect(registerAssetAction(SLUG, ASSET, PATH, FILE)).resolves.toEqual({ ok: false, code: 'error' });
  });
});

describe('assetPreviewAction', () => {
  it('signs a 600-second URL for the original in media-private, the tenant taken from the asset row', async () => {
    await expect(assetPreviewAction(ASSET)).resolves.toEqual({
      ok: true,
      url: 'http://127.0.0.1:54321/storage/v1/object/sign/media-private/x?token=t',
      defaultAlt: 'Brauð',
      focalX: 0.5,
      focalY: 0.25,
    });
    expect(state.queries.map((q) => [q.table, q.filters])).toEqual([
      ['asset_list', [['id', ASSET]]],
      ['my_tenants', [['id', TENANT_ID]]],
    ]);
    expect(state.storage).toEqual([{ bucket: 'media-private', method: 'createSignedUrl', args: [PATH, 600] }]);
  });

  it('signs nothing for an asset the editor cannot see, a suspended tenant or a malformed id', async () => {
    state.tables.asset_list = { data: null };
    await expect(assetPreviewAction(ASSET)).resolves.toEqual({ ok: false, code: 'error' });
    state.tables.asset_list = { data: { id: ASSET, tenant_id: TENANT_ID, original_path: PATH, default_alt: null, focal_x: null, focal_y: null } };
    state.tables.my_tenants = { data: { id: TENANT_ID, slug: SLUG, name: 'T', status: 'suspended' } };
    await expect(assetPreviewAction(ASSET)).resolves.toEqual({ ok: false, code: 'error' });
    await expect(assetPreviewAction('x')).resolves.toEqual({ ok: false, code: 'invalid' });
    await expect(assetPreviewAction(7 as unknown as string)).resolves.toEqual({ ok: false, code: 'invalid' });
    expect(state.storage).toEqual([]);
  });

  it('answers auth without a session, and the generic error when signing fails', async () => {
    state.user = null;
    await expect(assetPreviewAction(ASSET)).resolves.toEqual({ ok: false, code: 'auth' });
    state.user = { id: 'u1' };
    state.signed = { data: null, error: { message: 'Object not found' } };
    await expect(assetPreviewAction(ASSET)).resolves.toEqual({ ok: false, code: 'error' });
  });
});

describe('updateAssetAction', () => {
  // The stored row (beforeEach): focal 0.5, 0.25 and default alt "Brauð".
  it('sets the focal point through update_asset, keeping the stored default alt text', async () => {
    await expect(updateAssetAction(ASSET, { focal: { x: 0.1, y: 0.9 } })).resolves.toEqual({ ok: true });
    expect(state.calls).toEqual([{ name: 'update_asset', args: { p_asset_id: ASSET, p_focal_x: 0.1, p_focal_y: 0.9, p_default_alt: 'Brauð' } }]);
  });

  it('sets the default alt text, keeping the stored focal point', async () => {
    await expect(updateAssetAction(ASSET, { defaultAlt: 'Brauð á borði' })).resolves.toEqual({ ok: true });
    expect(state.calls).toEqual([{ name: 'update_asset', args: { p_asset_id: ASSET, p_focal_x: 0.5, p_focal_y: 0.25, p_default_alt: 'Brauð á borði' } }]);
  });

  it('removes the focal point and clears the default alt text with nulls, and sets both at once', async () => {
    await expect(updateAssetAction(ASSET, { focal: null })).resolves.toEqual({ ok: true });
    await expect(updateAssetAction(ASSET, { defaultAlt: null })).resolves.toEqual({ ok: true });
    await expect(updateAssetAction(ASSET, { focal: { x: 0, y: 1 }, defaultAlt: 'x' })).resolves.toEqual({ ok: true });
    expect(state.calls.map((c) => c.args)).toEqual([
      { p_asset_id: ASSET, p_focal_x: null, p_focal_y: null, p_default_alt: 'Brauð' },
      { p_asset_id: ASSET, p_focal_x: 0.5, p_focal_y: 0.25, p_default_alt: null },
      { p_asset_id: ASSET, p_focal_x: 0, p_focal_y: 1, p_default_alt: 'x' },
    ]);
  });

  it('keeps a stored asset without a focal point without one', async () => {
    state.tables.asset_list = { data: { id: ASSET, tenant_id: TENANT_ID, original_path: PATH, default_alt: null, focal_x: null, focal_y: null } };
    await expect(updateAssetAction(ASSET, { defaultAlt: 'Brauð' })).resolves.toEqual({ ok: true });
    expect(state.calls[0]?.args).toEqual({ p_asset_id: ASSET, p_focal_x: null, p_focal_y: null, p_default_alt: 'Brauð' });
  });

  it('rejects out-of-range, malformed or empty changes without reading or calling the database', async () => {
    for (const args of [
      ['x', { focal: { x: 0.5, y: 0.5 } }],
      [ASSET, { focal: { x: -0.1, y: 0.5 } }],
      [ASSET, { focal: { x: 0.5, y: 1.1 } }],
      [ASSET, { focal: { x: Number.NaN, y: 0.5 } }],
      [ASSET, { focal: { x: 0.5 } }],
      [ASSET, { focal: { x: '0.5', y: 0.5 } }],
      [ASSET, { focal: { x: 0.5, y: 0.5, z: 1 } }],
      [ASSET, { defaultAlt: 'x'.repeat(1001) }],
      [ASSET, { defaultAlt: 1 }],
      [ASSET, {}],
      [ASSET, { focal: undefined }],
      [ASSET, { other: 1 }],
      [ASSET, null],
      [ASSET, 0.5, 0.5, null],
    ] as const) {
      await expect(updateAssetAction(...(args as unknown as Parameters<typeof updateAssetAction>))).resolves.toEqual({ ok: false, code: 'invalid' });
    }
    expect(state.calls).toEqual([]);
    expect(state.queries).toEqual([]);
  });

  it('refuses an asset it cannot see or of a suspended tenant, and maps database errors to the generic error', async () => {
    state.tables.asset_list = { data: null };
    await expect(updateAssetAction(ASSET, { focal: null })).resolves.toEqual({ ok: false, code: 'error' });
    state.tables.asset_list = { data: { id: ASSET, tenant_id: TENANT_ID, original_path: PATH, default_alt: null, focal_x: null, focal_y: null } };
    state.tables.my_tenants = { data: { id: TENANT_ID, slug: SLUG, name: 'T', status: 'suspended' } };
    await expect(updateAssetAction(ASSET, { focal: { x: 0.5, y: 0.5 } })).resolves.toEqual({ ok: false, code: 'error' });
    expect(state.calls).toEqual([]);
    state.tables.my_tenants = { data: { id: TENANT_ID, slug: SLUG, name: 'T', status: 'active' } };
    state.rpc.update_asset = { error: { code: 'P0001', message: 'not_found' } };
    await expect(updateAssetAction(ASSET, { focal: { x: 0.5, y: 0.5 } })).resolves.toEqual({ ok: false, code: 'error' });
    // Decision 39.3: the tenant suspended between the action's check and the call.
    state.rpc.update_asset = { error: { code: 'P0001', message: 'tenant_inactive' } };
    await expect(updateAssetAction(ASSET, { focal: { x: 0.5, y: 0.5 } })).resolves.toEqual({ ok: false, code: 'error' });
  });

  it('answers auth without a session or with an expired one', async () => {
    state.user = null;
    await expect(updateAssetAction(ASSET, { focal: null })).resolves.toEqual({ ok: false, code: 'auth' });
    state.user = { id: 'u1' };
    state.rpc.update_asset = { error: { code: 'PGRST301', message: 'JWT expired' }, status: 401 };
    await expect(updateAssetAction(ASSET, { focal: null })).resolves.toEqual({ ok: false, code: 'auth' });
  });
});
