// Worker step 3b: content-specific live confirmation (spec §7.3, §7.4; plan Task 21, decisions 7
// and 35). A page proves an entry live only through the entry marker rendered from the same data
// as its content: the release marker in the layout is never read here.
import type { LiveCheck } from '@litljomi/cms-schema';
import { scanEntryMarkers } from '@litljomi/cms-sdk';
import { POINTER_MAX_AGE_S } from './storage-paths';

/** §7.4: poll about every 3 seconds, up to 60 seconds. */
export const DEFAULT_POLL_MS = 3_000;
export const DEFAULT_TIMEOUT_MS = 60_000;
/** One page fetch may take at most this long (and never past the window). */
const FETCH_TIMEOUT_MS = 10_000;
/** A page is read up to this size; a larger one fails its check (and bounds the marker scan). */
export const MAX_PAGE_BYTES = 5 * 1024 * 1024;
/** The resend waits this long past the pointer's max-age after it was written (§7.4, decision 48). */
export const RESEND_MARGIN_MS = 1_000;
/** At most this many fetches run at a time through one page fetcher (one site, one delivery). */
export const MAX_CONCURRENT_FETCHES = 6;

export type LiveCheckFailure = { path: string; reason: string };

export type LiveCheckInput = {
  baseUrl: string;
  checks: LiveCheck[];
  /** The entry's own public path: an `absent` check of it passes only on 404. */
  ownPath: string;
  entry: { id: string; contentHash: string | null };
  mediaUrls: string[];
  /** Sends the webhook again; called at most once per run. */
  resend: () => Promise<void>;
  /**
   * When the pointer was written (epoch ms, wall time as `Date.now()`): the resend waits until a
   * CDN can no longer serve the pointer from before it (decision 48). Absent: that moment counts as
   * past.
   */
  pointerWrittenAt?: number;
  /**
   * Fetches the pages and media. Share one (createPageFetcher) between the runs of one delivery to
   * one site, so they share identical fetches and its concurrency bound; default: one per run.
   */
  fetchPage?: PageFetcher;
  pollMs?: number;
  timeoutMs?: number;
};

export type FetchedPage = { status: number; body: string | null; error?: string };
/** GET `url` without redirects or caching, its body read up to `maxBytes` (0: not read), by `deadline`. */
export type PageFetcher = (url: string, deadline: number, maxBytes: number) => Promise<FetchedPage>;

/**
 * A page fetcher that runs at most `maxConcurrent` fetches at a time and makes an identical fetch
 * (same URL and size cap) once while it is in flight or waiting, every caller getting its result
 * (Task 21 security r1). A fetch still waiting for a slot when its deadline has passed is not made
 * (`timeout`). Create one after the site was notified: a shared fetch then always started after it.
 */
export function createPageFetcher(maxConcurrent = MAX_CONCURRENT_FETCHES): PageFetcher {
  let active = 0;
  const waiting: Array<() => void> = [];
  const shared = new Map<string, Promise<FetchedPage>>();

  async function limited(url: string, deadline: number, maxBytes: number): Promise<FetchedPage> {
    if (active < maxConcurrent) active++;
    else await new Promise<void>((resolve) => waiting.push(resolve)); // the slot is handed over
    try {
      if (Date.now() >= deadline) return { status: 0, body: null, error: 'timeout' };
      return await fetchCapped(url, deadline, maxBytes);
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  }

  return (url, deadline, maxBytes) => {
    const key = `${maxBytes} ${url}`;
    let result = shared.get(key);
    if (!result) {
      result = limited(url, deadline, maxBytes).finally(() => shared.delete(key));
      shared.set(key, result);
    }
    return result;
  };
}

/**
 * Polls every check and media URL until all pass or the window closes (§7.4):
 *
 * - `present`: 200 and an entry marker `{ id, hash: contentHash }` (scanEntryMarkers' markers).
 * - `absent`: no entry marker carrying the id at all, whatever its hash (scanEntryMarkers' ids, so
 *   an incomplete marker fails closed), on a page scanned to its end (an incomplete scan fails,
 *   `scan_incomplete`); the own path must answer 404, any other page 200 (an error page proves
 *   nothing about the page).
 * - media: every URL answers 200.
 *
 * When a page shows the entry's marker with a different hash on any poll after the first (the first
 * request triggers regeneration), `resend()` is called, once per run, but no earlier than the
 * pointer's max-age plus RESEND_MARGIN_MS after `pointerWrittenAt` (a site regenerating sooner may
 * read the old pointer from the CDN again, decision 48), within the window; at once when that
 * moment has passed. Each check is fetched through `fetchPage` without following redirects, with
 * no cache, and read up to MAX_PAGE_BYTES.
 * A check path must be root-relative (`/…`, not `//…`). The failures are the checks still failing
 * at the end, each with its last reason. Never throws.
 */
export async function runLiveChecks(o: LiveCheckInput): Promise<{ live: boolean; failures: LiveCheckFailure[] }> {
  const pollMs = o.pollMs ?? DEFAULT_POLL_MS;
  const deadline = Date.now() + (o.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const base = o.baseUrl.replace(/\/+$/, '');
  const fetchPage = o.fetchPage ?? createPageFetcher();

  type Item = { key: string; path: string; evaluate: () => Promise<{ pass: boolean; reason: string; stale: boolean }> };
  const failures: LiveCheckFailure[] = [];
  const items: Item[] = [];
  o.checks.forEach((check, i) => {
    if (!check.path.startsWith('/') || check.path.startsWith('//') || check.path.includes('\\')) {
      failures.push({ path: check.path, reason: 'invalid_path' });
      return;
    }
    items.push({ key: `check:${i}`, path: check.path, evaluate: () => evaluateCheck(check, `${base}${check.path}`) });
  });
  o.mediaUrls.forEach((url, i) => {
    items.push({
      key: `media:${i}`,
      path: url,
      evaluate: async () => {
        const r = await fetchPage(url, deadline, 0);
        return { pass: r.status === 200, reason: r.error ?? `status ${r.status}`, stale: false };
      },
    });
  });

  async function evaluateCheck(check: LiveCheck, url: string): Promise<{ pass: boolean; reason: string; stale: boolean }> {
    const r = await fetchPage(url, deadline, MAX_PAGE_BYTES);
    if (r.error) return { pass: false, reason: r.error, stale: false };
    const scanned = scanEntryMarkers(r.body ?? '');
    if (check.expect === 'present') {
      if (o.entry.contentHash === null) return { pass: false, reason: 'no_content_hash', stale: false };
      const mine = scanned.markers.filter((m) => m.id === o.entry.id);
      if (r.status !== 200) return { pass: false, reason: `status ${r.status}`, stale: false };
      if (mine.some((m) => m.hash === o.entry.contentHash)) return { pass: true, reason: '', stale: false };
      return mine.length > 0 ? { pass: false, reason: 'stale_hash', stale: true } : { pass: false, reason: 'marker_missing', stale: false };
    }
    if (scanned.ids.includes(o.entry.id)) return { pass: false, reason: 'marker_present', stale: false };
    // A page the scan could not read to its end proves nothing about the rest (inconclusive).
    if (!scanned.complete) return { pass: false, reason: 'scan_incomplete', stale: false };
    const wanted = check.path === o.ownPath ? 404 : 200;
    return r.status === wanted ? { pass: true, reason: '', stale: false } : { pass: false, reason: `status ${r.status}`, stale: false };
  }

  const pending = new Map(items.map((item) => [item.key, item]));
  const lastReason = new Map<string, string>();
  // Never past the window: the loop ends at the deadline (with the default window, write + 31 s is
  // always inside it, since the pointer is written before the window opens).
  const resendAt = (o.pointerWrittenAt ?? -Infinity) + POINTER_MAX_AGE_S * 1_000 + RESEND_MARGIN_MS;
  let staleSeen = false;
  let resent = false;
  const resendWhenDue = async () => {
    if (!staleSeen || resent || Date.now() < resendAt) return;
    resent = true;
    try {
      await o.resend();
    } catch (error) {
      console.error('[cms-worker] live check: sending the webhook again failed', error);
    }
  };
  for (let round = 1; ; round++) {
    let stale = false;
    await Promise.all(
      [...pending.values()].map(async (item) => {
        const result = await item.evaluate();
        if (result.pass) pending.delete(item.key);
        else lastReason.set(item.key, result.reason);
        if (result.stale) stale = true;
      }),
    );
    if (pending.size === 0) break;
    // Deliberately sticky: once a page regenerated from an old pointer, the resend goes out when due
    // even if a later poll shows another failure, since the CDN may still hold the old pointer.
    if (stale && round > 1) staleSeen = true;
    await resendWhenDue();
    const left = deadline - Date.now();
    if (left <= 0) break;
    const nextPoll = Date.now() + Math.min(pollMs, left);
    // A resend due before the next poll is sent at its moment; the poll keeps its time.
    if (staleSeen && !resent && resendAt < nextPoll) {
      await sleep(resendAt - Date.now());
      await resendWhenDue();
    }
    await sleep(nextPoll - Date.now());
    if (Date.now() >= deadline) break;
  }
  for (const item of pending.values()) failures.push({ path: item.path, reason: lastReason.get(item.key) ?? 'unknown' });
  return { live: failures.length === 0, failures };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/** GET without redirects or caching, the body read up to `maxBytes` (0: not read). */
async function fetchCapped(url: string, deadline: number, maxBytes: number): Promise<FetchedPage> {
  const timeout = Math.max(1_000, Math.min(FETCH_TIMEOUT_MS, deadline - Date.now()));
  let response: Response;
  try {
    response = await fetch(url, { method: 'GET', redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(timeout) });
  } catch {
    return { status: 0, body: null, error: 'fetch_failed' };
  }
  if (maxBytes === 0 || response.body === null) {
    await response.body?.cancel().catch(() => {});
    return { status: response.status, body: null };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        return { status: response.status, body: null, error: 'too_large' };
      }
      chunks.push(value);
    }
  } catch {
    return { status: response.status, body: null, error: 'read_failed' };
  }
  return { status: response.status, body: Buffer.concat(chunks).toString('utf8') };
}
