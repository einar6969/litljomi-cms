// The housekeeping release against the local stack (spec §5.6 "Withdrawal", §7.2 "Retention" and
// "Housekeeping release", §8.4; migration 20261104153000). On labak: release A publishes a news item
// with an image; release B unpublishes it, and labak never publishes again. Without a release after
// B, A (which still carries the item and its image) is never older than the previous release, so
// retention keeps it public however late the clock. The sweep's build selection
// (api.worker_tenants_to_release, step 2) lists labak at once after B; the build it starts is the
// housekeeping release H, with no linked requests; then the selection stops. An hour of simulated
// time after H (the sweep's retention clock, step 5), A's bundle and the withdrawn image answer 404,
// and B and H stay.
//
// Every build includes whatever earlier integration files published on labak, and retention runs
// over every tenant's old releases, so the assertions are about the objects this file creates.
// Earlier files' leftovers may need housekeeping releases of their own; they are built before B.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { editorClient, publicUrl } from '../../../../../../tests/integration/src/clients.ts';
import { env } from '../../../../../../tests/integration/src/env.ts';
import { TENANT } from '../../../../../../tests/integration/src/fixtures.ts';
import { closeAll, ownerQuery } from '../../../../../../tests/integration/src/sql.ts';
import { createAdminClient } from '../../admin-client';
import { buildRelease, type BuildResult } from '../build-release';
import { processRequestById } from '../process-request';
import { removeExpiredReleaseFiles } from '../retention';
import { callRpc } from '../rpc';
import { TEST_JPEG, TEST_JPEG_METADATA } from './test-image';
import { prepareLabak } from './labak-setup';

let editor: SupabaseClient;
/** Entries this file published, withdrawn after the run so later builds do not carry them. */
const created: string[] = [];

beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', env.apiUrl);
  vi.stubEnv('SUPABASE_SECRET_KEY', env.secretKey);
  editor = await editorClient('editor_labak');
  await prepareLabak();
});
afterAll(async () => {
  await ownerQuery('update cms.entries set published_rev_id = null, published_draft_version = null where id = any($1::uuid[])', [created]);
  vi.unstubAllEnvs();
  await closeAll();
});

const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await editor.schema('api').rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.code} ${error.message}`);
  return data as T;
};

/** A registered labak image (a real JPEG with its true metadata, as M3-07's re-derivation needs). */
async function image(): Promise<{ id: string; publicPath: string }> {
  const id = randomUUID();
  const path = `${TENANT.labak}/${id}/mynd.jpg`;
  const { error } = await editor.storage.from('media-private').upload(path, TEST_JPEG, { contentType: 'image/jpeg' });
  if (error) throw error;
  await rpc('register_asset', { p_asset_id: id, p_tenant_id: TENANT.labak, p_original_path: path, p_filename: 'mynd.jpg', ...TEST_JPEG_METADATA });
  return { id, publicPath: `labak/${id}/mynd.jpg` };
}

/** A news item with the image, published through the real path: save, request_publish, worker step 1. */
async function published(title: string, imageId: string): Promise<string> {
  const id = await rpc<string>('create_entry', { p_tenant_id: TENANT.labak, p_type: 'news', p_slug: `hk-${randomUUID().slice(0, 8)}` });
  created.push(id);
  const version = await rpc<number>('save_draft', {
    p_entry_id: id,
    p_expected_version: 1,
    p_data: {
      title,
      date: '2026-11-04',
      excerpt: 'Inngangur.',
      image: { _ref: imageId, _kind: 'asset', alt: 'Brauð' },
      body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Meginmál.' }] }] },
    },
    p_schema_version: 1,
    p_title: null,
    p_sort_at: null,
  });
  const requestId = await rpc<string>('request_publish', { p_entry_id: id, p_expected_draft_version: version });
  expect((await processRequestById(requestId)).status).toBe('committed');
  return id;
}

async function unpublished(entryId: string): Promise<void> {
  const requestId = await rpc<string>('request_unpublish', { p_entry_id: entryId });
  expect((await processRequestById(requestId)).status).toBe('committed');
}

const delivered = async (): Promise<BuildResult & { number: number; releaseId: string }> => {
  const result = await buildRelease(TENANT.labak);
  expect(result.status, JSON.stringify(result)).toBe('delivered');
  return result as BuildResult & { number: number; releaseId: string };
};

/** Whether the sweep's build selection (step 2) lists labak at the clock `now`. */
async function labakToRelease(now: Date): Promise<boolean> {
  const rows = (await callRpc<Array<{ tenant_id: string }> | null>(createAdminClient(), 'worker_tenants_to_release', { p_now: now.toISOString() })) ?? [];
  return rows.some((r) => r.tenant_id === TENANT.labak);
}

/** The status of a public object; the local Storage API's missing-object answer is reported as 404. */
async function statusOf(bucket: 'delivery' | 'media-public', path: string): Promise<number> {
  const res = await fetch(publicUrl(bucket, path));
  if (res.status !== 400) {
    await res.body?.cancel();
    return res.status;
  }
  const body = (await res.json()) as { statusCode?: string; code?: string };
  return body.statusCode === '404' && body.code === 'NoSuchKey' ? 404 : 400;
}

/** Runs the sweep's retention step at `now` until nothing more is claimed. */
async function retentionAt(now: Date): Promise<string[]> {
  const db = createAdminClient();
  const cleaned: string[] = [];
  for (let i = 0; i < 100; i++) {
    const { releaseIds } = await removeExpiredReleaseFiles(db, { now: () => now });
    if (releaseIds.length === 0) return cleaned;
    cleaned.push(...releaseIds);
  }
  throw new Error('retention kept claiming releases');
}

const minutes = (n: number) => new Date(Date.now() + n * 60_000);

describe('housekeeping release on labak (§7.2)', () => {
  it('follows a withdrawal at once, so a tenant that never publishes again still loses the withdrawn files', async () => {
    // Release A: the item and its image are public. Earlier files withdraw what they published
    // directly in SQL, so A may itself withdraw their media; its housekeeping releases are built
    // here, and A is the last of them: the last release before the withdrawal.
    const withdrawn = await image();
    const item = await published('Frétt sem er dregin til baka', withdrawn.id);
    let a = await delivered();
    for (let i = 0; i < 5 && (await labakToRelease(new Date())); i++) a = await delivered();
    expect(await labakToRelease(new Date())).toBe(false);
    expect(a.bundle!.entries.news?.some((e) => e.id === item)).toBe(true);
    expect(await statusOf('media-public', withdrawn.publicPath)).toBe(200);

    // Release B withdraws it. Labak never publishes again.
    await unpublished(item);
    const b = await delivered();
    expect(b.bundle!.entries.news?.some((e) => e.id === item)).toBeFalsy();

    // Without a release after B, A stays public however late the clock: it is the previous
    // release's predecessor only once a release after B exists.
    expect(await retentionAt(minutes(30 * 24 * 60))).not.toContain(a.releaseId);
    expect(await statusOf('delivery', `labak/releases/${a.number}.json`)).toBe(200);
    expect(await statusOf('media-public', withdrawn.publicPath)).toBe(200);

    // The sweep's build selection lists labak at once, with nothing committed.
    const [{ count: pending }] = (await ownerQuery<{ count: string }>(
      `select count(*) from cms.publish_requests where tenant_id = $1 and status = 'committed' and release_id is null`,
      [TENANT.labak],
    )) as [{ count: string }];
    expect(Number(pending)).toBe(0);
    expect(await labakToRelease(new Date())).toBe(true);

    // The build it starts is the housekeeping release H: B's published state, no linked requests.
    const h = await delivered();
    expect(h.number).toBe(b.number + 1);
    expect(h.requests ?? []).toEqual([]);
    expect(h.bundle!.entries).toEqual(b.bundle!.entries);
    // Exactly one: H withdrew nothing, so the selection stops, however late the clock.
    expect(await labakToRelease(new Date())).toBe(false);
    expect(await labakToRelease(minutes(30 * 24 * 60))).toBe(false);

    // Less than an hour after H (simulated): A stays.
    expect(await retentionAt(minutes(55))).not.toContain(a.releaseId);
    expect(await statusOf('delivery', `labak/releases/${a.number}.json`)).toBe(200);

    // An hour after H: A's bundle and the withdrawn image are gone; B and H stay.
    const cleaned = await retentionAt(minutes(61));
    expect(cleaned).toContain(a.releaseId);
    expect(cleaned).not.toContain(b.releaseId);
    expect(cleaned).not.toContain(h.releaseId);
    expect(await statusOf('delivery', `labak/releases/${a.number}.json`)).toBe(404);
    expect(await statusOf('media-public', withdrawn.publicPath)).toBe(404);
    expect(await statusOf('delivery', `labak/releases/${b.number}.json`)).toBe(200);
    expect(await statusOf('delivery', `labak/releases/${h.number}.json`)).toBe(200);
    expect(await statusOf('delivery', 'labak/current.json')).toBe(200);
    const [asset] = await ownerQuery<{ public_path: string | null }>('select public_path from cms.assets where id = $1', [withdrawn.id]);
    expect(asset!.public_path).toBeNull();
  });
});
