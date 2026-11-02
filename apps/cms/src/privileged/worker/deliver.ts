// Worker step 3: deliver a release to the tenant's sites (spec §7.1, §7.3, §7.4; plan Task 21,
// decisions 10 and 35). After a delivered build, each active site is notified (signed webhook)
// and the result recorded; then every request linked to the release is live-checked against that
// site and the site's live status recorded: 'ok' only when every check passed, 'not_confirmed'
// otherwise, with the failures in last_error. A failed notification leaves the live status
// pending, for the sweep to retry.
import type { LiveCheck, ModuleManifest, ReleaseView, SiteEntry } from '@litljomi/cms-schema';
import type { Bundle, BundleEntry } from '@litljomi/cms-sdk';
import { getModule } from '@/modules/registry';
import { MAX_NOTIFY_ATTEMPTS } from '../../lib/delivery';
import { supabaseUrl } from '../../lib/supabase/env';
import type { SupabaseClient } from '../../lib/supabase/types';
import { createAdminClient } from '../admin-client';
import { alert } from './alerts';
import { buildRelease, type BuildOptions, type BuildResult, type LinkedRequest } from './build-release';
import { createPageFetcher, runLiveChecks, type LiveCheckFailure } from './live-check';
import { notifySite } from './notify';
import { publicMediaUrl } from './projection-context';
import { callRpc } from './rpc';

// The attempt limit lives in lib/delivery.ts, which the editor's status display also reads
// (decision 37.8); re-exported for the sweep and the tests.
export { MAX_NOTIFY_ATTEMPTS };

/** At most this many live-check failures are stored in last_error. */
const MAX_STORED_FAILURES = 50;

/** Poll and timeout of the live checks (§7.4 defaults when absent); injectable for tests. */
export type DeliveryOptions = { pollMs?: number; timeoutMs?: number };

/** An active site as api.worker_sites returns it. */
export type WorkerSite = { id: string; base_url: string; revalidate_url: string; webhook_secrets: string[] };

/** A delivered release and what its live checks need. */
export type DeliveredRelease = {
  tenantId: string;
  tenantSlug: string;
  releaseId: string;
  number: number;
  bundle: Bundle;
  previousBundle: Bundle | null;
  requests: LinkedRequest[];
};

/** One entry to confirm: a failure decided before any fetch, or its checks. */
export type LiveTarget = {
  entryId: string;
  requestIds: string[];
  /** `delivery_failed` (left out of the release, §7.1) or `checks_failed` (the module threw). */
  failure: string | null;
  checks: LiveCheck[];
  ownPath: string;
  contentHash: string | null;
  mediaUrls: string[];
};

/** A bundle as the module's `checks` see it: each type's entries by sortAt descending. */
export function releaseView(bundle: Bundle | null): ReleaseView {
  return {
    entries(type: string): SiteEntry[] {
      const list = bundle && Object.hasOwn(bundle.entries, type) ? (bundle.entries[type] ?? []) : [];
      return list
        .map((e) => siteEntry(type, e))
        .sort((a, b) => (a.sortAt === b.sortAt ? 0 : a.sortAt === null ? 1 : b.sortAt === null ? -1 : a.sortAt < b.sortAt ? 1 : -1));
    },
  };
}

const siteEntry = (type: string, e: BundleEntry): SiteEntry => ({ id: e.id, type, slug: e.slug, sortAt: e.sortAt });

function find(bundle: Bundle | null, id: string): { type: string; entry: BundleEntry } | null {
  if (!bundle) return null;
  for (const [type, list] of Object.entries(bundle.entries)) {
    const entry = list.find((e) => e.id === id);
    if (entry) return { type, entry };
  }
  return null;
}

/** Every string in the projected data that is a public media URL (`mediaPrefix` + path), in order, once. */
function mediaUrlsIn(data: unknown, mediaPrefix: string): string[] {
  const found = new Set<string>();
  const walk = (v: unknown, depth: number) => {
    if (depth > 256) return;
    if (typeof v === 'string') {
      if (v.startsWith(mediaPrefix) && v.length > mediaPrefix.length) found.add(v);
    } else if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
    } else if (v !== null && typeof v === 'object') {
      for (const x of Object.values(v)) walk(x, depth + 1);
    }
  };
  walk(data, 0);
  return [...found];
}

/**
 * The entries a release must confirm, one per entry among its linked requests (in request order).
 * The release's content decides what is checked, so it agrees with the module's checks:
 *
 * - in the release: the module's checks for it (given this release and the previous one), its new
 *   content hash, its own path and its media URLs;
 * - not in the release, with a publish as its last request: left out of the build (omitted), so
 *   `delivery_failed` (§7.1: never live);
 * - not in the release after an unpublish: the checks for the record the previous release had
 *   (no hash, no media); nothing to check when no delivered release contained it.
 */
export function liveTargets(
  module: ModuleManifest,
  release: Pick<DeliveredRelease, 'bundle' | 'previousBundle' | 'requests'>,
  mediaPrefix: string,
): LiveTarget[] {
  const byEntry = new Map<string, LinkedRequest[]>();
  for (const r of release.requests) byEntry.set(r.entryId, [...(byEntry.get(r.entryId) ?? []), r]);
  const current = releaseView(release.bundle);
  const previous = release.previousBundle ? releaseView(release.previousBundle) : null;

  return [...byEntry].map(([entryId, requests]): LiveTarget => {
    const base = { entryId, requestIds: requests.map((r) => r.id), failure: null, checks: [], ownPath: '', contentHash: null, mediaUrls: [] };
    const inRelease = find(release.bundle, entryId);
    const last = requests[requests.length - 1]!;
    if (!inRelease && last.action === 'publish') return { ...base, failure: 'delivery_failed' };
    const record = inRelease ?? find(release.previousBundle, entryId);
    if (!record) return base;
    const own = inRelease ? { contentHash: inRelease.entry.contentHash, mediaUrls: mediaUrlsIn(inRelease.entry.data, mediaPrefix) } : {};
    const integration = Object.hasOwn(module.site, record.type) ? module.site[record.type] : undefined;
    if (!integration) return { ...base, ...own };
    try {
      const e = siteEntry(record.type, record.entry);
      return { ...base, ...own, checks: integration.checks(e, current, previous), ownPath: integration.path(e) };
    } catch {
      return { ...base, ...own, failure: 'checks_failed' };
    }
  });
}

// Runs `fn` at most once per run: `done` is set before the call, so a resend that throws is not
// repeated (theoretical here, since `notifySite` never throws).
const once = (fn: () => Promise<unknown>) => {
  let done = false;
  return async () => {
    if (done) return;
    done = true;
    await fn();
  };
};

/** Records on site_deliveries; a failure is logged, not thrown (the sweep retries what is left). */
async function record(db: SupabaseClient, releaseId: string, siteId: string, notify: string | null, live: string | null, error: unknown) {
  try {
    await callRpc(db, 'worker_record_delivery', {
      p_release_id: releaseId,
      p_site_id: siteId,
      p_notify_status: notify,
      p_live_status: live,
      p_error: error ?? null,
    });
  } catch (e) {
    console.error(`[cms-worker] delivery of release ${releaseId} to site ${siteId} could not be recorded`, e);
  }
}

export type SiteOutcome = 'ok' | 'not_confirmed' | 'notify_failed';

/**
 * Notifies one site and records it; when the notification succeeded, live-checks every target and
 * records the live status (notify status null then). `attemptsBefore` is the delivery's attempt
 * count before this notification: when this one fails and reaches MAX_NOTIFY_ATTEMPTS, the
 * platform admin is alerted (§7.4: retries exhausted).
 */
export async function confirmSite(
  db: SupabaseClient,
  release: DeliveredRelease,
  site: WorkerSite,
  targets: LiveTarget[],
  options: DeliveryOptions,
  attemptsBefore = 0,
): Promise<SiteOutcome> {
  const payload = { tenant: release.tenantSlug, release: release.number };
  const notified = await notifySite(site, payload);
  if (!notified.ok) {
    const error = { code: site.webhook_secrets.some((s) => s !== '') ? 'notify_failed' : 'no_webhook_secret', status: notified.status };
    await record(db, release.releaseId, site.id, 'failed', null, error);
    if (attemptsBefore + 1 >= MAX_NOTIFY_ATTEMPTS) {
      await alert('delivery.retries_exhausted', {
        tenantId: release.tenantId,
        releaseId: release.releaseId,
        number: release.number,
        siteId: site.id,
        attempts: attemptsBefore + 1,
        ...error,
      });
    }
    return 'notify_failed';
  }
  await record(db, release.releaseId, site.id, 'ok', null, null);

  // One resend per site and delivery, whichever entry saw the stale hash first (§7.4).
  const resend = once(() => notifySite(site, payload));
  // One fetcher per site and delivery, created after the notification: the targets share identical
  // page fetches and at most MAX_CONCURRENT_FETCHES run at a time against the site.
  const fetchPage = createPageFetcher();
  const failures: Array<LiveCheckFailure & { entryId: string }> = [];
  await Promise.all(
    targets.map(async (t) => {
      if (t.failure !== null) {
        failures.push({ entryId: t.entryId, path: t.ownPath, reason: t.failure });
        return;
      }
      const result = await runLiveChecks({
        baseUrl: site.base_url,
        checks: t.checks,
        ownPath: t.ownPath,
        entry: { id: t.entryId, contentHash: t.contentHash },
        mediaUrls: t.mediaUrls,
        resend,
        fetchPage,
        pollMs: options.pollMs,
        timeoutMs: options.timeoutMs,
      });
      for (const f of result.failures) failures.push({ entryId: t.entryId, ...f });
    }),
  );
  if (failures.length === 0) {
    await record(db, release.releaseId, site.id, null, 'ok', null);
    return 'ok';
  }
  await record(db, release.releaseId, site.id, null, 'not_confirmed', {
    code: 'live_not_confirmed',
    failures: failures.slice(0, MAX_STORED_FAILURES),
    ...(failures.length > MAX_STORED_FAILURES ? { more: failures.length - MAX_STORED_FAILURES } : {}),
  });
  return 'not_confirmed';
}

/** The public media URL prefix of this project (`…/media-public/`). */
export function mediaPrefix(): string {
  return publicMediaUrl(supabaseUrl(), '');
}

/**
 * Notifies and live-checks the tenant's active sites for a delivered release, concurrently: the
 * fast path confirms every active site; the sweep's retry passes `retry`, the sites to confirm with
 * each one's notify attempts so far, and a site deactivated since it was listed is skipped. Every
 * site's confirmation settles before this returns; one site's error does not stop the others, and
 * the errors are thrown together as an AggregateError.
 */
export async function confirmRelease(
  db: SupabaseClient,
  release: DeliveredRelease,
  options: DeliveryOptions,
  retry?: ReadonlyMap<string, number>,
): Promise<void> {
  const module = getModule(release.tenantSlug);
  if (!module) throw new Error(`no module for tenant ${release.tenantSlug}`);
  const targets = liveTargets(module, release, mediaPrefix());
  const active = (await callRpc<WorkerSite[] | null>(db, 'worker_sites', { p_tenant_id: release.tenantId })) ?? [];
  const sites = retry ? active.filter((site) => retry.has(site.id)) : active;
  const results = await Promise.allSettled(sites.map((site) => confirmSite(db, release, site, targets, options, retry?.get(site.id) ?? 0)));
  const errors = results.flatMap((r) => (r.status === 'rejected' ? [r.reason] : []));
  if (errors.length > 0) throw new AggregateError(errors, `release ${release.number}: ${errors.length} site confirmation(s) failed`);
}

/**
 * Builds the tenant's next release and, when it is delivered, confirms it on every active site.
 * `busy` (another build is running; it or the sweep delivers what is committed) and `failed` (the
 * build alerted; the sweep rebuilds) are returned as they are.
 */
export async function deliverTenant(tenantId: string, options: DeliveryOptions & Pick<BuildOptions, 'db'> = {}): Promise<BuildResult> {
  const db = options.db ?? createAdminClient();
  const result = await buildRelease(tenantId, { db });
  if (result.status !== 'delivered' || !result.bundle || !result.releaseId || result.number === undefined) return result;
  await confirmRelease(
    db,
    {
      tenantId,
      tenantSlug: result.bundle.tenant,
      releaseId: result.releaseId,
      number: result.number,
      bundle: result.bundle,
      previousBundle: result.previousBundle ?? null,
      requests: result.requests ?? [],
    },
    options,
  );
  return result;
}
