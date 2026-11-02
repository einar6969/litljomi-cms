// The per-minute sweep (spec §6.1, §6.3, §7.4, §8.4; plan Task 21, decisions 34.2 and 35): picks up
// whatever the fast path missed, deciding everything from the database.
//
//   1. Pending requests (and validating ones whose claim is older than 5 minutes) are processed.
//   2. Every active tenant with committed requests in no release gets a release built, delivered
//      and confirmed on its sites (api.worker_tenants_to_release).
//   3. Deliveries of each tenant's latest delivered release that still need a notification or a
//      live check are retried once per sweep, up to MAX_NOTIFY_ATTEMPTS attempts
//      (api.worker_deliveries_to_retry). A release superseded by a newer delivered one is never
//      retried, and a release delivered by step 2 of this same sweep is not retried in it.
//
// A failing step does not stop the next one; the sweep throws at the end if any step failed, so
// the cron route reports it.
import type { Bundle } from '@litljomi/cms-sdk';
import { getModule } from '@/modules/registry';
import type { SupabaseClient } from '../../lib/supabase/types';
import { createAdminClient } from '../admin-client';
import { supabaseReleaseStorage } from './build-release';
import {
  MAX_NOTIFY_ATTEMPTS,
  confirmSite,
  deliverTenant,
  liveTargets,
  mediaPrefix,
  type DeliveredRelease,
  type DeliveryOptions,
  type WorkerSite,
} from './deliver';
import { processPendingRequests } from './process-request';
import { callRpc } from './rpc';

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

  // 1. Requests the fast path never processed (or left validating).
  await processPendingRequests().catch(failed('processing pending requests'));

  // 2. Releases for committed requests that are in none yet.
  const deliveredNow = new Set<string>();
  try {
    const tenants = (await callRpc<Array<{ tenant_id: string }> | null>(db, 'worker_tenants_to_release', {})) ?? [];
    const results = await Promise.allSettled(tenants.map((t) => deliverTenant(t.tenant_id, { ...options, db })));
    for (const r of results) {
      if (r.status === 'rejected') failed('a release')(r.reason);
      else if (r.value.status === 'delivered' && r.value.releaseId) deliveredNow.add(r.value.releaseId);
    }
  } catch (error) {
    failed('listing tenants to release')(error);
  }

  // 3. One retry per delivery that still needs it.
  try {
    await retryDeliveries(db, options, deliveredNow, failed);
  } catch (error) {
    failed('listing deliveries to retry')(error);
  }

  if (errors.length > 0) throw new AggregateError(errors, `sweep: ${errors.length} step(s) failed`);
}

async function retryDeliveries(
  db: SupabaseClient,
  options: DeliveryOptions,
  skip: Set<string>,
  failed: (step: string) => (error: unknown) => void,
): Promise<void> {
  const rows = (await callRpc<RetryRow[] | null>(db, 'worker_deliveries_to_retry', { p_max_attempts: MAX_NOTIFY_ATTEMPTS })) ?? [];
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
  const module = getModule(release.tenantSlug);
  if (!module) throw new Error(`no module for tenant ${release.tenantSlug}`);
  const targets = liveTargets(module, release, mediaPrefix());
  const sites = new Map(
    ((await callRpc<WorkerSite[] | null>(db, 'worker_sites', { p_tenant_id: release.tenantId })) ?? []).map((s) => [s.id, s]),
  );
  await Promise.all(
    rows.map(async (row) => {
      const site = sites.get(row.site_id);
      // Deactivated since the list was read: nothing to retry.
      if (site) await confirmSite(db, release, site, targets, options, row.notify_attempts);
    }),
  );
}
