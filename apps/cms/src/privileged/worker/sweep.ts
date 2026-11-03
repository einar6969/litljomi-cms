// The per-minute sweep (spec §6.1, §6.3, §7.1, §7.4, §8.4; plan Tasks 21 and 30, decisions 34.2,
// 35, 36.2 and 37.1): picks up whatever the fast path missed, deciding everything from the database.
//
//   0. Building releases older than STALE_RELEASE_SECONDS (a worker killed mid-build) are failed,
//      one alert each (api.worker_fail_stale_releases), so they no longer block their tenant's
//      builds; their requests are in no release, so step 2 builds them once the tenant's next build
//      attempt is due (M3-02).
//   1. Pending requests (and validating ones whose claim is older than 5 minutes) are processed.
//   2. Every active tenant with committed requests in no release gets a release built, delivered
//      and confirmed on its sites (api.worker_tenants_to_release), unless its latest build failed
//      and the next build attempt is not due yet.
//   3. Deliveries of each tenant's latest delivered release that still need a notification or a
//      live check are retried when their next attempt is due (api.worker_deliveries_to_retry). A
//      release superseded by a newer delivered one is never retried, and a release delivered by
//      step 2 of this same sweep is not retried in it.
//   4. Originals in media-private with no assets row, older than a day, are removed
//      (api.worker_private_orphans; M3-07).
//   5. Releases older than the previous one, an hour after the newer delivery, are removed from
//      `delivery` with the `media-public` objects no remaining release references, failed builds'
//      objects included (api.worker_claim_release_cleanup; M3-06, §7.2). The hour is read at the
//      options' clock.
//
// Steps 2 and 3 follow M3-02's schedule, kept by the database: after the n-th failed attempt the
// next is due 2^(n-1) minutes later (1, 2, 4 … minutes), until 24 hours after the first failure;
// then the retries are exhausted and the platform admin is alerted. The sweep reads the schedule
// at the options' clock (`now`, `Date.now` by default), so tests simulate the 24 hours.
//
// A failing step does not stop the next one; the sweep throws at the end if any step failed, so
// the cron route reports it.
import type { Bundle } from '@litljomi/cms-sdk';
import type { SupabaseClient } from '../../lib/supabase/types';
import { createAdminClient } from '../admin-client';
import { alert } from './alerts';
import { alertIfBuildRetriesExhausted, supabaseReleaseStorage } from './build-release';
import { clockOf, confirmRelease, deliverTenant, type DeliveredRelease, type DeliveryOptions } from './deliver';
import { removePrivateOrphans } from './media-orphans';
import { processPendingRequests } from './process-request';
import { removeExpiredReleaseFiles } from './retention';
import { callRpc } from './rpc';

/**
 * A building release older than this is failed by the sweep: the worker's maxDuration (300 s) plus
 * a 120 s margin (decision 37.1). The database function holds the same number.
 */
export const STALE_RELEASE_SECONDS = 420;

/** A row of api.worker_fail_stale_releases: a release the sweep failed. */
export type StaleRelease = { release_id: string; tenant_id: string; number: number; created_at: string };

/**
 * Fails every building release older than STALE_RELEASE_SECONDS and alerts once per release
 * (`release.stale_failed`), and once more when that failure exhausted the tenant's build retries
 * (`release.retries_exhausted`, M3-02). The database records the failure (`stale_building`),
 * schedules the tenant's next build and audits it; a worker still running that build is refused
 * when it finishes.
 */
export async function failStaleReleases(db: SupabaseClient): Promise<StaleRelease[]> {
  const failed = (await callRpc<StaleRelease[] | null>(db, 'worker_fail_stale_releases', {})) ?? [];
  for (const r of failed) {
    await alert('release.stale_failed', {
      tenantId: r.tenant_id,
      releaseId: r.release_id,
      number: r.number,
      createdAt: r.created_at,
      maxAgeSeconds: STALE_RELEASE_SECONDS,
    });
    await alertIfBuildRetriesExhausted(db, { tenantId: r.tenant_id, releaseId: r.release_id, number: r.number });
  }
  return failed;
}

/** A row of api.worker_deliveries_to_retry. */
type RetryRow = {
  release_id: string;
  tenant_id: string;
  tenant_slug: string;
  release_number: number;
  bundle_path: string;
  previous_bundle_path: string | null;
  site_id: string;
  notify_status: string;
  notify_attempts: number;
  live_status: string;
  requests: Array<{ id: string; entry_id: string; action: 'publish' | 'unpublish' }>;
};

export async function runSweep(options: DeliveryOptions = {}): Promise<void> {
  const db = createAdminClient();
  const errors: unknown[] = [];
  const failed = (step: string) => (error: unknown) => {
    console.error(`[cms-worker] sweep: ${step} failed`, error);
    errors.push(error);
  };

  // 0. Stale building releases, before anything is built.
  await failStaleReleases(db).catch(failed('failing stale releases'));

  // 1. Requests the fast path never processed (or left validating).
  await processPendingRequests().catch(failed('processing pending requests'));

  // 2. Releases for committed requests that are in none yet.
  const deliveredNow = new Set<string>();
  try {
    const tenants = (await callRpc<Array<{ tenant_id: string }> | null>(db, 'worker_tenants_to_release', { p_now: clockOf(options) })) ?? [];
    const results = await Promise.allSettled(tenants.map((t) => deliverTenant(t.tenant_id, { ...options, db })));
    for (const r of results) {
      if (r.status === 'rejected') failed('a release')(r.reason);
      else if (r.value.status === 'delivered' && r.value.releaseId) deliveredNow.add(r.value.releaseId);
    }
  } catch (error) {
    failed('listing tenants to release')(error);
  }

  // 3. One retry per delivery whose next attempt is due.
  try {
    await retryDeliveries(db, options, deliveredNow, failed);
  } catch (error) {
    failed('listing deliveries to retry')(error);
  }

  // 4. Orphaned private originals.
  await removePrivateOrphans(db).catch(failed('removing orphaned originals'));

  // 5. Expired releases and the public media only they referenced.
  await removeExpiredReleaseFiles(db, { now: () => new Date(clockOf(options)) }).catch(failed('removing expired release files'));

  if (errors.length > 0) throw new AggregateError(errors, `sweep: ${errors.length} step(s) failed`);
}

async function retryDeliveries(
  db: SupabaseClient,
  options: DeliveryOptions,
  skip: Set<string>,
  failed: (step: string) => (error: unknown) => void,
): Promise<void> {
  const rows = (await callRpc<RetryRow[] | null>(db, 'worker_deliveries_to_retry', { p_now: clockOf(options) })) ?? [];
  const byRelease = new Map<string, RetryRow[]>();
  for (const row of rows) {
    if (skip.has(row.release_id)) continue;
    byRelease.set(row.release_id, [...(byRelease.get(row.release_id) ?? []), row]);
  }
  const results = await Promise.allSettled([...byRelease.values()].map((group) => retryRelease(db, group, options)));
  for (const r of results) if (r.status === 'rejected') failed('a delivery retry')(r.reason);
}

async function retryRelease(db: SupabaseClient, rows: RetryRow[], options: DeliveryOptions): Promise<void> {
  const first = rows[0]!;
  const storage = supabaseReleaseStorage(db);
  const read = async (path: string, release: number | null): Promise<Bundle> => {
    const bundle = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await storage.download('delivery', path))) as Bundle;
    if (bundle?.format !== 1 || bundle.tenant !== first.tenant_slug || (release !== null && bundle.release !== release)) {
      throw new Error(`bundle ${path} is not release ${String(release)} of ${first.tenant_slug}`);
    }
    return bundle;
  };
  const release: DeliveredRelease = {
    tenantId: first.tenant_id,
    tenantSlug: first.tenant_slug,
    releaseId: first.release_id,
    number: first.release_number,
    bundle: await read(first.bundle_path, first.release_number),
    previousBundle: first.previous_bundle_path ? await read(first.previous_bundle_path, null) : null,
    requests: first.requests.map((r) => ({ id: r.id, entryId: r.entry_id, action: r.action })),
  };
  // Only the sites listed for retry (one deactivated since is skipped).
  await confirmRelease(db, release, options, new Set(rows.map((row) => row.site_id)));
}
