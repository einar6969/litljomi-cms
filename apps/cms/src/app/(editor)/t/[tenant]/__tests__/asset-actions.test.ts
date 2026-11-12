import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Answer = { data?: unknown; error?: { code?: string; message?: string } | null; status?: number };
type Signed = { data: { signedUrl: string } | null; error: { message: string } | null };

const state = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  tables: {} as Record<string, Answer>,
  rpc: {} as Record<string, Answer>,
  object: null as { data: Blob | null; error: { message: string } | null } | null,
  signed: { data: { signedUrl: 'http://127.0.0.1:54321/storage/v1/object/sign/media-private/x?token=t' }, error: null } as Signed | ((path: string) => Signed),
  /** The upload's answer, or an error it throws. */
  upload: { error: null } as { error: { message: string } | null } | Error,
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
      createSignedUrl: async (...args: unknown[]) => (
        state.storage.push({ bucket, method: 'createSignedUrl', args }), typeof state.signed === 'function' ? state.signed(args[0] as string) : state.signed
      ),
      upload: async (...args: unknown[]) => {
        state.storage.push({ bucket, method: 'upload', args });
        if (state.upload instanceof Error) throw state.upload;
        return state.upload;
      },
    }),
  },
};
vi.mock('@/lib/supabase/server', () => ({ createEditorClient: vi.fn(async () => fake) }));

const { assetPreviewAction, ensureThumbnailAction, registerAssetAction, updateAssetAction, updateAssetTextAction } = await import('../asset-actions');

const TENANT_ID = '00000000-0000-4000-8000-0000000000f1';
const OTHER_TENANT = '00000000-0000-4000-8000-0000000000f2';
const ASSET = '00000000-0000-4000-8000-0000000000a1';
const registry = await import('@/modules/registry');
const SLUG = registry.modules[0]!.tenant;
const FILE = 'mynd.jpg';
const PATH = `${TENANT_ID}/${ASSET}/${FILE}`;
const THUMB = `${TENANT_ID}/${ASSET}/thumb/480.webp`;
const SIGNED = 'http://127.0.0.1:54321/storage/v1/object/sign/media-private/x?token=t';

const jpeg = new Uint8Array(await sharp({ create: { width: 40, height: 30, channels: 3, background: '#c87828' } }).jpeg().toBuffer());
const png = new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } }).png().toBuffer());
const blobOf = (bytes: Uint8Array) => new Blob([Uint8Array.from(bytes)]);
// A PNG one row past the thumbnail's pixel cap (100 megapixels): small to store, never decoded.
const overCap = new Uint8Array(
  await sharp({ create: { width: 10_000, height: 10_001, channels: 3, background: '#000' } }).png({ compressionLevel: 9 }).toBuffer(),
);
// A JPEG whose header is whole and whose pixels are cut off: registered, but no thumbnail.
const wholeJpeg = new Uint8Array(await sharp({ create: { width: 800, height: 600, channels: 3, background: '#c87828' } }).jpeg().toBuffer());
const truncated = wholeJpeg.slice(0, Math.floor(wholeJpeg.byteLength / 3));

const row = (o: Record<string, unknown> = {}) => ({
  id: ASSET,
  tenant_id: TENANT_ID,
  original_path: PATH,
  thumb_path: null,
  default_alt: 'Brauð',
  focal_x: 0.5,
  focal_y: 0.25,
  ...o,
});

/** The thumbnail's upload: its path, body and options. */
const thumbnailUpload = () => state.storage.find((c) => c.method === 'upload');

beforeEach(() => {
  state.user = { id: 'u1' };
  state.calls = [];
  state.queries = [];
  state.storage = [];
  state.tables = {
    my_tenants: { data: { id: TENANT_ID, slug: SLUG, name: 'T', status: 'active' } },
    asset_list: { data: row() },
  };
  state.rpc = { register_asset: { data: ASSET }, update_asset: {}, update_asset_text: {}, set_asset_thumbnail: {} };
  state.object = { data: blobOf(jpeg), error: null };
  state.upload = { error: null };
  state.signed = { data: { signedUrl: SIGNED }, error: null };
});

describe('registerAssetAction', () => {
  it('reads the uploaded object with the editor session and registers the metadata derived from its bytes', async () => {
    await expect(registerAssetAction(SLUG, ASSET, PATH, FILE)).resolves.toEqual({ ok: true, assetId: ASSET });
    expect(state.queries[0]).toEqual({ table: 'my_tenants', columns: 'id, slug, name, status', filters: [['slug', SLUG]] });
    expect(state.storage[0]).toEqual({ bucket: 'media-private', method: 'download', args: [PATH] });
    expect(state.calls[0]).toEqual(
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
    );
  });

  it('then makes the thumbnail from the same bytes, stores it in the file\'s folder and records it', async () => {
    await expect(registerAssetAction(SLUG, ASSET, PATH, FILE)).resolves.toEqual({ ok: true, assetId: ASSET });
    // One download only: the thumbnail is made from the bytes already read.
    expect(state.storage.map((c) => c.method)).toEqual(['download', 'upload']);
    const upload = thumbnailUpload()!;
    expect(upload.bucket).toBe('media-private');
    expect(upload.args[0]).toBe(THUMB);
    expect(upload.args[2]).toEqual({ contentType: 'image/webp', upsert: false });
    expect(await sharp(upload.args[1] as Uint8Array).metadata()).toMatchObject({ format: 'webp', width: 40, height: 30 });
    expect(state.calls.map((c) => c.name)).toEqual(['register_asset', 'set_asset_thumbnail']);
    expect(state.calls[1]!.args).toEqual({ p_asset_id: ASSET, p_thumb_path: THUMB });
  });

  it('registers the file without a thumbnail when none can be made or stored', async () => {
    const png = `${TENANT_ID}/${ASSET}/mynd.png`;
    // Over the pixel cap: nothing is decoded or uploaded.
    state.object = { data: blobOf(overCap), error: null };
    await expect(registerAssetAction(SLUG, ASSET, png, 'mynd.png')).resolves.toEqual({ ok: true, assetId: ASSET });
    expect(state.storage.map((c) => c.method)).toEqual(['download']);
    expect(state.calls.map((c) => c.name)).toEqual(['register_asset']);

    // A corrupt file whose header passed.
    state.storage = [];
    state.calls = [];
    state.object = { data: blobOf(truncated), error: null };
    await expect(registerAssetAction(SLUG, ASSET, PATH, FILE)).resolves.toEqual({ ok: true, assetId: ASSET });
    expect(state.storage.map((c) => c.method)).toEqual(['download']);
    expect(state.calls.map((c) => c.name)).toEqual(['register_asset']);

    // The upload fails, and no object is there to record (set_asset_thumbnail says not_found).
    state.object = { data: blobOf(jpeg), error: null };
    state.upload = { error: { message: 'Internal Server Error' } };
    state.rpc.set_asset_thumbnail = { error: { code: 'P0001', message: 'not_found' } };
    await expect(registerAssetAction(SLUG, ASSET, PATH, FILE)).resolves.toEqual({ ok: true, assetId: ASSET });

    // Stored, but the database refuses to record it.
    state.upload = { error: null };
    state.rpc.set_asset_thumbnail = { error: { code: 'P0001', message: 'forbidden' } };
    await expect(registerAssetAction(SLUG, ASSET, PATH, FILE)).resolves.toEqual({ ok: true, assetId: ASSET });

    // Even a throwing upload leaves the registration standing, with the database ready to record.
    state.storage = [];
    state.calls = [];
    state.upload = new Error('fetch failed');
    state.rpc.set_asset_thumbnail = {};
    await expect(registerAssetAction(SLUG, ASSET, PATH, FILE)).resolves.toEqual({ ok: true, assetId: ASSET });
    expect(state.storage.map((c) => c.method)).toEqual(['download', 'upload']);
    expect(state.calls.map((c) => c.name)).toEqual(['register_asset']);
  });

  it('makes no thumbnail when the registration fails', async () => {
    state.rpc.register_asset = { error: { code: 'P0001', message: 'forbidden' } };
    await expect(registerAssetAction(SLUG, ASSET, PATH, FILE)).resolves.toEqual({ ok: false, code: 'error' });
    expect(state.storage.map((c) => c.method)).toEqual(['download']);
    expect(state.calls.map((c) => c.name)).toEqual(['register_asset']);
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

const signedAt = (path: string): Signed => ({ data: { signedUrl: `http://127.0.0.1:54321/storage/v1/object/sign/media-private/${path}?token=t` }, error: null });
const NOT_SIGNED: Signed = { data: null, error: { message: 'Object not found' } };

describe('assetPreviewAction', () => {
  it("signs a 600-second URL for the file's thumbnail, the tenant taken from the asset row, and never reads the original", async () => {
    state.tables.asset_list = { data: row({ thumb_path: THUMB }) };
    state.signed = signedAt;
    await expect(assetPreviewAction(ASSET)).resolves.toEqual({
      ok: true,
      url: signedAt(THUMB).data!.signedUrl,
      thumbnail: true,
      defaultAlt: 'Brauð',
      focalX: 0.5,
      focalY: 0.25,
    });
    expect(state.queries.map((q) => [q.table, q.filters])).toEqual([
      ['asset_list', [['id', ASSET]]],
      ['my_tenants', [['id', TENANT_ID]]],
    ]);
    expect(state.queries[0]!.columns).toContain('thumb_path');
    expect(state.storage).toEqual([{ bucket: 'media-private', method: 'createSignedUrl', args: [THUMB, 600] }]);
    expect(state.calls).toEqual([]);
  });

  it('makes the thumbnail of an older file on first view, records it and signs it', async () => {
    state.signed = signedAt;
    await expect(assetPreviewAction(ASSET)).resolves.toMatchObject({ ok: true, url: signedAt(THUMB).data!.signedUrl, thumbnail: true });
    expect(state.storage.map((c) => [c.method, c.args[0]])).toEqual([
      ['download', PATH],
      ['upload', THUMB],
      ['createSignedUrl', THUMB],
    ]);
    expect(state.calls).toEqual([{ name: 'set_asset_thumbnail', args: { p_asset_id: ASSET, p_thumb_path: THUMB } }]);
  });

  it('signs the original when no thumbnail can be made, stored, recorded or signed', async () => {
    state.signed = signedAt;
    const original = { ok: true, url: signedAt(PATH).data!.signedUrl, thumbnail: false, defaultAlt: 'Brauð', focalX: 0.5, focalY: 0.25 };
    const cases: [string, () => void][] = [
      ['over the pixel cap', () => (state.object = { data: blobOf(overCap), error: null })],
      ['corrupt', () => (state.object = { data: blobOf(truncated), error: null })],
      ['the original unreadable', () => (state.object = { data: null, error: { message: 'Object not found' } })],
      ['not recorded', () => (state.rpc.set_asset_thumbnail = { error: { code: 'P0001', message: 'forbidden' } })],
      ['the upload throws', () => (state.upload = new Error('fetch failed'))],
      ['recorded but its object gone', () => (state.tables.asset_list = { data: row({ thumb_path: THUMB }) })],
    ];
    for (const [name, arrange] of cases) {
      state.object = { data: blobOf(jpeg), error: null };
      state.upload = { error: null };
      state.rpc.set_asset_thumbnail = {};
      state.tables.asset_list = { data: row() };
      state.signed = (path) => (path === THUMB && name === 'recorded but its object gone' ? NOT_SIGNED : signedAt(path));
      arrange();
      await expect(assetPreviewAction(ASSET), name).resolves.toEqual(original);
    }
  });

  it('signs nothing for an asset the editor cannot see, a suspended tenant or a malformed id', async () => {
    state.tables.asset_list = { data: null };
    await expect(assetPreviewAction(ASSET)).resolves.toEqual({ ok: false, code: 'error' });
    state.tables.asset_list = { data: row({ default_alt: null, focal_x: null, focal_y: null }) };
    state.tables.my_tenants = { data: { id: TENANT_ID, slug: SLUG, name: 'T', status: 'suspended' } };
    await expect(assetPreviewAction(ASSET)).resolves.toEqual({ ok: false, code: 'error' });
    await expect(assetPreviewAction('x')).resolves.toEqual({ ok: false, code: 'invalid' });
    await expect(assetPreviewAction(7 as unknown as string)).resolves.toEqual({ ok: false, code: 'invalid' });
    expect(state.storage).toEqual([]);
    expect(state.calls).toEqual([]);
  });

  it('answers auth without a session, and the generic error when nothing can be signed', async () => {
    state.user = null;
    await expect(assetPreviewAction(ASSET)).resolves.toEqual({ ok: false, code: 'auth' });
    expect(state.storage).toEqual([]);
    state.user = { id: 'u1' };
    state.signed = NOT_SIGNED;
    await expect(assetPreviewAction(ASSET)).resolves.toEqual({ ok: false, code: 'error' });
  });
});

describe('ensureThumbnailAction', () => {
  it('signs an existing thumbnail without reading the original', async () => {
    state.tables.asset_list = { data: row({ thumb_path: THUMB }) };
    state.signed = signedAt;
    await expect(ensureThumbnailAction(ASSET)).resolves.toEqual({ ok: true, url: signedAt(THUMB).data!.signedUrl });
    expect(state.storage).toEqual([{ bucket: 'media-private', method: 'createSignedUrl', args: [THUMB, 600] }]);
    expect(state.calls).toEqual([]);
  });

  it('makes, stores, records and signs a missing one', async () => {
    state.signed = signedAt;
    await expect(ensureThumbnailAction(ASSET)).resolves.toEqual({ ok: true, url: signedAt(THUMB).data!.signedUrl });
    expect(state.storage.map((c) => [c.method, c.args[0]])).toEqual([
      ['download', PATH],
      ['upload', THUMB],
      ['createSignedUrl', THUMB],
    ]);
    expect(state.calls).toEqual([{ name: 'set_asset_thumbnail', args: { p_asset_id: ASSET, p_thumb_path: THUMB } }]);
  });

  it('records an object a failed earlier attempt left in place', async () => {
    // Editors cannot overwrite: the upload says the object exists, and recording it still works.
    state.upload = { error: { message: 'The resource already exists' } };
    state.signed = signedAt;
    await expect(ensureThumbnailAction(ASSET)).resolves.toEqual({ ok: true, url: signedAt(THUMB).data!.signedUrl });
    expect(state.calls).toEqual([{ name: 'set_asset_thumbnail', args: { p_asset_id: ASSET, p_thumb_path: THUMB } }]);
  });

  it('answers the generic error, and never signs the original, when none can be made or recorded', async () => {
    state.object = { data: blobOf(overCap), error: null };
    await expect(ensureThumbnailAction(ASSET)).resolves.toEqual({ ok: false, code: 'error' });
    state.object = { data: blobOf(jpeg), error: null };
    state.rpc.set_asset_thumbnail = { error: { code: 'P0001', message: 'not_found' } };
    await expect(ensureThumbnailAction(ASSET)).resolves.toEqual({ ok: false, code: 'error' });
    state.rpc.set_asset_thumbnail = { error: { code: 'PGRST303', message: 'JWT expired' }, status: 401 };
    await expect(ensureThumbnailAction(ASSET)).resolves.toEqual({ ok: false, code: 'auth' });
    expect(state.storage.filter((c) => c.method === 'createSignedUrl')).toEqual([]);
  });

  it('checks the session, the id, the asset and its tenant before reading anything', async () => {
    await expect(ensureThumbnailAction('x')).resolves.toEqual({ ok: false, code: 'invalid' });
    await expect(ensureThumbnailAction(ASSET.toUpperCase())).resolves.toEqual({ ok: false, code: 'invalid' });
    await expect(ensureThumbnailAction(null as unknown as string)).resolves.toEqual({ ok: false, code: 'invalid' });
    state.user = null;
    await expect(ensureThumbnailAction(ASSET)).resolves.toEqual({ ok: false, code: 'auth' });
    state.user = { id: 'u1' };
    state.tables.asset_list = { data: null };
    await expect(ensureThumbnailAction(ASSET)).resolves.toEqual({ ok: false, code: 'error' });
    state.tables.asset_list = { data: row() };
    state.tables.my_tenants = { data: { id: TENANT_ID, slug: SLUG, name: 'T', status: 'suspended' } };
    await expect(ensureThumbnailAction(ASSET)).resolves.toEqual({ ok: false, code: 'error' });
    state.tables.asset_list = { error: { code: '42501', message: 'permission denied' } };
    await expect(ensureThumbnailAction(ASSET)).resolves.toEqual({ ok: false, code: 'error' });
    expect(state.storage).toEqual([]);
    expect(state.calls).toEqual([]);
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
    state.tables.asset_list = { data: row({ default_alt: null, focal_x: null, focal_y: null }) };
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
    state.tables.asset_list = { data: row({ default_alt: null, focal_x: null, focal_y: null }) };
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

describe('updateAssetTextAction', () => {
  const texts = { defaultAlt: 'Rúgbrauð á borði', caption: 'Nýbakað', credit: 'Þóra Ægisdóttir' };

  it('saves the three texts through update_asset_text, trimmed, an empty one as null', async () => {
    await expect(updateAssetTextAction(ASSET, texts)).resolves.toEqual({ ok: true });
    await expect(updateAssetTextAction(ASSET, { defaultAlt: '  Brauð ', caption: '   ', credit: '' })).resolves.toEqual({ ok: true });
    await expect(updateAssetTextAction(ASSET, { defaultAlt: null, caption: null, credit: null })).resolves.toEqual({ ok: true });
    expect(state.calls).toEqual([
      { name: 'update_asset_text', args: { p_asset_id: ASSET, p_default_alt: 'Rúgbrauð á borði', p_caption: 'Nýbakað', p_credit: 'Þóra Ægisdóttir' } },
      { name: 'update_asset_text', args: { p_asset_id: ASSET, p_default_alt: 'Brauð', p_caption: null, p_credit: null } },
      { name: 'update_asset_text', args: { p_asset_id: ASSET, p_default_alt: null, p_caption: null, p_credit: null } },
    ]);
  });

  it('rejects texts past their limits, missing or extra keys and malformed ids without reading or calling the database', async () => {
    for (const args of [
      ['x', texts],
      [ASSET, { ...texts, defaultAlt: 'x'.repeat(1001) }],
      [ASSET, { ...texts, caption: 'x'.repeat(1001) }],
      [ASSET, { ...texts, credit: 'x'.repeat(301) }],
      [ASSET, { defaultAlt: 'a', caption: 'b' }],
      [ASSET, { ...texts, focal: { x: 0.5, y: 0.5 } }],
      [ASSET, { ...texts, credit: 1 }],
      [ASSET, null],
    ] as const) {
      await expect(updateAssetTextAction(...(args as unknown as Parameters<typeof updateAssetTextAction>))).resolves.toEqual({ ok: false, code: 'invalid' });
    }
    expect(state.calls).toEqual([]);
    expect(state.queries).toEqual([]);
  });

  it('accepts texts exactly at their limits', async () => {
    await expect(updateAssetTextAction(ASSET, { defaultAlt: 'a'.repeat(1000), caption: 'b'.repeat(1000), credit: 'c'.repeat(300) })).resolves.toEqual({ ok: true });
  });

  it('refuses an asset it cannot see or of a suspended tenant, and maps database errors to the generic error', async () => {
    state.tables.asset_list = { data: null };
    await expect(updateAssetTextAction(ASSET, texts)).resolves.toEqual({ ok: false, code: 'error' });
    state.tables.asset_list = { data: row() };
    state.tables.my_tenants = { data: { id: TENANT_ID, slug: SLUG, name: 'T', status: 'suspended' } };
    await expect(updateAssetTextAction(ASSET, texts)).resolves.toEqual({ ok: false, code: 'error' });
    expect(state.calls).toEqual([]);
    state.tables.my_tenants = { data: { id: TENANT_ID, slug: SLUG, name: 'T', status: 'active' } };
    for (const message of ['not_found', 'tenant_inactive']) {
      state.rpc.update_asset_text = { error: { code: 'P0001', message } };
      await expect(updateAssetTextAction(ASSET, texts)).resolves.toEqual({ ok: false, code: 'error' });
    }
    state.rpc.update_asset_text = { error: { code: '23514', message: 'assets_credit_length' } };
    await expect(updateAssetTextAction(ASSET, texts)).resolves.toEqual({ ok: false, code: 'error' });
  });

  it('answers auth without a session or with an expired one', async () => {
    state.user = null;
    await expect(updateAssetTextAction(ASSET, texts)).resolves.toEqual({ ok: false, code: 'auth' });
    state.user = { id: 'u1' };
    state.rpc.update_asset_text = { error: { code: 'PGRST301', message: 'JWT expired' }, status: 401 };
    await expect(updateAssetTextAction(ASSET, texts)).resolves.toEqual({ ok: false, code: 'auth' });
  });
});
