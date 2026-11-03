// M3-07 against the local stack (spec §5.6; decision 50.5; deferred Minors Task 24 security r1).
//   - The sweep's orphan removal: an unregistered original in media-private is removed once it is
//     older than the grace period; a registered one is kept.
//   - The publish-time re-derivation: an asset registered directly through api.register_asset with
//     false dimensions or a false MIME type is refused at publish (asset_mismatch), and the entry
//     is not committed.
// Editors act over the Data API with their own sessions; the worker runs as service_role with the
// secret key, as in production. Ages are simulated by backdating storage.objects.created_at as the
// owner, never by waiting.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { editorClient } from '../../../../../../tests/integration/src/clients.ts';
import { env } from '../../../../../../tests/integration/src/env.ts';
import { TENANT } from '../../../../../../tests/integration/src/fixtures.ts';
import { closeAll, ownerQuery } from '../../../../../../tests/integration/src/sql.ts';
import { createAdminClient } from '../../admin-client';
import { ORPHAN_GRACE_SECONDS, removePrivateOrphans } from '../media-orphans';
import { processRequestById } from '../process-request';
import { TEST_JPEG, TEST_JPEG_METADATA } from './test-image';

let editor: SupabaseClient;

beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', env.apiUrl);
  vi.stubEnv('SUPABASE_SECRET_KEY', env.secretKey);
  editor = await editorClient('editor_labak');
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

/** Uploads TEST_JPEG as editor_labak to labak's media-private; returns its id and path. */
async function upload(): Promise<{ id: string; path: string }> {
  const id = randomUUID();
  const path = `${TENANT.labak}/${id}/mynd.jpg`;
  const { error } = await editor.storage.from('media-private').upload(path, TEST_JPEG, { contentType: 'image/jpeg' });
  if (error) throw error;
  return { id, path };
}

/** Registers an uploaded original directly through api.register_asset, with the given metadata. */
const register = (id: string, path: string, metadata: Record<string, unknown> = {}) =>
  rpc('register_asset', { p_asset_id: id, p_tenant_id: TENANT.labak, p_original_path: path, p_filename: 'mynd.jpg', ...TEST_JPEG_METADATA, ...metadata });

const backdate = (path: string, seconds: number) =>
  ownerQuery(`update storage.objects set created_at = now() - make_interval(secs => $2) where bucket_id = 'media-private' and name = $1`, [
    path,
    seconds,
  ]);

const objectExists = async (path: string) =>
  (await ownerQuery(`select 1 from storage.objects where bucket_id = 'media-private' and name = $1`, [path])).length === 1;

describe('orphaned originals (sweep step 4)', () => {
  it('an unregistered upload is removed after the grace period; a registered one and a fresh one are kept', async () => {
    const orphan = await upload();
    const fresh = await upload();
    const registered = await upload();
    await register(registered.id, registered.path);
    await backdate(orphan.path, ORPHAN_GRACE_SECONDS + 60);
    await backdate(registered.path, ORPHAN_GRACE_SECONDS + 60);

    // Up to Storage's batch limit, so orphans left by earlier test runs cannot crowd ours out.
    const removed = await removePrivateOrphans(createAdminClient(), { limit: 1000 });

    expect(removed).toContain(orphan.path);
    expect(removed).not.toContain(fresh.path);
    expect(removed).not.toContain(registered.path);
    expect(await objectExists(orphan.path)).toBe(false);
    expect(await objectExists(fresh.path)).toBe(true);
    expect(await objectExists(registered.path)).toBe(true);
    // Removed through the Storage API: the object itself is gone, not only its row.
    const { data } = await createAdminClient().storage.from('media-private').exists(orphan.path);
    expect(data).toBe(false);
  });
});

describe('metadata re-derived at publish', () => {
  const news = (imageId: string) => ({
    title: 'Brauð með röngum málum',
    date: '2026-10-15',
    excerpt: 'Inngangur.',
    image: { _ref: imageId, _kind: 'asset', alt: 'Brauð' },
    body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Meginmál.' }] }] },
  });

  async function requestPublish(imageId: string): Promise<{ entryId: string; requestId: string }> {
    const entryId = await rpc<string>('create_entry', { p_tenant_id: TENANT.labak, p_type: 'news', p_slug: `m307-${randomUUID().slice(0, 8)}` });
    const version = await rpc<number>('save_draft', {
      p_entry_id: entryId,
      p_expected_version: 1,
      p_data: news(imageId),
      p_schema_version: 1,
      p_title: null,
      p_sort_at: null,
    });
    const requestId = await rpc<string>('request_publish', { p_entry_id: entryId, p_expected_draft_version: version });
    return { entryId, requestId };
  }

  const state = async (requestId: string, entryId: string) =>
    (
      await ownerQuery(
        `select r.status, r.error, r.revision_id, e.published_rev_id,
                (select count(*)::int from cms.revisions v where v.entry_id = e.id) as revisions
         from cms.publish_requests r join cms.entries e on e.id = r.entry_id where r.id = $1 and e.id = $2`,
        [requestId, entryId],
      )
    )[0];

  it.each([
    ['false dimensions', { p_width: 4000, p_height: 3000 }, ['width', 'height']],
    ['a false MIME type', { p_mime: 'image/png' }, ['mime']],
    ['a false size and hash', { p_bytes: 12345, p_sha256: 'e'.repeat(64) }, ['bytes', 'sha256']],
  ])('an asset registered with %s is refused at publish and the entry is not committed', async (_, metadata, fields) => {
    const { id, path } = await upload();
    await register(id, path, metadata);
    const { entryId, requestId } = await requestPublish(id);

    const outcome = await processRequestById(requestId);

    expect(outcome).toMatchObject({ status: 'failed_validation', errors: { code: 'asset_mismatch', assetIds: [id] } });
    expect(await state(requestId, entryId)).toEqual({
      status: 'failed_validation',
      error: { code: 'asset_mismatch', assetIds: [id] },
      revision_id: null,
      published_rev_id: null,
      revisions: 0,
    });
    const [alert] = await ownerQuery<{ details: { assets: unknown } }>(
      `select details from cms.audit_log where action = 'system.alert.publish_request.asset_mismatch' and details ->> 'requestId' = $1`,
      [requestId],
    );
    expect(alert?.details.assets).toEqual([{ id, fields }]);
  });

  it('an asset registered with its true metadata is committed', async () => {
    const { id, path } = await upload();
    await register(id, path);
    const { entryId, requestId } = await requestPublish(id);

    expect(await processRequestById(requestId)).toMatchObject({ status: 'committed' });
    expect(await state(requestId, entryId)).toMatchObject({ status: 'committed', revisions: 1 });
  });
});
