// Waiting for the pointer's public URL to serve the new release before notifying (decision 49.1;
// spec §7.2, §7.4), with a fake clock and a fake public fetch.
import { describe, expect, it, vi } from 'vitest';
import {
  FINISH_MARGIN_MS,
  MAX_POINTER_BYTES,
  POINTER_FRESH_MAX_MS,
  POINTER_POLL_MS,
  pointerWaitEnd,
  publicPointerUrl,
  waitForPublicPointer,
  type PointerWaitInput,
} from '../pointer-fresh';

const SUPABASE = 'https://example.supabase.co';
const URL_OF_POINTER = `${SUPABASE}/storage/v1/object/public/delivery/prufa/current.json`;
const WRITTEN = 1_800_000_000_000;

/** A fake clock: `sleep` and every fetch advance it (each fetch by `fetchMs`). */
function clock(start: number, fetchMs = 50) {
  const c = {
    t: start,
    now: () => c.t,
    sleep: async (ms: number) => {
      c.t += Math.max(0, ms);
    },
    fetchMs,
  };
  return c;
}

type Answer = { status?: number; body?: string; headers?: Record<string, string> } | 'throw';
const pointer = (release: number) => ({ body: JSON.stringify({ format: 1, tenant: 'prufa', release, bundle: `releases/${release}.json`, generatedAt: 'x' }) });

/** A fake public fetch answering from `answers` in order (the last one repeats), recording each call. */
function fakeFetch(c: ReturnType<typeof clock>, answers: Answer[]) {
  const calls: Array<{ url: string; init: RequestInit | undefined; at: number }> = [];
  const fn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init, at: c.t });
    c.t += c.fetchMs;
    const a = answers[Math.min(calls.length - 1, answers.length - 1)]!;
    if (a === 'throw') throw new TypeError('fetch failed');
    return new Response(a.body ?? '', { status: a.status ?? 200, headers: a.headers });
  };
  return { fn: fn as typeof fetch, calls };
}

const input = (c: ReturnType<typeof clock>, f: ReturnType<typeof fakeFetch>, o: Partial<PointerWaitInput> = {}): PointerWaitInput => ({
  supabaseUrl: SUPABASE,
  tenantSlug: 'prufa',
  release: 5,
  pointerWrittenAt: WRITTEN,
  liveTimeoutMs: 60_000,
  fetch: f.fn,
  now: c.now,
  sleep: c.sleep,
  ...o,
});

describe('publicPointerUrl', () => {
  it('is the public delivery URL of {tenant}/current.json, trailing slashes trimmed', () => {
    expect(publicPointerUrl(SUPABASE, 'prufa')).toBe(URL_OF_POINTER);
    expect(publicPointerUrl(`${SUPABASE}//`, 'prufa')).toBe(URL_OF_POINTER);
  });
  it('refuses a slug that is not one (built through deliveryPointerPath)', () => {
    expect(() => publicPointerUrl(SUPABASE, '../x')).toThrow(/invalid tenant slug/);
  });
});

describe('pointerWaitEnd', () => {
  it('is the cap after the write when the run has time left', () => {
    expect(POINTER_FRESH_MAX_MS).toBe(120_000);
    expect(FINISH_MARGIN_MS).toBe(10_000);
    expect(pointerWaitEnd(WRITTEN, WRITTEN + 300_000, 60_000)).toBe(WRITTEN + 120_000);
  });
  it('is the run deadline less the live check and the finish margin when that is earlier', () => {
    // 100 s left in the run: 100 - 60 - 10 = 30 s of polling.
    expect(pointerWaitEnd(WRITTEN, WRITTEN + 100_000, 60_000)).toBe(WRITTEN + 30_000);
    expect(pointerWaitEnd(WRITTEN, WRITTEN + 100_000, 20_000)).toBe(WRITTEN + 70_000);
  });
  it('is the cap alone without a run deadline', () => {
    expect(pointerWaitEnd(WRITTEN, undefined, 60_000)).toBe(WRITTEN + 120_000);
  });
});

describe('waitForPublicPointer', () => {
  it('(a) fresh at once: one poll, the lag is the time since the write', async () => {
    const c = clock(WRITTEN + 400);
    const f = fakeFetch(c, [pointer(5)]);

    const result = await waitForPublicPointer(input(c, f));

    expect(result).toEqual({ fresh: true, lagMs: 450, polls: 1 });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.url).toBe(URL_OF_POINTER);
    expect(f.calls[0]!.init).toMatchObject({ cache: 'no-store', redirect: 'manual' });
    expect(f.calls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('(b) fresh after a lag: the old release for several polls, then N; the lag is measured to the fresh answer', async () => {
    const c = clock(WRITTEN);
    const f = fakeFetch(c, [pointer(4), pointer(4), pointer(4), pointer(4), pointer(5)]);

    const result = await waitForPublicPointer(input(c, f));

    expect(result.fresh).toBe(true);
    expect(result.polls).toBe(5);
    // Each poll starts POINTER_POLL_MS after the previous one ended; each fetch takes 50 ms.
    expect(result.lagMs).toBe(5 * 50 + 4 * POINTER_POLL_MS);
    expect(POINTER_POLL_MS).toBe(1_000);
    expect(f.calls.map((call) => call.at - WRITTEN)).toEqual([0, 1_050, 2_100, 3_150, 4_200]);
  });

  it('(c) never fresh within the bound: gives up at the bound with fresh false', async () => {
    const c = clock(WRITTEN);
    const f = fakeFetch(c, [pointer(4)]);

    const result = await waitForPublicPointer(input(c, f));

    expect(result.fresh).toBe(false);
    expect(result.lagMs).toBe(POINTER_FRESH_MAX_MS);
    expect(c.t).toBe(WRITTEN + POINTER_FRESH_MAX_MS);
    expect(result.polls).toBe(f.calls.length);
    // About one poll a second for 120 s, none at or after the bound.
    expect(result.polls).toBeGreaterThanOrEqual(110);
    expect(Math.max(...f.calls.map((call) => call.at))).toBeLessThan(WRITTEN + POINTER_FRESH_MAX_MS);
  });

  it('stops at the run deadline’s budget when it is earlier than the cap', async () => {
    const c = clock(WRITTEN);
    const f = fakeFetch(c, [pointer(4)]);

    const result = await waitForPublicPointer(input(c, f, { runDeadline: WRITTEN + 90_000, liveTimeoutMs: 60_000 }));

    // 90 - 60 - 10 = 20 s.
    expect(result).toMatchObject({ fresh: false, lagMs: 20_000 });
    expect(c.t).toBe(WRITTEN + 20_000);
  });

  it('does not poll when the bound has already passed', async () => {
    const c = clock(WRITTEN + 5_000);
    const f = fakeFetch(c, [pointer(5)]);

    const result = await waitForPublicPointer(input(c, f, { runDeadline: WRITTEN + 70_000 }));

    expect(result).toEqual({ fresh: false, lagMs: 5_000, polls: 0 });
    expect(f.calls).toEqual([]);
  });

  it('a newer release counts as fresh', async () => {
    const c = clock(WRITTEN);
    const f = fakeFetch(c, [pointer(7)]);
    expect(await waitForPublicPointer(input(c, f))).toMatchObject({ fresh: true, polls: 1 });
  });

  it('fetch errors, a 404, a redirect, bad JSON and a pointer without a release keep polling; never throws', async () => {
    const c = clock(WRITTEN);
    const f = fakeFetch(c, [
      'throw',
      { status: 404, body: '{"error":"not found"}' },
      { status: 302, body: '' },
      { body: 'not json' },
      { body: '{"release":"5"}' },
      { body: 'null' },
      { status: 500, body: JSON.stringify({ release: 5 }) },
      pointer(5),
    ]);

    const result = await waitForPublicPointer(input(c, f));

    expect(result).toMatchObject({ fresh: true, polls: 8 });
  });

  // Task 29 security r1, Minor 2: the body is capped before it is parsed.
  it('a pointer body over MAX_POINTER_BYTES is not fresh and is not parsed, whether declared or streamed', async () => {
    const padded = JSON.stringify({ format: 1, tenant: 'prufa', release: 5, bundle: 'releases/5.json', pad: 'x'.repeat(MAX_POINTER_BYTES) });
    const exact = JSON.stringify({ release: 5, pad: '' });
    const atCap = JSON.stringify({ release: 5, pad: 'x'.repeat(MAX_POINTER_BYTES - exact.length) });
    expect(new TextEncoder().encode(atCap).byteLength).toBe(MAX_POINTER_BYTES);
    const parse = vi.spyOn(JSON, 'parse');
    try {
      const c = clock(WRITTEN);
      const f = fakeFetch(c, [{ body: padded }, { body: pointer(5).body, headers: { 'content-length': String(MAX_POINTER_BYTES + 1) } }, { body: atCap }]);

      const result = await waitForPublicPointer(input(c, f));

      expect(result).toMatchObject({ fresh: true, polls: 3 });
      // Only the body at the cap was parsed.
      expect(parse.mock.calls.map((call) => call[0])).toEqual([atCap]);
    } finally {
      parse.mockRestore();
    }
  });

  it('a fetch that throws synchronously is not fresh, never an exception', async () => {
    const c = clock(WRITTEN);
    const throwing = (() => {
      throw new Error('boom');
    }) as unknown as typeof fetch;
    const result = await waitForPublicPointer({ ...input(c, fakeFetch(c, [])), fetch: throwing, runDeadline: WRITTEN + 73_000 });
    expect(result.fresh).toBe(false);
  });

  it('each fetch’s timeout never reaches past the bound', async () => {
    const c = clock(WRITTEN + 119_500);
    const signals: AbortSignal[] = [];
    const f = (async (_url: string, init?: RequestInit) => {
      signals.push(init!.signal!);
      return new Response(JSON.stringify({ release: 5 }));
    }) as unknown as typeof fetch;
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    try {
      await waitForPublicPointer({ ...input(c, fakeFetch(c, [])), fetch: f });
      expect(timeout.mock.calls).toEqual([[500]]);
    } finally {
      timeout.mockRestore();
    }
    expect(signals).toHaveLength(1);
  });
});
