// Worker step 3: deliver a release to the tenant's sites (spec §7.1, §7.3, §7.4; plan Task 21,
// decisions 10 and 35). After a delivered build, each active site is notified (signed webhook)
// and the result recorded; then every request linked to the release is live-checked against that
// site and the site's live status recorded: 'ok' only when every check passed, 'not_confirmed'
// otherwise, with the failures in last_error. A failed notification leaves the live status
// pending, for the sweep to retry on the database's schedule (M3-02: exponential backoff for up to
// 24 hours from the delivery's first failure; the platform admin is alerted when it runs out).
// A not_confirmed delivery is retried on the same schedule (M3-03): the sweep notifies the site
// again and runs the full live check, until it passes, a newer release supersedes it, or the 24
// hours run out (then the alert, and the editor sees "delivery failed").
// W1: a delivery that missed also stores, in last_error, the withdrawal checks the site has not
// confirmed (computed now, while this release's bundle and the one before exist) and those it
// confirmed. Once a newer release supersedes the release, the sweep keeps running only those
// stored checks on the same schedule (confirmWithdrawals), telling the site about the latest
// release, until they pass, the entry is published again or the 24 hours run out; when the hour
// after the release ends unconfirmed, `delivery.withdrawal_unconfirmed` is raised once per release
// and site (migration 20261104180000_withdrawal_confirmation).
// Before a fresh delivery notifies any site, the worker waits, within a bound, until the pointer's
// public URL serves the release (decision 49.1), and stores how long that took on the release
// (M3-08: the pointer lag, a measured limitation).
// M5-01: a release's withdrawal state is stored on each delivery before that wait, so a run killed
// during the poll or the live window leaves a row the sweep retries and alerts on.
import type { LiveCheck, ModuleManifest, ReleaseView, SiteEntry } from '@litljomi/cms-schema';
import type { Bundle, BundleEntry } from '@litljomi/cms-sdk';
import { getModule } from '@/modules/registry';
import { supabaseUrl } from '../../lib/supabase/env';
import type { SupabaseClient } from '../../lib/supabase/types';
import { createAdminClient } from '../admin-client';
import { alert } from './alerts';
import { buildRelease, type BuildOptions, type BuildResult, type LinkedRequest } from './build-release';
import { DEFAULT_TIMEOUT_MS, createPageFetcher, runLiveChecks, type LiveCheckFailure } from './live-check';
import { notifySite } from './notify';
import { waitForPublicPointer, type PointerSeams, type PointerWaitResult } from './pointer-fresh';
import { publicMediaUrl } from './projection-context';
import { callRpc } from './rpc';

/** At most this many live-check failures are stored in last_error. */
const MAX_STORED_FAILURES = 50;

/**
 * Poll and timeout of the live checks (§7.4 defaults when absent); injectable for tests.
 * `runDeadline` is when the run must be finished (epoch ms), which bounds the pointer poll; the
 * worker's jobs set it (pipeline.ts), and without it the poll has only its own cap. `pointer`
 * replaces the poll's fetch, clock and pause in tests. `now` is the clock (epoch ms) the retry
 * schedule is kept and read by (M3-02): passed to the database as `p_now`, so tests simulate the
 * 24 hours instead of waiting; `Date.now` when absent.
 */
export type DeliveryOptions = { pollMs?: number; timeoutMs?: number; runDeadline?: number; pointer?: PointerSeams; now?: () => number };

/** The clock of `options` as the database's `p_now` (an ISO timestamp). */
export const clockOf = (options: Pick<DeliveryOptions, 'now'>): string => new Date((options.now ?? Date.now)()).toISOString();

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
  /** When the pointer was written (epoch ms), for the live check's resend; absent on a retry (decision 48). */
  pointerWrittenAt?: number;
};

/** One entry to confirm: a failure decided before any fetch, or its checks. */
export type LiveTarget = {
  entryId: string;
  requestIds: string[];
  /**
   * `delivery_failed` (left out of the release, §7.1), `still_published` (withdrawn, but the entry is
   * in the release), `withdrawal_unchecked` (withdrawn, an earlier release reached a site with it,
   * and no bundle here holds a record to check it by) or `checks_failed` (the module threw).
   */
  failure: string | null;
  checks: LiveCheck[];
  ownPath: string;
  contentHash: string | null;
  mediaUrls: string[];
  /**
   * W1: a withdrawal of this release (the entry's last request is an unpublish, the entry is not in
   * the release, no failure but `withdrawal_unchecked`). Its checks are stored on a delivery that
   * misses them.
   */
  withdrawal?: true;
};

/**
 * A withdrawal check as a delivery stores it (W1): enough to run it again without any bundle.
 * `unchecked`: no record to check it by (`withdrawal_unchecked`), so it can never pass.
 */
export type StoredWithdrawal = { entryId: string; requestIds: string[]; checks: LiveCheck[]; ownPath: string; unchecked?: true };

/**
 * A site's withdrawal state for a superseded release, as api.worker_deliveries_to_retry gives it
 * (W1): the stored checks still to confirm (only entries whose latest committed request is still
 * the release's unpublish), the entries already confirmed, whether anything else in the release was
 * unconfirmed on the site, whether the alert was raised, whether the hour after the release ended,
 * and whether the 24 hours since the state was first stored did (M5-01).
 */
export type WithdrawalState = { pending: StoredWithdrawal[]; withdrawn: string[]; others: boolean; alerted: boolean; hourOver: boolean; expired: boolean };

/** A superseded release whose withdrawals are checked again (W1); `notifyRelease` is the tenant's latest delivered release. */
export type WithdrawalRelease = { tenantId: string; tenantSlug: string; releaseId: string; number: number; notifyRelease: number };

const stored = (t: LiveTarget): StoredWithdrawal => ({
  entryId: t.entryId,
  requestIds: t.requestIds,
  checks: t.checks,
  ownPath: t.ownPath,
  ...(t.failure !== null ? { unchecked: true as const } : {}),
});

/** Whether a target keeps its delivery from settling on withdrawal checks alone: not a withdrawal, or one nothing can prove. */
const beyondWithdrawalChecks = (t: LiveTarget): boolean => !t.withdrawal || t.failure !== null;

/** W1: the withdrawal state of a delivery that confirmed nothing yet; null when the release withdraws nothing it can check. */
function unconfirmedState(targets: LiveTarget[]): { withdrawals: StoredWithdrawal[]; withdrawals_others: boolean } | null {
  const withdrawals = targets.filter((t) => t.withdrawal);
  return withdrawals.length > 0 ? { withdrawals: withdrawals.map(stored), withdrawals_others: targets.some(beyondWithdrawalChecks) } : null;
}

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
 *   (no hash, no media). With no such record, nothing to check when no site ever had it (§7.4;
 *   api.worker_entry_was_delivered); otherwise `withdrawal_unchecked`: a site may still hold it
 *   (from an older release, or a failed release whose pointer was written), so the withdrawal is
 *   never confirmed with nothing checked (M5-01);
 * - in the release, with an unpublish as its last request: `still_published`. The withdrawal is not
 *   what the release delivered (an older publish committed after it, say), so it is never confirmed:
 *   the entry's own present checks would pass and show it removed (§7.1: withdrawal always wins).
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
    if (inRelease && last.action === 'unpublish') return { ...base, failure: 'still_published' };
    const record = inRelease ?? find(release.previousBundle, entryId);
    const withdrawal = !inRelease && last.action === 'unpublish' ? ({ withdrawal: true } as const) : {};
    if (!record) return last.wasDelivered === false ? { ...base, ...withdrawal } : { ...base, ...withdrawal, failure: 'withdrawal_unchecked' };
    const own = inRelease ? { contentHash: inRelease.entry.contentHash, mediaUrls: mediaUrlsIn(inRelease.entry.data, mediaPrefix) } : {};
    const integration = Object.hasOwn(module.site, record.type) ? module.site[record.type] : undefined;
    if (!integration) return { ...base, ...own, ...withdrawal };
    try {
      const e = siteEntry(record.type, record.entry);
      return { ...base, ...own, ...withdrawal, checks: integration.checks(e, current, previous), ownPath: integration.path(e) };
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

/** A row of api.worker_record_delivery: the delivery's schedule after the call (M3-02). */
export type RecordedDelivery = { notify_attempts: number; next_attempt_at: string | null; retries_exhausted: boolean };

/**
 * Records on site_deliveries at the options' clock and returns the delivery's schedule; a failure
 * is logged, not thrown, and gives null (the row is unchanged, so the sweep retries what is left).
 */
async function record(
  db: SupabaseClient,
  releaseId: string,
  siteId: string,
  notify: string | null,
  live: string | null,
  error: unknown,
  options: DeliveryOptions,
): Promise<RecordedDelivery | null> {
  try {
    const rows = await callRpc<RecordedDelivery[] | null>(db, 'worker_record_delivery', {
      p_release_id: releaseId,
      p_site_id: siteId,
      p_notify_status: notify,
      p_live_status: live,
      p_error: error ?? null,
      p_now: clockOf(options),
    });
    return rows?.[0] ?? null;
  } catch (e) {
    console.error(`[cms-worker] delivery of release ${releaseId} to site ${siteId} could not be recorded`, e);
    return null;
  }
}

export type SiteOutcome = 'ok' | 'not_confirmed' | 'notify_failed';

/**
 * Notifies one site and records it; when the notification succeeded, live-checks every target and
 * records the live status (notify status null then). A failed notification and a missed live check
 * (not_confirmed, M3-03) are scheduled by the database (M3-02); when the record says the retries
 * are exhausted (24 hours since the delivery's first failure), the platform admin is alerted
 * (§7.4), once: an exhausted delivery is never selected for a retry again.
 */
export async function confirmSite(
  db: SupabaseClient,
  release: DeliveredRelease,
  site: WorkerSite,
  targets: LiveTarget[],
  options: DeliveryOptions,
): Promise<SiteOutcome> {
  const payload = { tenant: release.tenantSlug, release: release.number };
  // W1: the withdrawals this release can check, stored on a delivery that does not confirm them.
  const withdrawals = targets.filter((t) => t.withdrawal);
  const notified = await notifySite(site, payload);
  if (!notified.ok) {
    const error = notifyError(site, notified.status);
    const state = unconfirmedState(targets);
    const recorded = await record(db, release.releaseId, site.id, 'failed', null, { ...error, ...state }, options);
    if (recorded?.retries_exhausted) {
      await alert('delivery.retries_exhausted', {
        tenantId: release.tenantId,
        releaseId: release.releaseId,
        number: release.number,
        siteId: site.id,
        attempts: recorded.notify_attempts,
        ...error,
      });
    }
    return 'notify_failed';
  }
  await record(db, release.releaseId, site.id, 'ok', null, null, options);

  const log = { tenant: release.tenantSlug, release: release.number, siteId: site.id };
  // One resend per site and delivery, whichever entry's page missed first (§7.4, decision 48.1),
  // logged with the time since the pointer was written (decision 49.1).
  // The line is written in a finally, so that a resend that throws is logged too.
  const resend = once(async () => {
    let ok = false;
    try {
      ok = (await notifySite(site, payload)).ok;
    } finally {
      console.info('[cms-worker] resend', {
        ...log,
        ...(release.pointerWrittenAt !== undefined ? { msSincePointerWrite: Date.now() - release.pointerWrittenAt } : {}),
        ok,
      });
    }
  });
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
        pointerWrittenAt: release.pointerWrittenAt,
        fetchPage,
        pollMs: options.pollMs,
        timeoutMs: options.timeoutMs,
      });
      for (const f of result.failures) failures.push({ entryId: t.entryId, ...f });
    }),
  );
  // The targets settle in any order; sorted by entry (stable, so each entry's failures keep their
  // check order), last_error is the same for the same misses (Task 21 quality r1, Minor 6).
  failures.sort(byEntry);
  if (failures.length === 0) {
    await record(db, release.releaseId, site.id, null, 'ok', null, options);
    console.info('[cms-worker] live check', { ...log, status: 'ok', failures: 0 });
    return 'ok';
  }
  const missed = new Set(failures.map((f) => f.entryId));
  const state =
    withdrawals.length > 0
      ? {
          withdrawals: withdrawals.filter((t) => missed.has(t.entryId)).map(stored),
          withdrawn: withdrawals.filter((t) => !missed.has(t.entryId)).map((t) => t.entryId),
          withdrawals_others: targets.some((t) => beyondWithdrawalChecks(t) && missed.has(t.entryId)),
        }
      : {};
  const recorded = await record(db, release.releaseId, site.id, null, 'not_confirmed', { ...missError(failures), ...state }, options);
  console.info('[cms-worker] live check', { ...log, status: 'not_confirmed', failures: failures.length });
  // M3-03: the miss is retried on the delivery's schedule; when the 24 hours have run out, the
  // platform admin is alerted, once (an exhausted delivery is never selected again).
  if (recorded?.retries_exhausted) {
    await alert('delivery.retries_exhausted', {
      tenantId: release.tenantId,
      releaseId: release.releaseId,
      number: release.number,
      siteId: site.id,
      attempts: recorded.notify_attempts,
      code: 'live_not_confirmed',
      failures: failures.length,
    });
  }
  return 'not_confirmed';
}

const byEntry = (a: { entryId: string }, b: { entryId: string }) => (a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0);

/** The error of a failed notification: no secret to sign with, or the site's answer. */
const notifyError = (site: WorkerSite, status: number) => ({ code: site.webhook_secrets.some((s) => s !== '') ? 'notify_failed' : 'no_webhook_secret', status });

/** The error of a missed live check: at most MAX_STORED_FAILURES failures, with the count of the rest. */
const missError = (failures: unknown[]) => ({
  code: 'live_not_confirmed',
  failures: failures.slice(0, MAX_STORED_FAILURES),
  ...(failures.length > MAX_STORED_FAILURES ? { more: failures.length - MAX_STORED_FAILURES } : {}),
});

/**
 * Marks on a delivery that `delivery.withdrawal_unconfirmed` was raised for it (W1): a record with
 * neither status, which only merges into the delivery's last_error (none is created). Never throws.
 */
export async function markWithdrawalAlerted(db: SupabaseClient, releaseId: string, siteId: string, options: DeliveryOptions): Promise<void> {
  await record(db, releaseId, siteId, null, null, { withdrawal_alerted: clockOf(options) }, options);
}

/**
 * Checks again, on one site, the withdrawals of a superseded release that the site has not
 * confirmed (W1), from the checks its delivery stored: no bundle is read, so retention may have
 * removed them. The site is notified with the tenant's latest delivered release (`notifyRelease`):
 * the webhook only makes the site revalidate, so it never changes the live release, and it never
 * names a release older than the one the site serves. Then each stored check runs; an entry whose
 * checks all pass is confirmed (`withdrawn`), the others stay pending. Recorded on the release's own
 * delivery to the site, on M3-02's schedule:
 *
 * - every withdrawal confirmed and nothing else unconfirmed: live ok (the editor sees "Tekið af vef");
 * - every withdrawal confirmed but a publish of the release unconfirmed: not_confirmed with nothing
 *   left to check (the publish is never claimed live without its own check);
 * - otherwise not_confirmed, the misses pending.
 *
 * `delivery.withdrawal_unconfirmed` is raised once per release and site: on a miss (or a failed
 * notification) after the hour following the release, marked on the delivery in the same record, or
 * when the retries run out, unless it was raised already. Never `delivery.retries_exhausted`: the
 * incident is the withdrawal.
 *
 * M5-01: a stored withdrawal with no checks always misses; the database stops listing it once the
 * alert is marked. Once `expired`, runs were killed for 24 hours with no miss recorded, so the
 * delivery ends here, with the alert first, and no notification or check that a kill could stop.
 */
export async function confirmWithdrawals(
  db: SupabaseClient,
  release: WithdrawalRelease,
  site: WorkerSite,
  state: WithdrawalState,
  options: DeliveryOptions,
): Promise<SiteOutcome> {
  const payload = { tenant: release.tenantSlug, release: release.notifyRelease };
  const raiseNow = !state.alerted && state.hourOver;
  const marker = raiseNow ? { withdrawal_alerted: clockOf(options) } : {};
  const raise = async (recorded: RecordedDelivery | null) => {
    if (raiseNow || (!state.alerted && recorded?.retries_exhausted)) {
      await alert('delivery.withdrawal_unconfirmed', { tenantId: release.tenantId, releaseId: release.releaseId, number: release.number, siteId: site.id });
    }
  };
  const log = { tenant: release.tenantSlug, release: release.number, siteId: site.id, notified: release.notifyRelease };

  if (state.expired) {
    await raise(null);
    await record(db, release.releaseId, site.id, null, 'not_confirmed', { ...missError([]), withdrawals: state.pending, ...marker }, options);
    return 'not_confirmed';
  }

  const notified = await notifySite(site, payload);
  if (!notified.ok) {
    // `withdrawals` restated: entries published again since are no longer stored.
    const recorded = await record(db, release.releaseId, site.id, 'failed', null, { ...notifyError(site, notified.status), withdrawals: state.pending, ...marker }, options);
    await raise(recorded);
    return 'notify_failed';
  }
  await record(db, release.releaseId, site.id, 'ok', null, null, options);

  const resend = once(async () => {
    let ok = false;
    try {
      ok = (await notifySite(site, payload)).ok;
    } finally {
      console.info('[cms-worker] resend', { ...log, ok });
    }
  });
  const fetchPage = createPageFetcher();
  const failures: Array<LiveCheckFailure & { entryId: string }> = [];
  const missed = new Set<string>();
  await Promise.all(
    state.pending.map(async (w) => {
      if (w.unchecked) {
        missed.add(w.entryId);
        failures.push({ entryId: w.entryId, path: w.ownPath, reason: 'withdrawal_unchecked' });
        return;
      }
      const result = await runLiveChecks({
        baseUrl: site.base_url,
        checks: w.checks,
        ownPath: w.ownPath,
        entry: { id: w.entryId, contentHash: null },
        mediaUrls: [],
        resend,
        fetchPage,
        pollMs: options.pollMs,
        timeoutMs: options.timeoutMs,
      });
      if (result.failures.length > 0) missed.add(w.entryId);
      for (const f of result.failures) failures.push({ entryId: w.entryId, ...f });
    }),
  );
  failures.sort(byEntry);
  const still = state.pending.filter((w) => missed.has(w.entryId));
  const withdrawn = [...new Set([...state.withdrawn, ...state.pending.filter((w) => !missed.has(w.entryId)).map((w) => w.entryId)])];
  console.info('[cms-worker] withdrawal check', { ...log, pending: still.length, confirmed: state.pending.length - still.length });
  if (still.length === 0 && !state.others) {
    await record(db, release.releaseId, site.id, null, 'ok', null, options);
    return 'ok';
  }
  const error = { ...missError(failures), withdrawals: still, withdrawn, ...(still.length > 0 ? marker : {}) };
  const recorded = await record(db, release.releaseId, site.id, null, 'not_confirmed', error, options);
  if (still.length > 0) await raise(recorded);
  return 'not_confirmed';
}

/**
 * Checks again a superseded release's unconfirmed withdrawals on the sites `states` names (W1),
 * concurrently; a site deactivated since it was listed is skipped. Every site settles before this
 * returns; the errors are thrown together as an AggregateError.
 */
export async function confirmWithdrawalRetry(
  db: SupabaseClient,
  release: WithdrawalRelease,
  states: ReadonlyMap<string, WithdrawalState>,
  options: DeliveryOptions,
): Promise<void> {
  const active = (await callRpc<WorkerSite[] | null>(db, 'worker_sites', { p_tenant_id: release.tenantId })) ?? [];
  const results = await Promise.allSettled(
    active.flatMap((site) => {
      const state = states.get(site.id);
      return state ? [confirmWithdrawals(db, release, site, state, options)] : [];
    }),
  );
  const errors = results.flatMap((r) => (r.status === 'rejected' ? [r.reason] : []));
  if (errors.length > 0) throw new AggregateError(errors, `release ${release.number}: ${errors.length} withdrawal check(s) failed`);
}

/** The public media URL prefix of this project (`…/media-public/`). */
export function mediaPrefix(): string {
  return publicMediaUrl(supabaseUrl(), '');
}

/**
 * Notifies and live-checks the tenant's active sites for a delivered release, concurrently: the
 * fast path confirms every active site; the sweep's retry passes `retry`, the ids of the sites to
 * confirm, and a site deactivated since it was listed is skipped. A fresh
 * delivery (one with `pointerWrittenAt`; the retry has none) first waits, once for all its sites,
 * until the pointer's public URL serves the release or the bound runs out (decision 49.1), then
 * notifies either way: when the CDN still serves the old pointer, the live check reports it. The
 * release's withdrawal state is stored on each site's delivery before any of that (M5-01). Every
 * site's confirmation settles before this returns; one site's error does not stop the others, and
 * the errors are thrown together as an AggregateError.
 */
export async function confirmRelease(
  db: SupabaseClient,
  release: DeliveredRelease,
  options: DeliveryOptions,
  retry?: ReadonlySet<string>,
): Promise<void> {
  const module = getModule(release.tenantSlug);
  if (!module) throw new Error(`no module for tenant ${release.tenantSlug}`);
  const targets = liveTargets(module, release, mediaPrefix());
  const active = (await callRpc<WorkerSite[] | null>(db, 'worker_sites', { p_tenant_id: release.tenantId })) ?? [];
  const sites = retry ? active.filter((site) => retry.has(site.id)) : active;
  // M5-01: before anything that can outlast the run. A notify status of 'pending' stores the state
  // and leaves a delivery with a record of its own as it is (a retry comes here too).
  const state = unconfirmedState(targets);
  if (state) await Promise.all(sites.map((site) => record(db, release.releaseId, site.id, 'pending', null, state, options)));
  if (release.pointerWrittenAt !== undefined && sites.length > 0) await awaitPublicPointer(db, release, release.pointerWrittenAt, options);
  const results = await Promise.allSettled(sites.map((site) => confirmSite(db, release, site, targets, options)));
  const errors = results.flatMap((r) => (r.status === 'rejected' ? [r.reason] : []));
  if (errors.length > 0) throw new AggregateError(errors, `release ${release.number}: ${errors.length} site confirmation(s) failed`);
}

/**
 * Waits for the public pointer (pointer-fresh.ts), logs the outcome, one line per delivered
 * release (decision 49.1), and stores the lag on the release (M3-08): from the pointer write to the
 * first public read that served the release (`fresh`), or to the end of the bound (not fresh, "bound
 * reached"). Its bound leaves the live check's window (`timeoutMs`) and the finish margin before the
 * run deadline. Never throws: when the project URL cannot be read, it logs and returns, the sites
 * are notified without the wait, and no lag is stored; when storing the lag fails, it logs and the
 * delivery goes on (the lag is a measurement, never a reason to hold a delivery back).
 */
async function awaitPublicPointer(db: SupabaseClient, release: DeliveredRelease, pointerWrittenAt: number, options: DeliveryOptions): Promise<void> {
  let projectUrl: string;
  try {
    projectUrl = supabaseUrl();
  } catch (error) {
    console.error(`[cms-worker] release ${release.number}: the public pointer URL is unknown; notifying without the wait`, error);
    return;
  }
  const result = await waitForPublicPointer({
    supabaseUrl: projectUrl,
    tenantSlug: release.tenantSlug,
    release: release.number,
    pointerWrittenAt,
    runDeadline: options.runDeadline,
    liveTimeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ...options.pointer,
  });
  console.info('[cms-worker] pointer', { tenant: release.tenantSlug, release: release.number, ...result });
  await recordPointerLag(db, release, result);
}

/**
 * Stores a delivered release's pointer lag through api.worker_record_pointer_lag (M3-08), whole
 * milliseconds. The database keeps the first measurement; a release that already has one returns
 * false, which is not an error. Never throws: a failure is logged.
 */
async function recordPointerLag(db: SupabaseClient, release: DeliveredRelease, result: PointerWaitResult): Promise<void> {
  try {
    await callRpc<boolean | null>(db, 'worker_record_pointer_lag', {
      p_release_id: release.releaseId,
      p_lag_ms: Math.max(0, Math.round(result.lagMs)),
      p_fresh: result.fresh,
    });
  } catch (error) {
    console.error(`[cms-worker] release ${release.number}: the pointer lag was not recorded`, error);
  }
}

/**
 * Builds the tenant's next release and, when it is delivered, confirms it on every active site.
 * `busy` (another build is running; it or the sweep delivers what is committed) and `failed` (the
 * build alerted; the sweep rebuilds) are returned as they are.
 */
export async function deliverTenant(tenantId: string, options: DeliveryOptions & Pick<BuildOptions, 'db'> = {}): Promise<BuildResult> {
  const db = options.db ?? createAdminClient();
  const result = await buildRelease(tenantId, { db });
  // A delivered build always carries its release id, number and bundle; the checks only narrow
  // BuildResult's optional fields (Task 21 quality r1, Minor 4).
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
      pointerWrittenAt: result.pointerWrittenAt,
    },
    options,
  );
  return result;
}
