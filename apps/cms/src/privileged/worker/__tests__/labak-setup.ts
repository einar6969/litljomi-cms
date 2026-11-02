// Shared setup of the worker's integration tests on labak (plan Tasks 20, 21 and 30). Integration
// files run one after another in one process (vitest.integration.config.ts), so a labak release
// still building when a file starts was left by a run that stopped mid-build.
import { secretClient } from '../../../../../../tests/integration/src/clients.ts';
import { TENANT } from '../../../../../../tests/integration/src/fixtures.ts';
import { ownerQuery, withTx } from '../../../../../../tests/integration/src/sql.ts';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);

/** Makes a release stale (older than 420 s) and fails it as the sweep does; returns the releases it failed. */
export async function failAsStale(releaseId: string): Promise<string[]> {
  await ownerQuery(`update cms.releases set created_at = now() - interval '421 seconds' where id = $1 and status = 'building'`, [releaseId]);
  const rows = await withTx('service', async (w) => (await w.query('select release_id from api.worker_fail_stale_releases()')).rows);
  return rows.map((r: { release_id: string }) => r.release_id);
}

/**
 * Leftovers of earlier runs. A building release blocks the tenant: it is failed the way the sweep
 * fails it (Task 30), only once it is stale, so a build that is genuinely running is never killed;
 * a younger one stops the run with a clear message. Published originals must exist to be copied.
 */
export async function prepareLabak(): Promise<void> {
  await withTx('service', (w) => w.query('select * from api.worker_fail_stale_releases()'));
  const building = await ownerQuery<{ number: number; created_at: string }>(
    `select number, created_at from cms.releases where tenant_id = $1 and status = 'building'`,
    [TENANT.labak],
  );
  if (building.length > 0) {
    const r = building[0]!;
    throw new Error(
      `labak release ${r.number} is building since ${r.created_at} (another run, or one stopped less than 420 s ago): wait for it, or run pnpm db:reset`,
    );
  }
  const originals = await ownerQuery<{ original_path: string }>(
    `select distinct a.original_path from cms.assets a
     join cms.revision_refs rr on rr.tenant_id = a.tenant_id and rr.target_asset_id = a.id
     join cms.entries e on e.tenant_id = rr.tenant_id and e.published_rev_id = rr.revision_id
     where a.tenant_id = $1 and a.public_path is null and a.archived_at is null and e.archived_at is null`,
    [TENANT.labak],
  );
  for (const { original_path } of originals) {
    const { error } = await secretClient().storage.from('media-private').upload(original_path, JPEG, { contentType: 'image/jpeg' });
    if (error && String((error as { statusCode?: unknown }).statusCode) !== '409') throw error;
  }
}
