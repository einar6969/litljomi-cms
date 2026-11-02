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
import { createAdminClient } from '../../admin-client';
import {
  BUNDLE_CACHE_CONTROL,
  POINTER_CACHE_CONTROL,
  POINTER_DEADLINE_MS,
  buildRelease,
  supabaseReleaseStorage,
  type BuildOptions,
  type ReleaseStorage,
} from '../build-release';
import { processRequestById } from '../process-request';
import { failStaleReleases } from '../sweep';
import { failAsStale, prepareLabak } from './labak-setup';

let editor: SupabaseClient;
let secret: SupabaseClient;

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);

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

/**
 * A labak asset registered by editor_labak, with its original uploaded to media-private (unless
 * `upload` is false: an asset row registered without its upload, the only way an original can be
 * missing, since editors cannot delete objects in media-private).
 */
async function labakAsset(o: { upload?: boolean } = {}): Promise<string> {
  const id = randomUUID();
  const path = `${TENANT.labak}/${id}/mynd.jpg`;
  if (o.upload !== false) {
    const { error } = await editor.storage.from('media-private').upload(path, JPEG, { contentType: 'image/jpeg' });
    if (error) throw error;
  }
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

const build = (o: Pick<BuildOptions, 'storage' | 'clock'> = {}) => buildRelease(TENANT.labak, o);
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
const alertsFor = async (event: string, key: string, value: string) =>
  ownerQuery<{ tenant_id: string; actor_id: string | null; details: Record<string, unknown> }>(
    `select tenant_id, actor_id, details from cms.audit_log where action = $1 and details ->> $2 = $3`,
    [`system.alert.${event}`, key, value],
  );
/** The labak pointer's raw bytes, to restore after a test that replaces it. */
const pointerBytes = async () => new Uint8Array(await (await secret.storage.from('delivery').download('labak/current.json')).data!.arrayBuffer());

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
    // Task 20 quality r1, Minor 9: what the database stored. Other files' partial commits may be
    // omitted from every labak build (see above), so error is null or omits none of this test's.
    const row = await releaseRow(result.releaseId);
    expect(row.status).toBe('delivered');
    if (row.error !== null) expect(JSON.stringify(row.error)).not.toContain(entry.id);
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

  it('a release with no omissions stores error null', async () => {
    // Other files' partial commits (see the first test) are withdrawn for this one build.
    const omittedBefore = await delivered();
    const withdrawn = omittedBefore.omitted.map((o) => o.entryId);
    const saved = await ownerQuery<{ id: string; published_rev_id: string; published_draft_version: number }>(
      'select id, published_rev_id, published_draft_version from cms.entries where id = any($1::uuid[])',
      [withdrawn],
    );
    await ownerQuery('update cms.entries set published_rev_id = null, published_draft_version = null where id = any($1::uuid[])', [withdrawn]);
    try {
      const clean = await delivered();
      expect(clean.omitted).toEqual([]);
      expect((await releaseRow(clean.releaseId)).error).toBeNull();
    } finally {
      for (const e of saved) {
        await ownerQuery('update cms.entries set published_rev_id = $2, published_draft_version = $3 where id = $1', [e.id, e.published_rev_id, e.published_draft_version]);
      }
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

    const failed = await build({ storage: failing });

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

// Plan Task 30 (decisions 36.2 and 37.1): stale releases, a late worker, and a pointer that only
// moves forward. Each test makes its own release stale by moving its created_at back as owner.
describe('worker recovery (labak)', () => {
  const real = () => supabaseReleaseStorage(secret);

  it('the sweep step fails a stale building release, a late finish of it is refused, and the next build is n+1', async () => {
    const before = await delivered();
    const stale = await withTx('service', async (w) => (await w.query('select r.id, r.number from api.worker_begin_release($1) as r', [TENANT.labak])).rows[0] as { id: string; number: number });
    expect(stale.number).toBe(before.number + 1);
    await ownerQuery(`update cms.releases set created_at = now() - interval '421 seconds' where id = $1`, [stale.id]);

    const failed = await failStaleReleases(createAdminClient());

    expect(failed.map((r) => r.release_id)).toContain(stale.id);
    expect(await releaseRow(stale.id)).toMatchObject({ status: 'failed', bundle_path: null, error: { code: 'stale_building', maxAgeSeconds: 420 } });
    expect(await alertsFor('release.stale_failed', 'releaseId', stale.id)).toEqual([
      { tenant_id: TENANT.labak, actor_id: null, details: expect.objectContaining({ releaseId: stale.id, number: stale.number, maxAgeSeconds: 420 }) },
    ]);

    // A late worker's finish is refused and changes nothing.
    const pending = await published(news(await labakAsset(), 'Seinn'));
    await expect(
      withTx('service', (w) =>
        w.query(`select api.worker_finish_release($1, 'delivered', $2, null, $3::uuid[], null)`, [stale.id, `labak/releases/${stale.number}.json`, [pending.requestId]]),
      ),
    ).rejects.toThrow(/forbidden/);
    await expect(withTx('service', (w) => w.query(`select api.worker_finish_release($1, 'failed', null, '{}', null, null)`, [stale.id]))).rejects.toThrow(/forbidden/);
    expect(await releaseRow(stale.id)).toMatchObject({ status: 'failed', bundle_path: null, error: { code: 'stale_building', maxAgeSeconds: 420 } });
    expect(await releaseOf(pending.requestId)).toBeNull();

    const next = await delivered();
    expect(next.number).toBe(stale.number + 1);
    expect((await currentPointer()).release).toBe(next.number);
    expect(ids(next.bundle)).toContain(pending.id);
    expect(await releaseOf(pending.requestId)).toBe(next.releaseId);
  });

  it('a build whose release the sweep failed before the pointer write writes no pointer (current.json unchanged)', async () => {
    const before = await delivered();
    const pending = await published(news(await labakAsset(), 'Úrelt'));
    const storage: ReleaseStorage = {
      ...real(),
      upload: async (bucket, path, body, o) => {
        await real().upload(bucket, path, body, o);
        // The bundle is written; the sweep now fails the release as stale.
        if (path.endsWith(`/releases/${before.number + 1}.json`)) {
          const [row] = await ownerQuery<{ id: string }>(`select id from cms.releases where tenant_id = $1 and status = 'building'`, [TENANT.labak]);
          await failAsStale(row!.id);
        }
      },
    };

    const result = await build({ storage });

    expect(result.status).toBe('failed');
    expect(await currentPointer()).toMatchObject({ release: before.number });
    expect(await releaseRow(result.releaseId!)).toMatchObject({ status: 'failed', error: { code: 'stale_building' } });
    expect(await alertsFor('release.failed', 'releaseId', result.releaseId!)).toEqual([
      expect.objectContaining({ details: expect.objectContaining({ code: 'pointer_refused', step: 'pointer_check', pointerWritten: false }) }),
    ]);
    expect(await releaseOf(pending.requestId)).toBeNull();

    const next = await delivered();
    expect(next.number).toBe(result.number! + 1);
    expect(ids(next.bundle)).toContain(pending.id);
  });

  it('a finish refused after the pointer was written: failed, alerted, the pointer left as it is; the next build moves it on', async () => {
    const before = await delivered();
    const pending = await published(news(await labakAsset(), 'Of seint'));
    let pointerReads = 0;
    const storage: ReleaseStorage = {
      ...real(),
      download: async (bucket, path) => {
        const bytes = await real().download(bucket, path);
        // The read-back after the pointer write (the first read is the check before it): the sweep
        // fails the release before the worker finishes it.
        if (path === 'labak/current.json' && ++pointerReads === 2) {
          const [row] = await ownerQuery<{ id: string }>(`select id from cms.releases where tenant_id = $1 and status = 'building'`, [TENANT.labak]);
          await failAsStale(row!.id);
        }
        return bytes;
      },
    };

    const result = await build({ storage });

    expect(result).toMatchObject({ status: 'failed', number: before.number + 1 });
    // Decision 37.1 (d): no repair. The pointer names the failed release until a newer one.
    expect((await currentPointer()).release).toBe(result.number);
    expect(await releaseRow(result.releaseId!)).toMatchObject({ status: 'failed', bundle_path: null, error: { code: 'stale_building' } });
    expect(await alertsFor('release.finish_refused', 'releaseId', result.releaseId!)).toEqual([
      expect.objectContaining({ details: expect.objectContaining({ code: 'finish_refused', step: 'finish', pointerWritten: true }) }),
    ]);
    expect(await releaseOf(pending.requestId)).toBeNull();

    const next = await delivered();
    expect(next.number).toBe(result.number! + 1);
    expect((await currentPointer()).release).toBe(next.number);
    expect(await releaseOf(pending.requestId)).toBe(next.releaseId);
  });

  it(`a build past the ${POINTER_DEADLINE_MS} ms deadline writes no pointer`, async () => {
    const before = await delivered();
    let reads = 0;
    const result = await build({ clock: () => (reads++ === 0 ? 0 : POINTER_DEADLINE_MS) });

    expect(result.status).toBe('failed');
    expect(await currentPointer()).toMatchObject({ release: before.number });
    expect((await releaseRow(result.releaseId!)).error).toMatchObject({ code: 'pointer_refused', step: 'pointer_deadline', pointerWritten: false });
  });

  it('a current pointer that already names a newer release is not replaced', async () => {
    const before = await delivered();
    const original = await pointerBytes();
    const newer: Pointer = { ...(await currentPointer()), release: before.number + 100, bundle: `releases/${before.number + 100}.json` };
    await real().upload('delivery', 'labak/current.json', new TextEncoder().encode(JSON.stringify(newer)), {
      cacheControl: POINTER_CACHE_CONTROL,
      contentType: 'application/json',
      upsert: true,
    });
    try {
      const result = await build();

      expect(result.status).toBe('failed');
      expect(await currentPointer()).toEqual(newer);
      expect((await releaseRow(result.releaseId!)).error).toMatchObject({ code: 'pointer_refused', step: 'pointer_current', pointerWritten: false });
    } finally {
      await real().upload('delivery', 'labak/current.json', original, { cacheControl: POINTER_CACHE_CONTROL, contentType: 'application/json', upsert: true });
    }
    expect((await delivered()).number).toBeGreaterThan(before.number);
  });
});

// Plan Task 30 (decision 36.4): a missing private original fails the request that needs it, before
// commit, and the entry stays live at its published revision.
describe('missing private originals (labak)', () => {
  it('a draft referencing an asset whose original is missing fails with asset_missing and an alert; the live revision stays; others are unaffected', async () => {
    // P is live with a good image.
    const p = await draft(news(await labakAsset(), 'Lifandi'));
    const firstRequest = await rpc<string>('request_publish', { p_entry_id: p.id, p_expected_draft_version: p.version });
    expect((await processRequestById(firstRequest)).status).toBe('committed');
    const live = await delivered();
    const liveRevision = entriesOf(live.bundle).find((e) => e.id === p.id)!.revisionId;

    // P's next draft references an asset registered without its upload.
    const missing = await labakAsset({ upload: false });
    const version = await rpc<number>('save_draft', {
      p_entry_id: p.id,
      p_expected_version: p.version,
      p_data: news(missing, 'Lifandi, ný mynd'),
      p_schema_version: 1,
      p_title: null,
      p_sort_at: null,
    });
    const request = await rpc<string>('request_publish', { p_entry_id: p.id, p_expected_draft_version: version });
    const other = await published(news(await labakAsset(), 'Annað'));

    const outcome = await processRequestById(request);

    expect(outcome).toMatchObject({ status: 'failed_validation', errors: { code: 'asset_missing', assetIds: [missing] } });
    const [row] = await ownerQuery<{ status: string; error: unknown; revision_id: string | null }>(
      'select status, error, revision_id from cms.publish_requests where id = $1',
      [request],
    );
    expect(row).toEqual({ status: 'failed_validation', error: { code: 'asset_missing', assetIds: [missing] }, revision_id: null });
    expect(await alertsFor('publish_request.asset_missing', 'requestId', request)).toEqual([
      { tenant_id: TENANT.labak, actor_id: null, details: { tenantId: TENANT.labak, requestId: request, entryId: p.id, assetIds: [missing] } },
    ]);
    const [entry] = await ownerQuery<{ published_rev_id: string }>('select published_rev_id from cms.entries where id = $1', [p.id]);
    expect(entry!.published_rev_id).toBe(liveRevision);

    // The next bundle still has P at its old revision, and the other entry.
    const next = await delivered();
    const inNext = entriesOf(next.bundle).find((e) => e.id === p.id);
    expect(inNext?.revisionId).toBe(liveRevision);
    expect(inNext?.title).toBe('Lifandi');
    expect(ids(next.bundle)).toContain(other.id);
    expect(next.omitted.map((o) => o.entryId)).not.toContain(p.id);
    expect(await publicPath(missing)).toBeNull();
  });
});
