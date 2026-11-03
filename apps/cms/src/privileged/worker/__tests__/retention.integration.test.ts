// Retention and public-media cleanup against the local stack (spec §5.6 "Withdrawal", §7.2
// "Retention"; plan M3-06). On labak: release A publishes two images; a failed build F copies a
// third image and writes its bundle; B withdraws the first and the third; C is delivered. An hour
// of simulated time after C (the sweep's clock), retention leaves only B and C in `delivery`; the
// image unpublished since A and the failed build's image and bundle are gone from public storage
// and answer 404; the image B and C still reference stays. Publishing the removed image again
// copies it back.
//
// Every build includes whatever earlier integration files published on labak, and retention
// runs over every tenant's old releases, so the assertions are about the objects this file
// creates.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { editorClient, publicUrl } from '../../../../../../tests/integration/src/clients.ts';
import { env } from '../../../../../../tests/integration/src/env.ts';
import { TENANT } from '../../../../../../tests/integration/src/fixtures.ts';
import { closeAll, ownerQuery } from '../../../../../../tests/integration/src/sql.ts';
import { createAdminClient } from '../../admin-client';
import { buildRelease, supabaseReleaseStorage, type BuildResult } from '../build-release';
import { processRequestById } from '../process-request';
import { removeExpiredReleaseFiles } from '../retention';
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

const news = (title: string, imageId?: string) => ({
  title,
  date: '2026-10-15',
  excerpt: 'Inngangur.',
  ...(imageId ? { image: { _ref: imageId, _kind: 'asset', alt: 'Brauð' } } : {}),
  body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Meginmál.' }] }] },
});

/** A news item published through the real path: save, request_publish, worker step 1. */
async function published(title: string, imageId?: string): Promise<string> {
  const id = await rpc<string>('create_entry', { p_tenant_id: TENANT.labak, p_type: 'news', p_slug: `m306-${randomUUID().slice(0, 8)}` });
  created.push(id);
  const version = await rpc<number>('save_draft', {
    p_entry_id: id,
    p_expected_version: 1,
    p_data: news(title, imageId),
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

/**
 * The status of a public object (§5.6: both public buckets are read without a key). The local
 * Storage API answers a missing object with HTTP 400 and `statusCode: "404"`, `NoSuchKey` in the
 * body; that answer is reported as 404.
 */
async function statusOf(bucket: 'delivery' | 'media-public', path: string): Promise<number> {
  const res = await fetch(publicUrl(bucket, path));
  if (res.status !== 400) {
    await res.body?.cancel();
    return res.status;
  }
  const body = (await res.json()) as { statusCode?: string; code?: string };
  return body.statusCode === '404' && body.code === 'NoSuchKey' ? 404 : 400;
}
const isGone = (status: number) => status === 404;

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

describe('retention on labak (§7.2)', () => {
  it('keeps only the current and previous release, and removes media and failed builds\' objects nothing references', async () => {
    const old = await image();
    const kept = await image();
    const failedImage = await image();

    // Release A: both images are public.
    const withOld = await published('Mynd sem hverfur', old.id);
    await published('Mynd sem helst', kept.id);
    const a = await delivered();
    expect(await statusOf('media-public', old.publicPath)).toBe(200);
    expect(await statusOf('media-public', kept.publicPath)).toBe(200);

    // A failed build F: its image is copied and its bundle written, then the pointer write fails.
    const withFailed = await published('Mynd í misheppnaðri útgáfu', failedImage.id);
    const real = supabaseReleaseStorage(createAdminClient());
    const f = await buildRelease(TENANT.labak, {
      storage: {
        ...real,
        upload: async (bucket, path, body, o) => {
          if (path.endsWith('/current.json')) throw new Error('pointer upload refused (test)');
          await real.upload(bucket, path, body, o);
        },
      },
    });
    expect(f.status).toBe('failed');
    expect(f.number).toBeGreaterThan(a.number);
    const failedBundle = `labak/releases/${f.number}.json`;
    expect(await statusOf('delivery', failedBundle)).toBe(200);
    expect(await statusOf('media-public', failedImage.publicPath)).toBe(200);
    const [recorded] = await ownerQuery<{ public_assets: string[] }>('select public_assets from cms.releases where id = $1', [f.releaseId]);
    expect(recorded!.public_assets).toContain(failedImage.id);

    // Release B withdraws the first image's entry and the failed build's; C follows.
    await unpublished(withOld);
    await unpublished(withFailed);
    const b = await delivered();
    await published('Sama mynd aftur', kept.id);
    const c = await delivered();
    expect(b.number).toBeGreaterThan(f.number!);
    expect(c.number).toBe(b.number + 1);

    // Less than an hour after C: A and F stay (C is the second delivered release above them).
    expect(await retentionAt(new Date(Date.now() + 55 * 60_000))).not.toContain(a.releaseId);
    expect(await statusOf('delivery', `labak/releases/${a.number}.json`)).toBe(200);

    // An hour after C (simulated): only B and C remain of these releases.
    const cleaned = await retentionAt(new Date(Date.now() + 61 * 60_000));
    expect(cleaned).toEqual(expect.arrayContaining([a.releaseId, f.releaseId!]));
    expect(cleaned).not.toContain(b.releaseId);
    expect(cleaned).not.toContain(c.releaseId);
    expect(isGone(await statusOf('delivery', `labak/releases/${a.number}.json`))).toBe(true);
    expect(isGone(await statusOf('delivery', failedBundle))).toBe(true);
    expect(await statusOf('delivery', `labak/releases/${b.number}.json`)).toBe(200);
    expect(await statusOf('delivery', `labak/releases/${c.number}.json`)).toBe(200);
    expect(await statusOf('delivery', 'labak/current.json')).toBe(200);

    // The image unpublished since A and the failed build's image answer 404; the kept one 200.
    expect(isGone(await statusOf('media-public', old.publicPath))).toBe(true);
    expect(isGone(await statusOf('media-public', failedImage.publicPath))).toBe(true);
    expect(await statusOf('media-public', kept.publicPath)).toBe(200);
    const paths = await ownerQuery<{ id: string; public_path: string | null }>('select id, public_path from cms.assets where id = any($1::uuid[])', [
      [old.id, kept.id, failedImage.id],
    ]);
    expect(Object.fromEntries(paths.map((p) => [p.id, p.public_path]))).toEqual({
      [old.id]: null,
      [kept.id]: kept.publicPath,
      [failedImage.id]: null,
    });
    const [{ count }] = (await ownerQuery<{ count: string }>(
      'select count(*) from cms.releases where id = any($1::uuid[]) and cleaned_at is not null',
      [[a.releaseId, f.releaseId, b.releaseId, c.releaseId]],
    )) as [{ count: string }];
    expect(Number(count)).toBe(2);

    // Publishing the removed image again copies it back.
    await published('Mynd aftur', old.id);
    const d = await delivered();
    expect(d.bundle).toBeDefined();
    expect(await statusOf('media-public', old.publicPath)).toBe(200);
  });
});
