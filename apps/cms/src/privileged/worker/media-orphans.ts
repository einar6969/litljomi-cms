// Removal of orphaned originals in media-private (spec §5.6; M3-07, deferred Minors Task 24 security
// r1 and P4 follow-up security r1). An upload the server action refused, one whose registration
// never ran, or one a suspended tenant's member made (Storage lets the upload through; register_asset
// then refuses it) leaves an object in media-private with no assets row. Editors cannot delete
// (media-private has no delete policy), so the sweep does: every object without an assets row that
// is older than ORPHAN_GRACE_SECONDS is removed through the Storage API.
//
// The database lists the orphans (api.worker_private_orphans, which refuses a grace period under an
// hour), so an upload whose registration is still on its way is never touched. An original with an
// assets row, archived or not, is always kept.
import type { SupabaseClient } from '../../lib/supabase/types';
import { callRpc } from './rpc';
import { MEDIA_PRIVATE } from './storage-paths';

/** How old an unregistered original must be before the sweep removes it: one day. */
export const ORPHAN_GRACE_SECONDS = 24 * 60 * 60;

/** Orphans removed per sweep at most (one Storage batch delete). */
export const ORPHANS_PER_SWEEP = 100;

export type OrphanOptions = { graceSeconds?: number; limit?: number };

/**
 * Lists up to `limit` orphaned originals older than the grace period and removes them in one batch.
 * Returns the names removed. A failed listing or removal is thrown (the sweep reports it); what is
 * left is retried by the next sweep.
 */
export async function removePrivateOrphans(db: SupabaseClient, options: OrphanOptions = {}): Promise<string[]> {
  const rows =
    (await callRpc<Array<{ name: string }> | null>(db, 'worker_private_orphans', {
      p_grace_seconds: options.graceSeconds ?? ORPHAN_GRACE_SECONDS,
      p_limit: options.limit ?? ORPHANS_PER_SWEEP,
    })) ?? [];
  const names = rows.map((r) => r.name);
  if (names.length === 0) return [];
  const { error } = await db.storage.from(MEDIA_PRIVATE).remove(names);
  if (error) throw new Error(`media-private remove(${names.length} orphans): ${error.message}`);
  return names;
}
