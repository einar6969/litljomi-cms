// Retention and public-media cleanup (spec §5.6 "Withdrawal", §7.2 "Retention", §8.4; plan M3-06;
// deferred Minor Task 20 security r1). Only the current and the previous release stay public: an
// hour after a release is delivered, the release before the previous one is deleted from
// `delivery`, with the `media-public` objects no remaining release references. Failed builds'
// objects go the same way, so nothing a build wrote stays public at an unrecorded path.
//
// The database decides what has expired and what is still referenced
// (api.worker_claim_release_cleanup, which also clears the claimed media's public_path, so a later
// build copies it again). The sweep deletes the claimed objects through the Storage API and then
// marks the releases cleaned (api.worker_finish_release_cleanup). When a deletion fails, the claim
// is released at once and a later sweep claims the release again.
//
// Paths are built here, through storage-paths, never taken from the database as strings: an asset
// whose filename the build would refuse was never copied, so it has nothing to delete.
import type { SupabaseClient } from '../../lib/supabase/types';
import { callRpc } from './rpc';
import { deliveryBundlePath, publicMediaPath } from './storage-paths';

/** Expired releases claimed per sweep at most. */
export const RELEASES_PER_SWEEP = 20;

/** Storage's batch delete limit (names per remove call). */
const REMOVE_BATCH = 1000;

const DELIVERY = 'delivery';
const MEDIA_PUBLIC = 'media-public';

/** A row of api.worker_claim_release_cleanup: a release's bundle (no asset) or one of its media objects. */
type ClaimRow = {
  release_id: string;
  tenant_id: string;
  tenant_slug: string;
  release_number: number;
  asset_id: string | null;
  filename: string | null;
};

export type RetentionOptions = {
  /** The worker's clock, for the hour after delivery (§7.2); tests simulate time through it. */
  now?: () => Date;
  limit?: number;
};

export type RetentionResult = {
  /** Releases whose public files are now deleted. */
  releaseIds: string[];
  /** Object names removed, per bucket. */
  removed: { delivery: string[]; mediaPublic: string[] };
};

/**
 * Claims expired releases, deletes their bundles and the media nothing newer references, and marks
 * them cleaned. A failed claim or deletion is thrown (the sweep reports it); a failed deletion
 * first releases the claim.
 */
export async function removeExpiredReleaseFiles(db: SupabaseClient, options: RetentionOptions = {}): Promise<RetentionResult> {
  const now = options.now ?? (() => new Date());
  const rows =
    (await callRpc<ClaimRow[] | null>(db, 'worker_claim_release_cleanup', {
      p_now: now().toISOString(),
      p_limit: options.limit ?? RELEASES_PER_SWEEP,
    })) ?? [];
  const releaseIds = [...new Set(rows.map((r) => r.release_id))];
  const removed: RetentionResult['removed'] = { delivery: [], mediaPublic: [] };
  if (releaseIds.length === 0) return { releaseIds, removed };

  try {
    for (const row of rows) {
      if (row.asset_id === null) {
        removed.delivery.push(deliveryBundlePath(row.tenant_slug, row.release_number));
        continue;
      }
      const path = mediaPathOrNull(row.tenant_slug, row.asset_id, row.filename);
      if (path !== null) removed.mediaPublic.push(path);
    }
    await removeAll(db, DELIVERY, removed.delivery);
    await removeAll(db, MEDIA_PUBLIC, removed.mediaPublic);
  } catch (error) {
    await callRpc(db, 'worker_finish_release_cleanup', { p_release_ids: releaseIds, p_deleted: false }).catch((releaseError: unknown) => {
      console.error('[cms-worker] retention: the claim could not be released', releaseError);
    });
    throw error;
  }
  await callRpc(db, 'worker_finish_release_cleanup', { p_release_ids: releaseIds, p_deleted: true });
  return { releaseIds, removed };
}

/** The media object's path, or null for a filename the build refuses (never copied). */
function mediaPathOrNull(slug: string, assetId: string, filename: string | null): string | null {
  if (filename === null) return null;
  try {
    return publicMediaPath(slug, assetId, filename);
  } catch {
    return null;
  }
}

async function removeAll(db: SupabaseClient, bucket: string, names: string[]): Promise<void> {
  for (let i = 0; i < names.length; i += REMOVE_BATCH) {
    const batch = names.slice(i, i + REMOVE_BATCH);
    const { error } = await db.storage.from(bucket).remove(batch);
    if (error) throw new Error(`${bucket} remove(${batch.length} objects): ${error.message}`);
  }
}
