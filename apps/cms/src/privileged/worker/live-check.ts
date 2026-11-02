// Worker step 3b: content-specific live confirmation (spec §7.3, §7.4; plan Task 21, decisions 7
// and 35). A page proves an entry live only through the entry marker rendered from the same data
// as its content: the release marker in the layout is never read here.
import type { LiveCheck } from '@litljomi/cms-schema';
import { parseEntryMarkerIds, parseEntryMarkers } from '@litljomi/cms-sdk';

/** §7.4: poll about every 3 seconds, up to 60 seconds. */
export const DEFAULT_POLL_MS = 3_000;
export const DEFAULT_TIMEOUT_MS = 60_000;
/** One page fetch may take at most this long (and never past the window). */
const FETCH_TIMEOUT_MS = 10_000;
/** A page is read up to this size; a larger one fails its check (and bounds the marker scan). */
export const MAX_PAGE_BYTES = 5 * 1024 * 1024;

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
  pollMs?: number;
  timeoutMs?: number;
};

type Fetched = { status: number; body: string | null; error?: string };

/**
 * Polls every check and media URL until all pass or the window closes (§7.4):
 *
 * - `present`: 200 and an entry marker `{ id, hash: contentHash }` (parseEntryMarkers).
 * - `absent`: no entry marker carrying the id at all, whatever its hash (parseEntryMarkerIds, so
 *   an incomplete marker fails closed); the own path must answer 404, any other page 200 (an error
 *   page proves nothing about the page).
 * - media: every URL answers 200.
 *
 * When a page shows the entry's marker with a different hash on any poll after the first (the first
 * request triggers regeneration), `resend()` is called, once per run. Each check is fetched
 * without following redirects, with no cache, and read up to MAX_PAGE_BYTES. A check path must be
 * root-relative (`/…`, not `//…`). The failures are the checks still failing at the end, each with
 * its last reason. Never throws.
 */
export async function runLiveChecks(o: LiveCheckInput): Promise<{ live: boolean; failures: LiveCheckFailure[] }> {
  const pollMs = o.pollMs ?? DEFAULT_POLL_MS;
  const deadline = Date.now() + (o.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const base = o.baseUrl.replace(/\/+$/, '');

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
        const r = await fetchCapped(url, deadline, 0);
        return { pass: r.status === 200, reason: r.error ?? `status ${r.status}`, stale: false };
      },
    });
  });

  async function evaluateCheck(check: LiveCheck, url: string): Promise<{ pass: boolean; reason: string; stale: boolean }> {
    const r = await fetchCapped(url, deadline, MAX_PAGE_BYTES);
    if (r.error) return { pass: false, reason: r.error, stale: false };
    const html = r.body ?? '';
    if (check.expect === 'present') {
      if (o.entry.contentHash === null) return { pass: false, reason: 'no_content_hash', stale: false };
      const mine = parseEntryMarkers(html).filter((m) => m.id === o.entry.id);
      if (r.status !== 200) return { pass: false, reason: `status ${r.status}`, stale: false };
      if (mine.some((m) => m.hash === o.entry.contentHash)) return { pass: true, reason: '', stale: false };
      return mine.length > 0 ? { pass: false, reason: 'stale_hash', stale: true } : { pass: false, reason: 'marker_missing', stale: false };
    }
    if (parseEntryMarkerIds(html).includes(o.entry.id)) return { pass: false, reason: 'marker_present', stale: false };
    const wanted = check.path === o.ownPath ? 404 : 200;
    return r.status === wanted ? { pass: true, reason: '', stale: false } : { pass: false, reason: `status ${r.status}`, stale: false };
  }

  const pending = new Map(items.map((item) => [item.key, item]));
  const lastReason = new Map<string, string>();
  let resent = false;
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
    if (stale && round > 1 && !resent) {
      resent = true;
      try {
        await o.resend();
      } catch (error) {
        console.error('[cms-worker] live check: sending the webhook again failed', error);
      }
    }
    const left = deadline - Date.now();
    if (left <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, left)));
    if (Date.now() >= deadline) break;
  }
  for (const item of pending.values()) failures.push({ path: item.path, reason: lastReason.get(item.key) ?? 'unknown' });
  return { live: failures.length === 0, failures };
}

/** GET without redirects or caching, the body read up to `maxBytes` (0: not read). */
async function fetchCapped(url: string, deadline: number, maxBytes: number): Promise<Fetched> {
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
