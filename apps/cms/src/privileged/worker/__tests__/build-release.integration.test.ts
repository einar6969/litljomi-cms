// Worker step 2 against the local stack (plan Task 20, decisions 34 and 35; spec §5.6, §7.1, §7.2;
// "Withdrawal and failure visibility"). Editors publish over the Data API with their own sessions;
// the worker runs as service_role with the secret key, as in production. Release tests run on
// labak; every build includes whatever labak content earlier tests published, so assertions are
// about the entries each test creates. Media publication is proven at the storage level (decision
// 34.3): the object is in media-public and public_path is set. Local media URLs are http, so the
// bundle's image fields are null here; https URLs are covered by build-release.test.ts.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { contentHash } from '@litljomi/cms-schema';
import type { Bundle, BundleEntry, Pointer } from '@litljomi/cms-sdk';
import { editorClient, publicUrl, secretClient } from '../../../../../../tests/integration/src/clients.ts';
import { env } from '../../../../../../tests/integration/src/env.ts';
import { PERSONAS, TENANT } from '../../../../../../tests/integration/src/fixtures.ts';
import { closeAll, ownerQuery, withTx } from '../../../../../../tests/integration/src/sql.ts';
import { BUNDLE_CACHE_CONTROL, POINTER_CACHE_CONTROL, buildRelease, supabaseReleaseStorage, type ReleaseStorage } from '../build-release';
import { processRequestById } from '../process-request';

let editor: SupabaseClient;
let secret: SupabaseClient;

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);

/** Uploads a placeholder original to media-private; an existing object is fine. */
async function putOriginal(path: string) {
  const { error } = await secret.storage.from('media-private').upload(path, JPEG, { contentType: 'image/jpeg' });
  if (error && String((error as { statusCode?: unknown }).statusCode) !== '409') throw error;
}

/** Leftovers of earlier runs: a building release blocks the tenant, and published originals must exist to be copied. */
async function prepareLabak() {
  const building = await ownerQuery<{ id: string }>(`select id from cms.releases where tenant_id = $1 and status = 'building'`, [TENANT.labak]);
  for (const { id } of building) {
    await withTx('service', (w) => w.query(`select api.worker_finish_release($1, 'failed', null, '{"test":"cleanup"}', null, null)`, [id]));
  }
  const originals = await ownerQuery<{ original_path: string }>(
    `select distinct a.original_path from cms.assets a
     join cms.revision_refs rr on rr.tenant_id = a.tenant_id and rr.target_asset_id = a.id
     join cms.entries e on e.tenant_id = rr.tenant_id and e.published_rev_id = rr.revision_id
     where a.tenant_id = $1 and a.public_path is null and a.archived_at is null and e.archived_at is null`,
    [TENANT.labak],
  );
  for (const { original_path } of originals) await putOriginal(original_path);
}

beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', env.apiUrl);
  vi.stubEnv('SUPABASE_SECRET_KEY', env.secretKey);
  editor = await editorClient('editor_labak');
  secret = secretClient();
  await prepareLabak();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeAll();
});

const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await editor.schema('api').rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.code} ${error.message}`);
  return data as T;
};

/** A labak asset registered by editor_labak, with its original uploaded to media-private. */
async function labakAsset(): Promise<string> {
  const id = randomUUID();
  const path = `${TENANT.labak}/${id}/mynd.jpg`;
  const { error } = await editor.storage.from('media-private').upload(path, JPEG, { contentType: 'image/jpeg' });
  if (error) throw error;
  await rpc('register_asset', {
    p_asset_id: id,
    p_tenant_id: TENANT.labak,
    p_original_path: path,
    p_filename: 'mynd.jpg',
    p_mime: 'image/jpeg',
    p_bytes: JPEG.length,
    p_width: 800,
    p_height: 600,
    p_sha256: 'b'.repeat(64),
  });
  return id;
}

const news = (imageId: string, title = 'Frétt') => ({
  title,
  date: '2026-10-15',
  excerpt: 'Inngangur.',
  image: { _ref: imageId, _kind: 'asset', alt: 'Brauð' },
  body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Meginmál.' }] }] },
});

/** A labak news draft saved by editor_labak (not published). */
async function draft(data: Record<string, unknown>) {
  const id = await rpc<string>('create_entry', { p_tenant_id: TENANT.labak, p_type: 'news', p_slug: `t20-${randomUUID().slice(0, 8)}` });
  const version = await rpc<number>('save_draft', {
    p_entry_id: id,
    p_expected_version: 1,
    p_data: data,
    p_schema_version: 1,
    p_title: null,
    p_sort_at: null,
  });
  return { id, version };
}

/** Publishes through the real path: request_publish, then worker step 1. */
async function published(data: Record<string, unknown>): Promise<{ id: string; requestId: string }> {
  const d = await draft(data);
  const requestId = await rpc<string>('request_publish', { p_entry_id: d.id, p_expected_draft_version: d.version });
  expect((await processRequestById(requestId)).status).toBe('committed');
  return { id: d.id, requestId };
}

async function unpublished(entryId: string): Promise<string> {
  const requestId = await rpc<string>('request_unpublish', { p_entry_id: entryId });
  expect((await processRequestById(requestId)).status).toBe('committed');
  return requestId;
}

const build = async (storage?: ReleaseStorage) => {
  const result = await buildRelease(TENANT.labak, storage ? { storage } : {});
  return result;
};
const delivered = async () => {
  const result = await build();
  expect(result.status, JSON.stringify(result)).toBe('delivered');
  return result as Required<typeof result>;
};

const fetchPublic = async (bucket: string, path: string) => {
  const res = await fetch(publicUrl(bucket, path), { cache: 'no-store' });
  return { status: res.status, cacheControl: res.headers.get('cache-control'), body: res.ok ? await res.text() : null };
};
const currentPointer = async () => JSON.parse((await fetchPublic('delivery', 'labak/current.json')).body!) as Pointer;
const entriesOf = (b: Bundle): BundleEntry[] => Object.values(b.entries).flat();
const ids = (b: Bundle) => entriesOf(b).map((e) => e.id);
const inMediaPublic = async (assetId: string) => (await fetchPublic('media-public', `labak/${assetId}/mynd.jpg`)).status === 200;
const publicPath = async (assetId: string) =>
  (await ownerQuery<{ public_path: string | null }>('select public_path from cms.assets where id = $1', [assetId]))[0]!.public_path;
const releaseRow = async (id: string) =>
  (await ownerQuery<{ status: string; bundle_path: string | null; error: Record<string, unknown> | null; number: number }>(
    'select status, bundle_path, error, number from cms.releases where id = $1',
    [id],
  ))[0]!;
const releaseOf = async (requestId: string) =>
  (await ownerQuery<{ release_id: string | null }>('select release_id from cms.publish_requests where id = $1', [requestId]))[0]!.release_id;

describe('buildRelease (labak)', () => {
  it('two consecutive builds are n and n+1; the pointer shows n+1; both are written with §7.2 cache headers', async () => {
    const first = await delivered();
    const second = await delivered();

    expect(second.number).toBe(first.number + 1);
    expect(await currentPointer()).toEqual({
      format: 1,
      tenant: 'labak',
      release: second.number,
      bundle: `releases/${second.number}.json`,
      generatedAt: second.bundle.generatedAt,
    });
    const bundle = await fetchPublic('delivery', `labak/releases/${second.number}.json`);
    expect(JSON.parse(bundle.body!)).toEqual(second.bundle);
    expect(second.previousBundle).toEqual(first.bundle);
    // Decision 34.4: what the local Storage API serves (docs/verification/m1-gates.md, Task 20).
    expect(bundle.cacheControl).toBe(BUNDLE_CACHE_CONTROL);
    expect(bundle.cacheControl).toBe('public, max-age=31536000, immutable');
    expect((await fetchPublic('delivery', 'labak/current.json')).cacheControl).toBe(POINTER_CACHE_CONTROL);
    expect(POINTER_CACHE_CONTROL).toBe('public, max-age=30');
    // error is not asserted: tests/integration's concurrency tests commit labak entries with partial
    // data directly through worker_commit_publish, and every labak build rightly leaves those out.
    expect(await releaseRow(second.releaseId)).toMatchObject({
      status: 'delivered',
      bundle_path: `labak/releases/${second.number}.json`,
    });
  });

  it('publishes the media of included entries: the object is in media-public and public_path is set', async () => {
    const image = await labakAsset();
    const entry = await published(news(image));
    expect(await inMediaPublic(image)).toBe(false);

    const result = await delivered();

    expect(ids(result.bundle)).toContain(entry.id);
    expect(await inMediaPublic(image)).toBe(true);
    expect(await publicPath(image)).toBe(`labak/${image}/mynd.jpg`);
    expect(await releaseOf(entry.requestId)).toBe(result.releaseId);
  });

  it('withdrawal wins: after unpublishing X the next bundle has no X, though the previous one had it', async () => {
    const x = await published(news(await labakAsset(), 'X'));
    const withX = await delivered();
    expect(ids(withX.bundle)).toContain(x.id);

    const unpublishRequest = await unpublished(x.id);
    const withoutX = await delivered();

    expect(ids(withoutX.bundle)).not.toContain(x.id);
    expect(ids(withoutX.previousBundle!)).toContain(x.id);
    const served = JSON.parse((await fetchPublic('delivery', `labak/releases/${withoutX.number}.json`)).body!) as Bundle;
    expect(ids(served)).not.toContain(x.id);
    expect(await releaseOf(unpublishRequest)).toBe(withoutX.releaseId);
  });

  it('an archived entry is absent, even with a published revision (inserted as owner: editors cannot archive a published entry)', async () => {
    const y = await published(news(await labakAsset(), 'Y'));
    expect(ids((await delivered()).bundle)).toContain(y.id);
    await ownerQuery('update cms.entries set archived_at = now() where id = $1', [y.id]);

    expect(ids((await delivered()).bundle)).not.toContain(y.id);
  });

  it('returns busy while another build of the tenant is running', async () => {
    const running = await withTx('service', async (w) => (await w.query(`select r.id from api.worker_begin_release($1) as r`, [TENANT.labak])).rows[0].id as string);
    try {
      expect(await build()).toEqual({ status: 'busy', omitted: [] });
      expect(await releaseRow(running)).toMatchObject({ status: 'building' });
    } finally {
      await withTx('service', (w) => w.query(`select api.worker_finish_release($1, 'failed', null, '{"test":"cleanup"}', null, null)`, [running]));
    }
  });

  it('omits an entry whose stored revision no longer validates; records it, alerts, and delivers the others', async () => {
    // Z: a published revision without its required title, inserted as owner (the worker would never commit it).
    const badImage = await labakAsset();
    const z = await draft(news(badImage, 'Z'));
    const { title: _dropped, ...invalid } = news(badImage);
    const [rev] = await ownerQuery<{ id: string }>(
      `insert into cms.revisions (tenant_id, entry_id, draft_version, schema_version, data, title, requested_by)
       values ($1, $2, 1, 1, $3, null, $4) returning id`,
      [TENANT.labak, z.id, JSON.stringify(invalid), PERSONAS.editor_labak.id],
    );
    await ownerQuery(
      `update cms.entries set published_rev_id = $2, published_draft_version = 1, first_published_at = now(), last_published_at = now()
       where id = $1`,
      [z.id, rev!.id],
    );
    const goodImage = await labakAsset();
    const w = await published(news(goodImage, 'W'));

    try {
      const result = await delivered();

      expect(ids(result.bundle)).toContain(w.id);
      expect(ids(result.bundle)).not.toContain(z.id);
      const omittedZ = result.omitted.find((o) => o.entryId === z.id);
      expect(omittedZ).toEqual({
        entryId: z.id,
        requestIds: [],
        error: { code: 'projection_failed', issues: [expect.objectContaining({ path: ['title'] })] },
      });
      const row = await releaseRow(result.releaseId);
      expect(row.status).toBe('delivered');
      expect((row.error as { omitted: unknown[] }).omitted).toContainEqual(omittedZ);
      const alerts = await ownerQuery<{ tenant_id: string; actor_id: string | null; details: { releaseId: string; omitted: Array<{ entryId: string }> } }>(
        `select tenant_id, actor_id, details from cms.audit_log where action = 'system.alert.release.entry_omitted' and details ->> 'releaseId' = $1`,
        [result.releaseId],
      );
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({ tenant_id: TENANT.labak, actor_id: null });
      expect(alerts[0]!.details.omitted.map((o) => o.entryId)).toContain(z.id);
      // Its asset is not copied; the delivered entry's is.
      expect(await inMediaPublic(badImage)).toBe(false);
      expect(await publicPath(badImage)).toBeNull();
      expect(await inMediaPublic(goodImage)).toBe(true);
    } finally {
      // Withdraw Z so later builds (and later runs) do not omit it again.
      await ownerQuery('update cms.entries set published_rev_id = null, published_draft_version = null where id = $1', [z.id]);
    }
  });

  it('never copies the assets of drafts that were never published', async () => {
    const image = await labakAsset();
    const d = await draft(news(image, 'Drög'));

    const result = await delivered();

    expect(ids(result.bundle)).not.toContain(d.id);
    expect(await inMediaPublic(image)).toBe(false);
    expect(await publicPath(image)).toBeNull();
  });

  it('every contentHash equals SHA-256 over the canonical entry record minus contentHash (§7.2)', async () => {
    await published(news(await labakAsset(), 'Hash'));
    const result = await delivered();
    const served = JSON.parse((await fetchPublic('delivery', `labak/releases/${result.number}.json`)).body!) as Bundle;

    expect(entriesOf(served).length).toBeGreaterThan(0);
    for (const e of entriesOf(served)) {
      const { contentHash: hash, ...record } = e;
      expect(hash).toBe(contentHash(record));
    }
  });

  it('a pointer upload failure leaves current.json at the old release and marks the release failed', async () => {
    const before = await delivered();
    const image = await labakAsset();
    const pending = await published(news(image, 'Bíður'));
    const real = supabaseReleaseStorage(secret);
    const failing: ReleaseStorage = {
      ...real,
      upload: async (bucket, path, body, o) => {
        if (path.endsWith('/current.json')) throw new Error('simulated pointer upload failure');
        return real.upload(bucket, path, body, o);
      },
    };

    const failed = await build(failing);

    expect(failed.status).toBe('failed');
    expect((await currentPointer()).release).toBe(before.number);
    const row = await releaseRow(failed.releaseId!);
    expect(row).toMatchObject({ status: 'failed', bundle_path: null });
    expect(row.error).toMatchObject({ code: 'build_failed', step: 'pointer_upload', pointerWritten: false });
    expect(await releaseOf(pending.requestId)).toBeNull();
    expect(await publicPath(image)).toBeNull();
    // The failed build had copied the asset; the next build copies it again (the existing
    // destination counts as success), links the request and sets public_path.
    expect(await inMediaPublic(image)).toBe(true);

    const next = await delivered();
    expect(next.number).toBe(failed.number! + 1);
    expect((await currentPointer()).release).toBe(next.number);
    expect(ids(next.bundle)).toContain(pending.id);
    expect(next.previousBundle).toEqual(before.bundle);
    expect(await releaseOf(pending.requestId)).toBe(next.releaseId);
    expect(await publicPath(image)).toBe(`labak/${image}/mynd.jpg`);
  });
});
