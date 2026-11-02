// Unit tests of the release build (plan Task 20, decisions 34 and 35; spec §5.6, §7.1, §7.2) with a
// fake admin client and an in-memory storage stub: the two-pass omission, the failure path at each
// step, the storage calls' exact options, and https media URLs (decision 34.3: real URLs are
// https; the local stack's are http, so the integration tests prove media at the storage level).
// The database's side runs against the local stack in build-release.integration.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  ProjectionError,
  defineModule,
  defineType,
  entryContentHash,
  image,
  link,
  resolveEntry,
  text,
  type FieldKind,
} from '@litljomi/cms-schema';
import type { Bundle, Pointer } from '@litljomi/cms-sdk';

type Call = { fn: string; args: Record<string, unknown> };
type Reply = { data?: unknown; error?: { code: string; message: string } };

const calls: Call[] = [];
let handlers: Record<string, (args: Record<string, unknown>) => Reply> = {};
const fakeClient = {
  rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    const handler = handlers[fn];
    if (!handler) throw new Error(`unexpected rpc ${fn}`);
    const reply = handler(args);
    return { data: reply.data ?? null, error: reply.error ?? null };
  }),
};
vi.mock('../../admin-client', () => ({ createAdminClient: () => fakeClient }));
const alertMock = vi.fn(async (_event: string, _details: Record<string, unknown>) => {});
vi.mock('../alerts', () => ({ alert: (event: string, details: Record<string, unknown>) => alertMock(event, details) }));

const article = defineType({
  name: 'article',
  version: 2,
  label: 'Grein',
  fields: {
    title: text({ label: 'Titill', required: true }),
    pic: image({ label: 'Mynd' }),
    related: link({ label: 'Tengt' }),
  },
  preview: { title: 'title' },
  orderBy: 'title',
});
// A field whose projection fails when its target entry does not resolve, so an omission cascades.
const targetSchema = z.strictObject({ _ref: z.string(), _kind: z.literal('entry') });
const requiredTarget: FieldKind<{ _ref: string; _kind: 'entry' }, unknown> = {
  kind: 'link',
  label: 'Markmið',
  required: true,
  draftSchema: () => targetSchema,
  publishSchema: () => targetSchema,
  project: (v, ctx) => {
    if (v == null) return null;
    const e = resolveEntry(ctx, v._ref);
    if (e === null) throw new ProjectionError('pair', [{ code: 'custom', path: ['target'], message: 'target missing', input: v }]);
    return e;
  },
  tsType: () => 'unknown',
  withOptions: () => requiredTarget,
};
const pair = defineType({
  name: 'pair',
  version: 1,
  label: 'Par',
  fields: { target: requiredTarget },
  preview: { title: 'target' },
  orderBy: 'target',
});
const testModule = defineModule({
  tenant: 'prufa',
  locale: 'is',
  branding: { name: 'Prufa' },
  types: [article, pair],
  structure: [],
  site: { article: { path: (e) => `/greinar/${e.slug}`, checks: () => [] } },
});
vi.mock('@/modules/registry', () => ({
  getModule: (slug: string) => (slug === 'prufa' ? testModule : undefined),
  getType: (slug: string, type: string) => (slug === 'prufa' ? testModule.types.find((t) => t.name === type) : undefined),
}));

const { buildRelease, BUNDLE_CACHE_CONTROL, MAX_STORED_OMISSION_DETAILS, POINTER_CACHE_CONTROL, POINTER_DEADLINE_MS, supabaseReleaseStorage } =
  await import('../build-release');
type ReleaseStorage = import('../build-release').ReleaseStorage;

const TENANT = '00000000-0000-4000-8000-00000000a009';
const RELEASE = '00000000-0000-4000-8000-0000000000c1';
const E1 = '11111111-1111-4111-8111-111111111111';
const E2 = '22222222-2222-4222-8222-222222222222';
const E3 = '33333333-3333-4333-8333-333333333333';
const A1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const A2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const STAMP = '2026-11-02T09:00:00.000Z';
const mediaUrl = (p: string) => `https://media.test/${p}`;
const now = () => new Date(STAMP);

type SnapEntry = {
  entry_id: string;
  type: string;
  slug: string | null;
  revision_id: string;
  schema_version: number;
  data: unknown;
  title: string | null;
  sort_at: string | null;
  first_published_at: string;
  last_published_at: string;
  refs: Array<{ path: string; kind: 'entry' | 'asset'; id: string }>;
};
const entry = (id: string, data: Record<string, unknown>, o: Partial<SnapEntry> = {}): SnapEntry => ({
  entry_id: id,
  type: 'article',
  slug: `s-${id.slice(0, 4)}`,
  revision_id: id.replace(/^./, 'f'),
  schema_version: 2,
  data,
  title: String(data.title ?? ''),
  sort_at: null,
  first_published_at: '2026-11-01T10:00:00+00:00',
  last_published_at: '2026-11-02T10:00:00.123456+00:00',
  refs: [],
  ...o,
});
const asset = (id: string, o: Record<string, unknown> = {}) => ({
  id,
  original_path: `${TENANT}/${id}/a.jpg`,
  filename: 'a.jpg',
  mime: 'image/jpeg',
  width: 800,
  height: 600,
  focal_x: null,
  focal_y: null,
  default_alt: 'alt',
  public_path: null,
  archived: false,
  ...o,
});
const picRef = (id: string) => ({ path: '$."pic"', kind: 'asset' as const, id });
const relRef = (id: string) => ({ path: '$."related"."entry"', kind: 'entry' as const, id });

let snapshot: { entries: SnapEntry[]; assets: ReturnType<typeof asset>[]; requests: Array<{ id: string; entry_id: string; action: string; revision_id: string | null }> };
let previous: Record<string, unknown>;

/** An in-memory storage stub; `fail` makes one operation throw. */
function memoryStorage() {
  const objects = new Map<string, { body: Uint8Array; cacheControl?: string; contentType?: string }>();
  const ops: string[] = [];
  const fail: { upload?: (path: string) => boolean; download?: (path: string) => boolean; copy?: (path: string) => boolean } = {};
  const tamper: { download?: (path: string, body: Uint8Array) => Uint8Array } = {};
  const storage: ReleaseStorage = {
    async upload(bucket, path, body, o) {
      ops.push(`upload ${bucket}/${path}`);
      if (fail.upload?.(path)) throw new Error(`upload failed: ${path}`);
      const key = `${bucket}/${path}`;
      if (!o.upsert && objects.has(key)) throw new Error('exists');
      objects.set(key, { body, cacheControl: o.cacheControl, contentType: o.contentType });
    },
    async download(bucket, path) {
      ops.push(`download ${bucket}/${path}`);
      if (fail.download?.(path)) throw new Error(`download failed: ${path}`);
      const o = objects.get(`${bucket}/${path}`);
      if (!o) throw new Error(`not found: ${bucket}/${path}`);
      return tamper.download ? tamper.download(path, o.body) : o.body;
    },
    async copy(from, to) {
      ops.push(`copy ${from.bucket}/${from.path} -> ${to.bucket}/${to.path}`);
      if (fail.copy?.(to.path)) throw new Error(`copy failed: ${to.path}`);
      const key = `${to.bucket}/${to.path}`;
      if (objects.has(key)) return 'exists';
      const src = objects.get(`${from.bucket}/${from.path}`);
      if (!src) throw new Error(`not found: ${from.bucket}/${from.path}`);
      objects.set(key, src);
      return 'copied';
    },
  };
  const put = (key: string, value: unknown) => objects.set(key, { body: new TextEncoder().encode(JSON.stringify(value)) });
  const json = <T>(key: string): T => JSON.parse(new TextDecoder().decode(objects.get(key)!.body)) as T;
  return { storage, objects, ops, fail, tamper, put, json };
}

let mem: ReturnType<typeof memoryStorage>;
/** The worker's clock (ms): begin_release succeeds at 0; `clockAt` is what it reads after that. */
let clockAt: number;
let clockReads: number;
const clock = () => (clockReads++ === 0 ? 0 : clockAt);
const build = () => buildRelease(TENANT, { storage: mem.storage, mediaUrl, now, clock });
const finishCalls = () => calls.filter((c) => c.fn === 'worker_finish_release').map((c) => c.args);

beforeEach(() => {
  calls.length = 0;
  alertMock.mockClear();
  clockAt = 1_000;
  clockReads = 0;
  mem = memoryStorage();
  mem.objects.set(`media-private/${TENANT}/${A1}/a.jpg`, { body: new Uint8Array([1]) });
  mem.objects.set(`media-private/${TENANT}/${A2}/a.jpg`, { body: new Uint8Array([2]) });
  snapshot = {
    entries: [
      entry(E1, { title: 'Eitt', pic: { _ref: A1, _kind: 'asset', alt: 'mynd' }, related: { entry: { _ref: E2, _kind: 'entry' } } }, {
        refs: [picRef(A1), relRef(E2)],
        sort_at: '2026-10-15T00:00:00+00:00',
      }),
      entry(E2, { title: 'Tvö' }),
    ],
    assets: [asset(A1)],
    requests: [
      { id: 'r1', entry_id: E1, action: 'publish', revision_id: 'x' },
      { id: 'r2', entry_id: E2, action: 'publish', revision_id: 'y' },
      { id: 'r3', entry_id: E3, action: 'unpublish', revision_id: null },
    ],
  };
  previous = { id: null, number: null, bundle_path: null };
  handlers = {
    worker_begin_release: () => ({ data: { id: RELEASE, tenant_id: TENANT, number: 3, status: 'building' } }),
    worker_previous_release: () => ({ data: previous }),
    worker_release_snapshot: () => ({
      data: { release: { id: RELEASE, tenant_id: TENANT, number: 3, status: 'building' }, tenant: { id: TENANT, slug: 'prufa' }, ...snapshot },
    }),
    worker_pointer_check: () => ({ data: [{ building: true, latest_delivered: null }] }),
    worker_finish_release: () => ({ data: null }),
  };
});

const OLD_POINTER: Pointer = { format: 1, tenant: 'prufa', release: 2, bundle: 'releases/2.json', generatedAt: STAMP };
/** A delivered release 2 whose bundle and pointer are in storage. */
const withPreviousRelease = () => {
  mem.put('delivery/prufa/releases/2.json', { format: 1, tenant: 'prufa', release: 2, generatedAt: STAMP, entries: {} });
  mem.put('delivery/prufa/current.json', OLD_POINTER);
  previous = { id: 'prev', number: 2, bundle_path: 'prufa/releases/2.json', status: 'delivered' };
};

describe('buildRelease: delivery', () => {
  it('writes the bundle, reads it back, writes the pointer, reads it back, then finishes delivered', async () => {
    const result = await build();

    expect(result.status).toBe('delivered');
    expect(result).toMatchObject({ releaseId: RELEASE, number: 3, omitted: [], previousBundle: null });
    // Every linked request is returned for the live checks (Task 21).
    expect(result.requests).toEqual([
      { id: 'r1', entryId: E1, action: 'publish' },
      { id: 'r2', entryId: E2, action: 'publish' },
      { id: 'r3', entryId: E3, action: 'unpublish' },
    ]);
    expect(mem.ops).toEqual([
      `copy media-private/${TENANT}/${A1}/a.jpg -> media-public/prufa/${A1}/a.jpg`,
      'upload delivery/prufa/releases/3.json',
      'download delivery/prufa/releases/3.json',
      // The current pointer is read before it is replaced (decision 37.1 (c)); none yet here.
      'download delivery/prufa/current.json',
      'upload delivery/prufa/current.json',
      'download delivery/prufa/current.json',
    ]);
    const bundleObject = mem.objects.get('delivery/prufa/releases/3.json')!;
    expect(bundleObject.cacheControl).toBe(BUNDLE_CACHE_CONTROL);
    expect(bundleObject.contentType).toBe('application/json');
    expect(mem.objects.get('delivery/prufa/current.json')!.cacheControl).toBe(POINTER_CACHE_CONTROL);
    expect(mem.json<Pointer>('delivery/prufa/current.json')).toEqual({
      format: 1,
      tenant: 'prufa',
      release: 3,
      bundle: 'releases/3.json',
      generatedAt: STAMP,
    });
    expect(mem.json<Bundle>('delivery/prufa/releases/3.json')).toEqual(result.bundle);
    expect(finishCalls()).toEqual([
      {
        p_release_id: RELEASE,
        p_status: 'delivered',
        p_bundle_path: 'prufa/releases/3.json',
        p_error: null,
        p_request_ids: ['r1', 'r2', 'r3'],
        p_public_assets: [{ id: A1, public_path: `prufa/${A1}/a.jpg` }],
      },
    ]);
    expect(calls.map((c) => c.fn)).toEqual([
      'worker_begin_release',
      'worker_previous_release',
      'worker_release_snapshot',
      'worker_pointer_check',
      'worker_finish_release',
    ]);
    expect(calls.find((c) => c.fn === 'worker_pointer_check')!.args).toEqual({ p_release_id: RELEASE });
    expect(alertMock).not.toHaveBeenCalled();
  });

  it('builds each entry as §7.2 describes, with contentHash over the record minus contentHash', async () => {
    const { bundle } = await build();

    expect(bundle).toMatchObject({ format: 1, tenant: 'prufa', release: 3, generatedAt: STAMP });
    expect(Object.keys(bundle!.entries)).toEqual(['article']);
    const [one, two] = bundle!.entries['article']!;
    expect(one).toEqual({
      id: E1,
      revisionId: snapshot.entries[0]!.revision_id,
      contentHash: entryContentHash(one as unknown as Record<string, unknown>),
      slug: snapshot.entries[0]!.slug,
      title: 'Eitt',
      sortAt: '2026-10-15T00:00:00.000Z',
      firstPublishedAt: '2026-11-01T10:00:00.000Z',
      lastPublishedAt: '2026-11-02T10:00:00.123Z',
      schemaVersion: 2,
      data: {
        title: 'Eitt',
        pic: { id: A1, url: `https://media.test/prufa/${A1}/a.jpg`, width: 800, height: 600, mime: 'image/jpeg', alt: 'mynd', focal: null },
        related: { entry: { id: E2, type: 'article', slug: two!.slug, title: 'Tvö', path: `/greinar/${two!.slug}` } },
      },
    });
    expect(Object.keys(one!)).toEqual([
      'id', 'revisionId', 'contentHash', 'slug', 'title', 'sortAt', 'firstPublishedAt', 'lastPublishedAt', 'schemaVersion', 'data',
    ]);
    expect(two!.data).toEqual({ title: 'Tvö', pic: null, related: null });
    expect(one!.contentHash).not.toBe(two!.contentHash);
  });

  it('reads the previous release right after beginning and returns its bundle', async () => {
    const old: Bundle = { format: 1, tenant: 'prufa', release: 2, generatedAt: STAMP, entries: {} };
    withPreviousRelease();

    const result = await build();

    expect(result.status).toBe('delivered');
    expect(result.previousBundle).toEqual(old);
    expect(mem.ops[0]).toBe('download delivery/prufa/releases/2.json');
    expect(mem.json<Pointer>('delivery/prufa/current.json').release).toBe(3);
    expect(calls.map((c) => c.fn).slice(0, 3)).toEqual(['worker_begin_release', 'worker_previous_release', 'worker_release_snapshot']);
  });

  it('a media copy whose destination already exists counts as success', async () => {
    mem.objects.set(`media-public/prufa/${A1}/a.jpg`, { body: new Uint8Array([1]) });

    const result = await build();

    expect(result.status).toBe('delivered');
    expect(finishCalls()[0]!.p_public_assets).toEqual([{ id: A1, public_path: `prufa/${A1}/a.jpg` }]);
  });

  it('does not copy an asset that is already public, and resolves it from its public path', async () => {
    snapshot.assets = [asset(A1, { public_path: `prufa/${A1}/a.jpg` })];

    const result = await build();

    expect(mem.ops.some((o) => o.startsWith('copy'))).toBe(false);
    expect(finishCalls()[0]!.p_public_assets).toEqual([]);
    expect((result.bundle!.entries['article']![0]!.data as { pic: { url: string } }).pic.url).toBe(`https://media.test/prufa/${A1}/a.jpg`);
  });

  it('an archived asset is neither copied nor resolved', async () => {
    snapshot.assets = [asset(A1, { archived: true })];

    const result = await build();

    expect(result.status).toBe('delivered');
    expect(mem.ops.some((o) => o.startsWith('copy'))).toBe(false);
    expect((result.bundle!.entries['article']![0]!.data as { pic: unknown }).pic).toBeNull();
  });

  it('a tenant with no published entries gets an empty bundle', async () => {
    snapshot = { entries: [], assets: [], requests: [] };

    const result = await build();

    expect(result.status).toBe('delivered');
    expect(result.bundle!.entries).toEqual({});
    expect(finishCalls()[0]!.p_request_ids).toEqual([]);
  });
});

describe('buildRelease: entries left out (fail closed, §7.1)', () => {
  it('omits an entry that fails projection; other entries resolve it to null; records and alerts', async () => {
    // E2's stored revision no longer validates (title is required); E1 references E2 and A1; E2 references A2.
    snapshot.entries[1] = entry(E2, { pic: { _ref: A2, _kind: 'asset', alt: '' } }, { refs: [picRef(A2)] });
    snapshot.assets = [asset(A1), asset(A2)];

    const result = await build();

    expect(result.status).toBe('delivered');
    const ids = result.bundle!.entries['article']!.map((e) => e.id);
    expect(ids).toEqual([E1]);
    expect((result.bundle!.entries['article']![0]!.data as { related: unknown }).related).toEqual({ entry: null });
    expect(result.omitted).toEqual([
      { entryId: E2, requestIds: ['r2'], error: { code: 'projection_failed', issues: [expect.objectContaining({ path: ['title'] })] } },
    ]);
    // Only assets of included entries are copied.
    expect(mem.ops.filter((o) => o.startsWith('copy'))).toEqual([
      `copy media-private/${TENANT}/${A1}/a.jpg -> media-public/prufa/${A1}/a.jpg`,
    ]);
    const finish = finishCalls()[0]!;
    expect(finish.p_status).toBe('delivered');
    expect(finish.p_error).toEqual({ omitted: result.omitted });
    expect(finish.p_request_ids).toEqual(['r1', 'r2', 'r3']);
    expect(finish.p_public_assets).toEqual([{ id: A1, public_path: `prufa/${A1}/a.jpg` }]);
    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(alertMock).toHaveBeenCalledWith('release.entry_omitted', {
      tenantId: TENANT,
      releaseId: RELEASE,
      number: 3,
      omitted: result.omitted,
    });
  });

  it('repeats until no included entry refers to one left out (an omission can cascade)', async () => {
    // E2 fails validation; E3 (a pair) needs E2, so it fails once E2 is left out; E1 links to E3.
    snapshot.entries[0]!.data = { title: 'Eitt', related: { entry: { _ref: E3, _kind: 'entry' } } };
    snapshot.entries[0]!.refs = [relRef(E3)];
    snapshot.entries[1] = entry(E2, {});
    snapshot.entries.push(entry(E3, { target: { _ref: E2, _kind: 'entry' } }, { type: 'pair', schema_version: 1, title: null, refs: [relRef(E2)] }));

    const result = await build();

    expect(result.omitted.map((o) => o.entryId)).toEqual([E2, E3]);
    expect(result.omitted[1]!.error).toMatchObject({ code: 'projection_failed', issues: [expect.objectContaining({ path: ['target'] })] });
    expect(Object.values(result.bundle!.entries).flat().map((e) => e.id)).toEqual([E1]);
    expect((result.bundle!.entries['article']![0]!.data as { related: unknown }).related).toEqual({ entry: null });
  });

  it('omits an entry whose revision is at another schema version (no transforms in M1), or of an unknown type', async () => {
    snapshot.entries[1] = entry(E2, { title: 'Tvö' }, { schema_version: 1 });
    snapshot.entries.push(entry(E3, { title: 'Þrjú' }, { type: 'gone' }));

    const result = await build();

    expect(result.status).toBe('delivered');
    expect(result.omitted).toEqual([
      { entryId: E2, requestIds: ['r2'], error: { code: 'schema_version', revisionSchemaVersion: 1, currentSchemaVersion: 2 } },
      { entryId: E3, requestIds: ['r3'], error: { code: 'unknown_type', type: 'gone' } },
    ]);
    // E1 still links to E2, which is now left out.
    expect((result.bundle!.entries['article']![0]!.data as { related: unknown }).related).toEqual({ entry: null });
  });

  it.each([
    ['a filename with a backslash', { filename: 'a\\b.jpg', original_path: `${TENANT}/${A1}/a\\b.jpg` }],
    ['a filename with a control character', { filename: 'a\u0001.jpg', original_path: `${TENANT}/${A1}/a\u0001.jpg` }],
    ['an original path that is not {tenant_id}/{asset_id}/{filename}', { original_path: `${TENANT}/${A1}/../x/a.jpg` }],
  ])('omits an entry whose asset has %s, and copies nothing for it', async (_name, o) => {
    snapshot.assets = [asset(A1, o)];

    const result = await build();

    expect(result.status).toBe('delivered');
    expect(result.omitted).toEqual([{ entryId: E1, requestIds: ['r1'], error: { code: 'asset_path_invalid', assetId: A1 } }]);
    expect(mem.ops.some((x) => x.startsWith('copy'))).toBe(false);
  });
});

describe('buildRelease: busy and failures', () => {
  it('returns busy when a build is running (begin_release returns a row of nulls)', async () => {
    handlers.worker_begin_release = () => ({ data: { id: null, tenant_id: null, number: null, status: null } });

    expect(await build()).toEqual({ status: 'busy', omitted: [] });
    expect(calls.map((c) => c.fn)).toEqual(['worker_begin_release']);
    expect(mem.ops).toEqual([]);
  });

  const expectFailed = async (step: string, pointerWritten: boolean | null, code = 'build_failed') => {
    const result = await build();
    expect(result).toMatchObject({ status: 'failed', releaseId: RELEASE, number: 3 });
    const finish = finishCalls();
    expect(finish).toHaveLength(1);
    expect(finish[0]).toMatchObject({ p_status: 'failed', p_bundle_path: null, p_request_ids: null, p_public_assets: null });
    expect(finish[0]!.p_error).toMatchObject({ code, step, pointerWritten });
    expect(alertMock).toHaveBeenCalledWith('release.failed', expect.objectContaining({ tenantId: TENANT, releaseId: RELEASE, code, step, pointerWritten }));
    return result;
  };

  it('a pointer upload failure leaves the pointer at the old release and fails the release', async () => {
    mem.put('delivery/prufa/current.json', OLD_POINTER);
    mem.fail.upload = (p) => p.endsWith('current.json');

    await expectFailed('pointer_upload', false);
    expect(mem.json<Pointer>('delivery/prufa/current.json').release).toBe(2);
  });

  // Task 20 quality r1, Minor 1: the other two states of pointerWritten.
  it('a pointer upload that throws after the object was stored records the pointer as written', async () => {
    const upload = mem.storage.upload;
    mem.storage.upload = async (bucket, path, body, o) => {
      await upload(bucket, path, body, o);
      if (path.endsWith('current.json')) throw new Error('connection reset after the write');
    };

    await expectFailed('pointer_upload', true);
    expect(mem.json<Pointer>('delivery/prufa/current.json').release).toBe(3);
  });

  it('a pointer upload failure whose read-back also fails records pointerWritten as unknown (null)', async () => {
    mem.put('delivery/prufa/current.json', OLD_POINTER);
    mem.fail.upload = (p) => p.endsWith('current.json');
    let pointerReads = 0;
    mem.fail.download = (p) => p.endsWith('current.json') && ++pointerReads > 1;

    await expectFailed('pointer_upload', null);
  });

  it('a bundle that reads back different fails before the pointer is written', async () => {
    mem.tamper.download = (p, body) => (p.endsWith('3.json') ? new Uint8Array([...body, 32]) : body);

    await expectFailed('bundle_verify', false);
    expect(mem.ops.some((o) => o.includes('current.json'))).toBe(false);
  });

  it('a pointer that reads back another release fails the release; the pointer was written', async () => {
    mem.tamper.download = (p, body) =>
      p.endsWith('current.json') ? new TextEncoder().encode(new TextDecoder().decode(body).replace('"release":3', '"release":2')) : body;

    await expectFailed('pointer_verify', true);
  });

  it('a failed media copy fails the release', async () => {
    mem.fail.copy = () => true;
    await expectFailed('copy_media', false);
    expect(mem.ops.some((o) => o.includes('delivery/'))).toBe(false);
  });

  it('a bundle upload failure fails the release', async () => {
    mem.fail.upload = (p) => p.endsWith('3.json');
    await expectFailed('bundle_upload', false);
  });

  it('a previous bundle that cannot be read fails the release (an alert, as before Task 30)', async () => {
    previous = { id: 'prev', number: 2, bundle_path: 'prufa/releases/2.json', status: 'delivered' };
    await expectFailed('previous_bundle', false);
    expect(mem.ops).toEqual(['download delivery/prufa/releases/2.json']);
  });

  it('a tenant without a module fails the release (nothing is withdrawn)', async () => {
    handlers.worker_release_snapshot = () => ({
      data: { release: { id: RELEASE, tenant_id: TENANT, number: 3, status: 'building' }, tenant: { id: TENANT, slug: 'onnur' }, ...snapshot },
    });
    await expectFailed('module', false);
  });

  it('a finish that fails after the pointer moved marks the release failed and leaves the pointer as it is (no repair)', async () => {
    withPreviousRelease();
    let first = true;
    handlers.worker_finish_release = () => {
      if (first) {
        first = false;
        return { error: { code: '57014', message: 'canceling statement due to statement timeout' } };
      }
      return { data: null };
    };
    const result = await build();
    expect(result.status).toBe('failed');
    const finish = finishCalls();
    expect(finish.map((f) => f.p_status)).toEqual(['delivered', 'failed']);
    expect(finish[1]!.p_error).toMatchObject({ code: 'build_failed', step: 'finish', pointerWritten: true });
    // Decision 37.1 (d): the pointer stays at 3; it is never written back to 2.
    expect(mem.json<Pointer>('delivery/prufa/current.json').release).toBe(3);
    expect(mem.ops.filter((o) => o === 'upload delivery/prufa/current.json')).toHaveLength(1);
    expect(alertMock).toHaveBeenCalledWith('release.failed', expect.objectContaining({ step: 'finish', pointerWritten: true }));
  });
});

// Decisions 36.2 and 37.1: the pointer only ever moves forward, and a release the sweep failed as
// stale is never revived.
describe('buildRelease: the pointer only moves forward', () => {
  const expectRefused = async (step: string) => {
    const result = await build();
    expect(result).toMatchObject({ status: 'failed', releaseId: RELEASE, number: 3 });
    // current.json is unchanged: never uploaded.
    expect(mem.ops).not.toContain('upload delivery/prufa/current.json');
    expect(mem.json<Pointer>('delivery/prufa/current.json')).toEqual(OLD_POINTER);
    expect(finishCalls()).toEqual([
      expect.objectContaining({ p_status: 'failed', p_request_ids: null, p_public_assets: null }),
    ]);
    expect(finishCalls()[0]!.p_error).toMatchObject({ code: 'pointer_refused', step, pointerWritten: false });
    expect(alertMock).toHaveBeenCalledWith(
      'release.failed',
      expect.objectContaining({ tenantId: TENANT, releaseId: RELEASE, number: 3, code: 'pointer_refused', step, pointerWritten: false }),
    );
    return result;
  };

  beforeEach(() => withPreviousRelease());

  it(`(a) once ${POINTER_DEADLINE_MS} ms have passed since begin_release, no pointer is written`, async () => {
    expect(POINTER_DEADLINE_MS).toBe(270_000);
    clockAt = POINTER_DEADLINE_MS;
    await expectRefused('pointer_deadline');
  });

  it('(a) just before the deadline the pointer is written', async () => {
    clockAt = POINTER_DEADLINE_MS - 1;
    expect((await build()).status).toBe('delivered');
    expect(mem.json<Pointer>('delivery/prufa/current.json').release).toBe(3);
  });

  it('(b) a release that is no longer building (the sweep failed it) writes no pointer', async () => {
    handlers.worker_pointer_check = () => ({ data: [{ building: false, latest_delivered: 2 }] });
    await expectRefused('pointer_check');
  });

  it.each([3, 4])('(b) a delivered release numbered %i (≥ 3) writes no pointer', async (n) => {
    handlers.worker_pointer_check = () => ({ data: [{ building: true, latest_delivered: n }] });
    await expectRefused('pointer_check');
  });

  it('(b) a check that cannot be made writes no pointer', async () => {
    handlers.worker_pointer_check = () => ({ error: { code: '57014', message: 'canceling statement due to statement timeout' } });
    const result = await build();
    expect(result.status).toBe('failed');
    expect(mem.json<Pointer>('delivery/prufa/current.json')).toEqual(OLD_POINTER);
    expect(finishCalls()[0]!.p_error).toMatchObject({ code: 'build_failed', step: 'pointer_check', pointerWritten: false });
  });

  it.each([3, 9])('(c) a current pointer that already names release %i (≥ 3) is not replaced', async (n) => {
    const newer = { ...OLD_POINTER, release: n, bundle: `releases/${n}.json` };
    mem.put('delivery/prufa/current.json', newer);
    const result = await build();
    expect(result.status).toBe('failed');
    expect(mem.ops).not.toContain('upload delivery/prufa/current.json');
    expect(mem.json<Pointer>('delivery/prufa/current.json')).toEqual(newer);
    expect(finishCalls()[0]!.p_error).toMatchObject({ code: 'pointer_refused', step: 'pointer_current', pointerWritten: false });
  });

  it('(c) a current pointer that cannot be read, while a delivered release exists, is not replaced', async () => {
    mem.objects.delete('delivery/prufa/current.json');
    const result = await build();
    expect(result.status).toBe('failed');
    expect(mem.ops).not.toContain('upload delivery/prufa/current.json');
    expect(finishCalls()[0]!.p_error).toMatchObject({ code: 'build_failed', step: 'pointer_current', pointerWritten: false });
  });

  it('(c) a current pointer of another tenant is not replaced', async () => {
    mem.put('delivery/prufa/current.json', { ...OLD_POINTER, tenant: 'onnur' });
    expect((await build()).status).toBe('failed');
    expect(mem.ops).not.toContain('upload delivery/prufa/current.json');
    expect(finishCalls()[0]!.p_error).toMatchObject({ step: 'pointer_current' });
  });

  it('a finish refused after the pointer was written (the sweep failed the release) is a failed build with its own alert; the pointer stays', async () => {
    handlers.worker_finish_release = () => ({ error: { code: 'P0001', message: 'forbidden' } });

    const result = await build();

    expect(result).toMatchObject({ status: 'failed', releaseId: RELEASE, number: 3 });
    // The release is not building any more: nothing tries to finish it again.
    expect(finishCalls().map((f) => f.p_status)).toEqual(['delivered']);
    // Decision 37.1 (d): no repair. The pointer stays at 3; the requests stay unlinked, so the
    // next sweep builds a newer release.
    expect(mem.json<Pointer>('delivery/prufa/current.json').release).toBe(3);
    expect(mem.ops.filter((o) => o === 'upload delivery/prufa/current.json')).toHaveLength(1);
    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(alertMock).toHaveBeenCalledWith(
      'release.finish_refused',
      expect.objectContaining({ tenantId: TENANT, releaseId: RELEASE, number: 3, code: 'finish_refused', step: 'finish', pointerWritten: true }),
    );
  });

  it('when the failed marking is refused as well (the release was failed as stale), the build logs it and is not retried', async () => {
    mem.fail.copy = () => true;
    handlers.worker_finish_release = () => ({ error: { code: 'P0001', message: 'forbidden' } });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await build();

    expect(result.status).toBe('failed');
    expect(finishCalls().map((f) => f.p_status)).toEqual(['failed']);
    expect(alertMock).toHaveBeenCalledWith('release.failed', expect.objectContaining({ step: 'copy_media', pointerWritten: false }));
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('could not be marked failed'), expect.anything());
    logged.mockRestore();
  });
});

describe('buildRelease: what is stored', () => {
  // Task 20 quality r1, Minor 6: a mass-invalid tenant does not bloat releases.error.
  it(`keeps the details of the first ${MAX_STORED_OMISSION_DETAILS} omitted entries, and only the code of the rest`, async () => {
    const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    snapshot.entries = Array.from({ length: MAX_STORED_OMISSION_DETAILS + 5 }, (_, i) => entry(id(i), { title: 'x' }, { type: 'gone' }));
    snapshot.requests = [];

    const result = await build();

    expect(result.status).toBe('delivered');
    expect(result.omitted).toHaveLength(MAX_STORED_OMISSION_DETAILS + 5);
    const stored = (finishCalls()[0]!.p_error as { omitted: Array<{ entryId: string; error: unknown }> }).omitted;
    // Every omitted entry is stored (publication status needs each), the details only for the first ones.
    expect(stored.map((o) => o.entryId)).toEqual(result.omitted.map((o) => o.entryId));
    expect(stored[0]!.error).toEqual({ code: 'unknown_type', type: 'gone' });
    expect(stored[MAX_STORED_OMISSION_DETAILS - 1]!.error).toEqual({ code: 'unknown_type', type: 'gone' });
    expect(stored[MAX_STORED_OMISSION_DETAILS]!.error).toEqual({ code: 'unknown_type' });
    expect((alertMock.mock.calls[0]![1] as { omitted: unknown }).omitted).toEqual(stored);
  });

  // Task 20 quality r1, Minor 7.
  it('throws before beginning when no mediaUrl is given and NEXT_PUBLIC_SUPABASE_URL is empty', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    try {
      await expect(buildRelease(TENANT, { storage: mem.storage, now })).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
      expect(calls).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('supabaseReleaseStorage', () => {
  const fakeStorage = (o: { copyError?: unknown; uploadError?: unknown; download?: Uint8Array }) => {
    const seen: unknown[] = [];
    const from = (bucket: string) => ({
      upload: async (path: string, body: unknown, options: unknown) => {
        seen.push(['upload', bucket, path, body, options]);
        return { data: o.uploadError ? null : { path }, error: o.uploadError ?? null };
      },
      download: async (path: string) => {
        seen.push(['download', bucket, path]);
        return { data: o.download ? new Blob([new Uint8Array(o.download)]) : null, error: o.download ? null : { message: 'Object not found' } };
      },
      copy: async (src: string, dest: string, options: unknown) => {
        seen.push(['copy', bucket, src, dest, options]);
        return { data: o.copyError ? null : { path: dest }, error: o.copyError ?? null };
      },
    });
    return { seen, client: { storage: { from } } as unknown as Parameters<typeof supabaseReleaseStorage>[0] };
  };

  it('uploads with the exact cache-control header, content type and upsert flag', async () => {
    const { seen, client } = fakeStorage({});
    const body = new Uint8Array([1, 2]);
    await supabaseReleaseStorage(client).upload('delivery', 'p/current.json', body, {
      cacheControl: 'public, max-age=30',
      contentType: 'application/json',
      upsert: true,
    });
    expect(seen).toEqual([
      ['upload', 'delivery', 'p/current.json', body, { contentType: 'application/json', upsert: true, headers: { 'cache-control': 'public, max-age=30' } }],
    ]);
  });

  it('copies across buckets; an existing destination (409) is "exists", other errors throw', async () => {
    const ok = fakeStorage({});
    expect(await supabaseReleaseStorage(ok.client).copy({ bucket: 'media-private', path: 'a' }, { bucket: 'media-public', path: 'b' })).toBe('copied');
    expect(ok.seen).toEqual([['copy', 'media-private', 'a', 'b', { destinationBucket: 'media-public' }]]);
    const dup = fakeStorage({ copyError: Object.assign(new Error('The resource already exists'), { statusCode: '409', status: 400 }) });
    expect(await supabaseReleaseStorage(dup.client).copy({ bucket: 'media-private', path: 'a' }, { bucket: 'media-public', path: 'b' })).toBe('exists');
    const other = fakeStorage({ copyError: Object.assign(new Error('Object not found'), { statusCode: '404', status: 400 }) });
    await expect(supabaseReleaseStorage(other.client).copy({ bucket: 'media-private', path: 'a' }, { bucket: 'media-public', path: 'b' })).rejects.toThrow(
      /Object not found/,
    );
  });

  it('downloads bytes; a missing object throws', async () => {
    const ok = fakeStorage({ download: new Uint8Array([7, 8]) });
    expect(await supabaseReleaseStorage(ok.client).download('delivery', 'x')).toEqual(new Uint8Array([7, 8]));
    await expect(supabaseReleaseStorage(fakeStorage({}).client).download('delivery', 'x')).rejects.toThrow(/Object not found/);
  });

  it('an upload error throws', async () => {
    const { client } = fakeStorage({ uploadError: new Error('The resource already exists') });
    await expect(
      supabaseReleaseStorage(client).upload('delivery', 'x', new Uint8Array(), { cacheControl: 'x', contentType: 'application/json', upsert: false }),
    ).rejects.toThrow(/already exists/);
  });
});
