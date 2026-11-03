// Worker step 3, before any notification: wait until the pointer's public URL serves the new
// release (decision 49.1; spec §7.2, §7.4). The Storage CDN was seen serving the old
// `{tenant}/current.json` for more than 33 s after it was overwritten, despite `max-age=30`
// (m1-report, sitting 5); a site notified while the CDN still serves the old pointer regenerates
// from it. So the worker polls the URL a site reads, without caching, until it shows release N (or
// a newer one), and only then notifies; when the bound runs out it notifies anyway and the live
// check reports the truth.
import { deliveryPointerPath } from './storage-paths';

/** Poll the public pointer about once a second. */
export const POINTER_POLL_MS = 1_000;
/**
 * Poll for at most this long after the pointer was written. The run's 300 s (the routes'
 * maxDuration, WORKER_MAX_DURATION_MS) add up as: up to 110 s for processing and the build before
 * the write + 120 s for this poll + 10 s for the notification and the records (FINISH_MARGIN_MS)
 * + 60 s for the live check. When the build takes longer, the run-deadline clamp in pointerWaitEnd
 * shortens the poll.
 */
export const POINTER_FRESH_MAX_MS = 120_000;
/** The notify/records allowance: kept free in the run besides the live check's window. */
export const FINISH_MARGIN_MS = 10_000;
/** One fetch of the pointer may take at most this long (and never past the bound). */
const POINTER_FETCH_TIMEOUT_MS = 5_000;

/** The public URL of the tenant's pointer: `{supabaseUrl}/storage/v1/object/public/delivery/{slug}/current.json`. */
export function publicPointerUrl(supabaseUrl: string, tenantSlug: string): string {
  const base = supabaseUrl.replace(/\/+$/, '');
  return `${base}/storage/v1/object/public/delivery/${deliveryPointerPath(tenantSlug).split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * When the poll must end (epoch ms): the earlier of
 *
 * - `pointerWrittenAt + POINTER_FRESH_MAX_MS` (the cap), and
 * - `runDeadline - liveTimeoutMs - FINISH_MARGIN_MS`: the live check (its whole window) and the
 *   finish margin must still fit before the run's deadline. With a 300 s run and the 60 s live
 *   check, the poll ends at the latest 230 s into the run.
 *
 * Without a run deadline, the cap alone.
 */
export function pointerWaitEnd(pointerWrittenAt: number, runDeadline: number | undefined, liveTimeoutMs: number): number {
  const cap = pointerWrittenAt + POINTER_FRESH_MAX_MS;
  return runDeadline === undefined ? cap : Math.min(cap, runDeadline - liveTimeoutMs - FINISH_MARGIN_MS);
}

/** The test seams of the poll: the public fetch, the clock and the pause between polls. */
export type PointerSeams = {
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
};

export type PointerWaitInput = PointerSeams & {
  supabaseUrl: string;
  tenantSlug: string;
  /** The release the pointer must serve (or a newer one). */
  release: number;
  /** When the pointer was written (epoch ms). */
  pointerWrittenAt: number;
  /** When the run must be finished (epoch ms); see pointerWaitEnd. */
  runDeadline?: number;
  /** The live check's window that must still fit after the poll. */
  liveTimeoutMs: number;
};

export type PointerWaitResult = {
  /** The public URL served release N or newer. */
  fresh: boolean;
  /** From the write to the fresh answer, or to giving up. */
  lagMs: number;
  polls: number;
};

/**
 * Polls the pointer's public URL (no cache, no redirects, each fetch bounded) about every
 * POINTER_POLL_MS until its JSON's `release` is at least `release`, or until pointerWaitEnd; when
 * that end has already passed, it does not poll. A fetch error, a status other than 200 or a body
 * that is not a pointer is "not fresh yet". Never throws.
 */
export async function waitForPublicPointer(o: PointerWaitInput): Promise<PointerWaitResult> {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? defaultSleep;
  const fetchFn = o.fetch ?? fetch;
  const pollMs = o.pollMs ?? POINTER_POLL_MS;
  const end = pointerWaitEnd(o.pointerWrittenAt, o.runDeadline, o.liveTimeoutMs);
  let url: string;
  try {
    url = publicPointerUrl(o.supabaseUrl, o.tenantSlug);
  } catch {
    return { fresh: false, lagMs: Math.max(0, now() - o.pointerWrittenAt), polls: 0 };
  }

  let polls = 0;
  for (;;) {
    const left = end - now();
    if (left <= 0) return { fresh: false, lagMs: Math.max(0, now() - o.pointerWrittenAt), polls };
    polls++;
    const fresh = await servesRelease(fetchFn, url, o.release, Math.min(POINTER_FETCH_TIMEOUT_MS, left));
    const at = now();
    if (fresh) return { fresh: true, lagMs: Math.max(0, at - o.pointerWrittenAt), polls };
    if (at < end) await sleep(Math.min(pollMs, end - at));
  }
}

/** One poll: true when the URL answers 200 with a JSON object whose `release` is at least `release`. */
async function servesRelease(fetchFn: typeof fetch, url: string, release: number, timeoutMs: number): Promise<boolean> {
  try {
    const response = await fetchFn(url, { cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(Math.max(1, timeoutMs)) });
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => {});
      return false;
    }
    const body: unknown = await response.json();
    if (body === null || typeof body !== 'object') return false;
    const served = (body as { release?: unknown }).release;
    return typeof served === 'number' && Number.isSafeInteger(served) && served >= release;
  } catch {
    return false;
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));
