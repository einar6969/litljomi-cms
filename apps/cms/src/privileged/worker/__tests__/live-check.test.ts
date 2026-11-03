// runLiveChecks (spec §7.3, §7.4; plan Task 21, decisions 7 and 35) against a local fake site.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveCheck } from '@litljomi/cms-schema';
import { createPageFetcher, DEFAULT_TIMEOUT_MS, MAX_CONCURRENT_FETCHES, runLiveChecks, type PageFetcher } from '../live-check';
import { POINTER_MAX_AGE_S } from '../storage-paths';
import { entryMarker, html, releaseMeta, startFakeSite, type FakeSite } from './fake-site';

const ID = '7d0c5a8e-1b2f-4c3d-9e4f-5a6b7c8d9e0f';
const OLD = 'a'.repeat(64);
const NEW = 'b'.repeat(64);
const OWN = '/frettir/braud';

let site: FakeSite;
beforeEach(async () => {
  site = await startFakeSite();
});
afterEach(async () => {
  await site.close();
});

const fast = { pollMs: 20, timeoutMs: 400 };
/** A window with a single poll: the first poll's wait reaches the deadline. */
const ONE_POLL = { pollMs: 2_000, timeoutMs: 2_000 };
const run = (o: {
  checks: LiveCheck[];
  contentHash?: string | null;
  mediaUrls?: string[];
  resend?: () => Promise<void>;
  ownPath?: string;
  window?: { pollMs: number; timeoutMs: number };
}) =>
  runLiveChecks({
    baseUrl: site.origin,
    checks: o.checks,
    ownPath: o.ownPath ?? OWN,
    entry: { id: ID, contentHash: o.contentHash === undefined ? NEW : o.contentHash },
    mediaUrls: o.mediaUrls ?? [],
    resend: o.resend ?? (async () => {}),
    ...(o.window ?? fast),
  });
type RunInput = { checks: LiveCheck[]; contentHash?: string | null };
/** The fake site's page for `path`, as the fake site would serve it (404 when there is none). */
const servedPage = (path: string) => {
  const found = site.pages.get(path);
  return typeof found === 'function' ? found() : (found ?? { status: 404, html: html('', '<h1>404</h1>') });
};
/**
 * `run` on a fake clock, with a fetcher that reads the fake site's pages without HTTP: for tests
 * that assert the last failure reason of a page that fails on every poll (decision 48, quality r2).
 * On a real clock, a last poll that starts just before the 400 ms deadline can find it passed by the
 * time its fetch is made, and the check then ends as `timeout`: one run in four failed so under
 * load. The scan and the polling are the same; only the transport and the clock differ.
 */
async function runOnFakeClock(o: RunInput): Promise<Awaited<ReturnType<typeof runLiveChecks>>> {
  vi.useFakeTimers({ now: 1_000_000 });
  try {
    const done = runLiveChecks({
      baseUrl: site.origin,
      checks: o.checks,
      ownPath: OWN,
      entry: { id: ID, contentHash: o.contentHash === undefined ? NEW : o.contentHash },
      mediaUrls: [],
      resend: async () => {},
      fetchPage: async (url) => {
        const p = servedPage(new URL(url).pathname);
        return { status: p.status, body: p.html ?? '' };
      },
      ...fast,
    });
    await vi.runAllTimersAsync();
    return await done;
  } finally {
    vi.useRealTimers();
  }
}
const present = (path = OWN): LiveCheck => ({ path, expect: 'present' });
const absent = (path = OWN): LiveCheck => ({ path, expect: 'absent' });
const page = (body: string, status = 200, release = 5) => ({ status, html: html(releaseMeta(release), body) });

describe('present', () => {
  it('fails on the old hash in the entry block even with a newer release marker in the layout (the key proof rule)', async () => {
    site.pages.set(OWN, page(`<main>${entryMarker(ID, OLD)}</main>`, 200, 99));
    const result = await runOnFakeClock({ checks: [present()] });
    expect(result.live).toBe(false);
    expect(result.failures).toEqual([{ path: OWN, reason: expect.stringContaining('stale') }]);
  });
  it('passes on 200 with the new hash', async () => {
    site.pages.set(OWN, page(`<main>${entryMarker(ID, NEW)}</main>`));
    expect(await run({ checks: [present()] })).toEqual({ live: true, failures: [] });
  });
  it('passes once the page regenerates to the new hash within the window', async () => {
    let n = 0;
    site.pages.set(OWN, () => page(entryMarker(ID, ++n < 3 ? OLD : NEW)));
    expect((await run({ checks: [present()] })).live).toBe(true);
    expect(site.hits(OWN)).toBe(3);
  });
  it('fails on the new hash with a status other than 200', async () => {
    site.pages.set(OWN, page(entryMarker(ID, NEW), 500));
    expect(await runOnFakeClock({ checks: [present()] })).toMatchObject({ live: false, failures: [{ path: OWN, reason: expect.stringContaining('500') }] });
  });
  it('fails when the marker is only in a comment or a script', async () => {
    site.pages.set(OWN, page(`<!-- ${entryMarker(ID, NEW)} --><script>"${entryMarker(ID, NEW)}"</script>`));
    expect((await run({ checks: [present()] })).live).toBe(false);
  });
  it('fails without a content hash to look for', async () => {
    site.pages.set(OWN, page(entryMarker(ID, NEW)));
    expect((await run({ checks: [present()], contentHash: null })).live).toBe(false);
  });
});

describe('absent', () => {
  it('fails when the own path still answers 200 without the marker (it must be 404)', async () => {
    site.pages.set(OWN, page('<main>Ekkert hér</main>'));
    expect(await runOnFakeClock({ checks: [absent()], contentHash: null })).toMatchObject({
      live: false,
      failures: [{ path: OWN, reason: expect.stringContaining('200') }],
    });
  });
  it('passes when the own path answers 404', async () => {
    site.pages.set(OWN, page('<h1>404</h1>', 404));
    expect(await run({ checks: [absent()], contentHash: null })).toEqual({ live: true, failures: [] });
  });
  it('fails when a 404 page of the own path still carries the marker', async () => {
    site.pages.set(OWN, page(entryMarker(ID, OLD), 404));
    expect((await run({ checks: [absent()], contentHash: null })).live).toBe(false);
  });
  it('fails when a listing still contains the entry marker', async () => {
    site.pages.set(OWN, page('', 404));
    site.pages.set('/frettir', page(`<ul>${entryMarker('other', OLD)}${entryMarker(ID, OLD)}</ul>`));
    expect(await runOnFakeClock({ checks: [absent(), absent('/frettir')], contentHash: null })).toMatchObject({
      live: false,
      failures: [{ path: '/frettir', reason: expect.stringContaining('marker') }],
    });
  });
  it('passes when the listing answers 200 without the marker', async () => {
    site.pages.set(OWN, page('', 404));
    site.pages.set('/frettir', page(entryMarker('other', OLD)));
    expect((await run({ checks: [absent(), absent('/frettir')], contentHash: null })).live).toBe(true);
  });
  it.each([
    ['an id-only marker', `<span hidden data-cms-entry="${ID}"></span>`],
    ['a marker with an empty hash', `<span hidden data-cms-entry="${ID}" data-cms-hash=""></span>`],
    ['a marker with a malformed hash', `<span hidden data-cms-entry="${ID}" data-cms-hash></span>`],
  ])('fails closed on %s (Task 18 security r1, 11b)', async (_, marker) => {
    site.pages.set(OWN, page('', 404));
    site.pages.set('/frettir', page(marker));
    expect((await run({ checks: [absent(), absent('/frettir')], contentHash: null })).live).toBe(false);
  });
  it('fails when a listing does not answer 200 (an error page proves nothing)', async () => {
    site.pages.set(OWN, page('', 404));
    site.pages.set('/frettir', page('', 503));
    expect((await run({ checks: [absent(), absent('/frettir')], contentHash: null })).live).toBe(false);
  });
});

describe('media', () => {
  it('a media URL answering 404 means not live', async () => {
    site.pages.set(OWN, page(entryMarker(ID, NEW)));
    site.pages.set('/media/a.jpg', { status: 404 });
    const media = `${site.origin}/media/a.jpg`;
    expect(await run({ checks: [present()], mediaUrls: [media] })).toMatchObject({ live: false, failures: [{ path: media }] });
  });
  it('media answering 200 passes', async () => {
    site.pages.set(OWN, page(entryMarker(ID, NEW)));
    site.pages.set('/media/a.jpg', { status: 200, html: 'jpeg' });
    expect((await run({ checks: [present()], mediaUrls: [`${site.origin}/media/a.jpg`] })).live).toBe(true);
  });
});

describe('resend', () => {
  it('a stale hash after at least one poll triggers exactly one resend, then live is not confirmed', async () => {
    site.pages.set(OWN, page(entryMarker(ID, OLD)));
    site.pages.set('/frettir', page(entryMarker(ID, OLD)));
    const resend = vi.fn(async () => {});
    // Two stale pages, still one resend for the whole run.
    const result = await run({ checks: [present(), present('/frettir')], resend });
    expect(result.live).toBe(false);
    expect(resend).toHaveBeenCalledTimes(1);
    expect(site.hits(OWN)).toBeGreaterThan(2);
  });
  it('does not resend on a stale hash seen only on the first poll', async () => {
    let n = 0;
    site.pages.set(OWN, () => page(entryMarker(ID, ++n === 1 ? OLD : NEW)));
    const resend = vi.fn(async () => {});
    expect((await run({ checks: [present()], resend })).live).toBe(true);
    expect(resend).not.toHaveBeenCalled();
  });
  it.each([
    ['answered 404', (n: number) => (n === 1 ? page('<main></main>', 404) : page(entryMarker(ID, NEW)))],
    ['had no marker', (n: number) => page(n === 1 ? '<main></main>' : entryMarker(ID, NEW))],
  ])('does not resend when the page %s only on the first poll', async (_name, at) => {
    let n = 0;
    site.pages.set(OWN, () => at(++n));
    const resend = vi.fn(async () => {});
    expect((await run({ checks: [present()], resend })).live).toBe(true);
    expect(resend).not.toHaveBeenCalled();
  });
  it('confirms after the resend when the page then shows the new hash', async () => {
    let resent = false;
    site.pages.set(OWN, () => page(entryMarker(ID, resent ? NEW : OLD)));
    const resend = vi.fn(async () => {
      resent = true;
    });
    expect((await run({ checks: [present()], resend })).live).toBe(true);
    expect(resend).toHaveBeenCalledTimes(1);
  });
  describe('waits for the pointer to expire from the CDN (§7.2, §7.4; decision 48)', () => {
    // A fake clock and a fake fetcher: every poll sees the old hash.
    const stalePage: PageFetcher = async () => ({ status: 200, body: html(releaseMeta(5), entryMarker(ID, OLD)) });
    const runAt = (pointerWrittenAt: number | undefined, resend: () => Promise<void>) =>
      runLiveChecks({ baseUrl: 'https://site.test', checks: [present()], ownPath: OWN, entry: { id: ID, contentHash: NEW }, mediaUrls: [], resend, fetchPage: stalePage, pointerWrittenAt });
    beforeEach(() => {
      vi.useFakeTimers({ now: 1_000_000 });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('stale at 3 s: no resend before max-age + 1 s after the pointer was written, then exactly one', async () => {
      const resend = vi.fn(async () => {});
      const done = runAt(Date.now(), resend);
      await vi.advanceTimersByTimeAsync(3_000); // the second poll sees the stale hash
      await vi.advanceTimersByTimeAsync(POINTER_MAX_AGE_S * 1_000 + 1_000 - 3_000 - 1);
      expect(resend).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(resend).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS);
      expect((await done).live).toBe(false);
      expect(resend).toHaveBeenCalledTimes(1);
    });
    it('resends at once when that moment has already passed when the page is first seen stale', async () => {
      const resend = vi.fn(async () => {});
      const done = runAt(Date.now() - 40_000, resend);
      await vi.advanceTimersByTimeAsync(2_999);
      expect(resend).not.toHaveBeenCalled(); // the first poll triggers regeneration
      await vi.advanceTimersByTimeAsync(1);
      expect(resend).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS);
      await done;
      expect(resend).toHaveBeenCalledTimes(1);
    });
    it('without a write time (a sweep retry), resends at the second poll', async () => {
      const resend = vi.fn(async () => {});
      const done = runAt(undefined, resend);
      await vi.advanceTimersByTimeAsync(2_999);
      expect(resend).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(resend).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS);
      await done;
      expect(resend).toHaveBeenCalledTimes(1);
    });
    // Decision 48.1 ("Resend on any miss"): a page built from the old pointer may show no marker.
    const missing = (page: { status: number; body: string }) =>
      async (url: string): Promise<{ status: number; body: string | null }> => (url.endsWith(OWN) ? page : { status: 404, body: null });
    it.each([
      ['a first publish: the own page still answers 404', present(), { status: 404, body: html(releaseMeta(5), '<main></main>') }],
      ['a first publish: the page has no marker', present(), { status: 200, body: html(releaseMeta(5), '<main></main>') }],
      ['an unpublish: the page still shows the marker', absent(), { status: 200, body: html(releaseMeta(5), entryMarker(ID, OLD)) }],
    ])('%s from the second poll: no resend before max-age + 1 s, then exactly one', async (_name, check, page) => {
      const resend = vi.fn(async () => {});
      const done = runLiveChecks({ baseUrl: 'https://site.test', checks: [check], ownPath: OWN, entry: { id: ID, contentHash: NEW }, mediaUrls: [], resend, fetchPage: missing(page), pointerWrittenAt: Date.now() });
      await vi.advanceTimersByTimeAsync(POINTER_MAX_AGE_S * 1_000 + 1_000 - 1);
      expect(resend).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(resend).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS);
      expect((await done).live).toBe(false);
      expect(resend).toHaveBeenCalledTimes(1);
    });
    it('a page that missed and then passed still resends when due while a media URL is pending (sticky)', async () => {
      const resend = vi.fn(async () => {});
      let polls = 0;
      const fetchPage: PageFetcher = async (url) => {
        if (!url.endsWith(OWN)) return { status: 404, body: null };
        polls++;
        return polls <= 2 ? { status: 404, body: html(releaseMeta(5), '<main></main>') } : { status: 200, body: html(releaseMeta(6), entryMarker(ID, NEW)) };
      };
      const done = runLiveChecks({ baseUrl: 'https://site.test', checks: [present()], ownPath: OWN, entry: { id: ID, contentHash: NEW }, mediaUrls: ['https://media.test/a.jpg'], resend, fetchPage, pointerWrittenAt: Date.now() });
      await vi.advanceTimersByTimeAsync(POINTER_MAX_AGE_S * 1_000 + 1_000);
      expect(resend).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS);
      expect((await done).failures).toEqual([{ path: 'https://media.test/a.jpg', reason: 'status 404' }]);
    });
    it('a failing media URL alone does not resend (the site does not serve it)', async () => {
      const resend = vi.fn(async () => {});
      const fetchPage: PageFetcher = async (url) => (url.endsWith(OWN) ? { status: 200, body: html(releaseMeta(6), entryMarker(ID, NEW)) } : { status: 404, body: null });
      const done = runLiveChecks({ baseUrl: 'https://site.test', checks: [present()], ownPath: OWN, entry: { id: ID, contentHash: NEW }, mediaUrls: ['https://media.test/a.jpg'], resend, fetchPage, pointerWrittenAt: Date.now() });
      await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS);
      expect((await done).live).toBe(false);
      expect(resend).not.toHaveBeenCalled();
    });
    it('never resends after the window closes when the moment falls past it', async () => {
      const resend = vi.fn(async () => {});
      let settled = false;
      const done = runAt(Date.now() + DEFAULT_TIMEOUT_MS, resend).finally(() => (settled = true));
      await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS);
      expect(settled).toBe(true); // the run ends at the deadline, not at the resend moment
      expect((await done).live).toBe(false);
      expect(resend).not.toHaveBeenCalled();
    });
  });
  it('a failing resend does not throw', async () => {
    site.pages.set(OWN, page(entryMarker(ID, OLD)));
    const resend = vi.fn(async () => {
      throw new Error('boom');
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await run({ checks: [present()], resend })).live).toBe(false);
    expect(resend).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});

describe('limits', () => {
  it('stops polling at the timeout', async () => {
    site.pages.set(OWN, page(''));
    const started = Date.now();
    await runLiveChecks({ baseUrl: site.origin, checks: [present()], ownPath: OWN, entry: { id: ID, contentHash: NEW }, mediaUrls: [], resend: async () => {}, pollMs: 50, timeoutMs: 300 });
    expect(Date.now() - started).toBeLessThan(1500);
    expect(site.hits(OWN)).toBeGreaterThanOrEqual(2);
    expect(site.hits(OWN)).toBeLessThanOrEqual(8);
  });
  it('fails a check whose path is not a root-relative path, without fetching it', async () => {
    const result = await run({ checks: [present('//evil.example/x'), present('http://evil.example/')] });
    expect(result.live).toBe(false);
    expect(result.failures.map((f) => f.reason)).toEqual(['invalid_path', 'invalid_path']);
    expect(site.requests).toHaveLength(0);
  });
  it('does not follow redirects', async () => {
    site.pages.set(OWN, { status: 308, headers: { location: '/elsewhere' } });
    site.pages.set('/elsewhere', page(entryMarker(ID, NEW)));
    expect((await run({ checks: [present()] })).live).toBe(false);
    expect(site.hits('/elsewhere')).toBe(0);
  });
  it('fails a page larger than the size cap', async () => {
    site.pages.set(OWN, page(entryMarker(ID, NEW) + 'x'.repeat(6 * 1024 * 1024)));
    // One poll only (the poll interval is the whole window), so no later poll can meet the deadline.
    expect(await run({ checks: [present()], window: ONE_POLL })).toMatchObject({ live: false, failures: [{ reason: 'too_large' }] });
  });
  it('with no checks and no media, the entry is live (nothing declared)', async () => {
    expect(await run({ checks: [] })).toEqual({ live: true, failures: [] });
  });
});

// Task 21 security r1: a page whose scan desynchronises or cannot complete is no proof of absence.
describe('absent on pages the scan cannot read to the end', () => {
  it.each([
    ['a title', '<title>Heimsókn frá İzmir</title>'],
    ['a script', '<script>1</script>'],
    ['a style', '<style>p{}</style>'],
    ['a textarea', '<textarea>x</textarea>'],
    ['a template', '<template><p>x</p></template>'],
    ['a comment', '<!-- x -->'],
  ])('fails when the marker follows İ and %s (Major)', async (_, el) => {
    site.pages.set(OWN, page('', 404));
    site.pages.set('/frettir', page(`<p>İzmir</p>${el}<ul>${entryMarker(ID, OLD)}</ul>`));
    expect(await runOnFakeClock({ checks: [absent(), absent('/frettir')], contentHash: null })).toMatchObject({
      live: false,
      failures: [{ path: '/frettir', reason: 'marker_present' }],
    });
  });
  it.each([
    ['a never-closed script', '<script>var a = 1;'],
    ['an unterminated tag', '<div class="x"'],
    ['an unterminated comment', '<!-- x'],
  ])('fails as inconclusive on a page with %s', async (_, tail) => {
    site.pages.set(OWN, page('', 404));
    site.pages.set('/frettir', { status: 200, html: `<html><body><ul>${entryMarker('other', OLD)}</ul>${tail}` });
    expect(await runOnFakeClock({ checks: [absent(), absent('/frettir')], contentHash: null })).toMatchObject({
      live: false,
      failures: [{ path: '/frettir', reason: 'scan_incomplete' }],
    });
  });
  it('fails as inconclusive on a 404 own path that cannot be read to the end', async () => {
    site.pages.set(OWN, { status: 404, html: '<html><body><h1>404</h1><script>x' });
    expect(await runOnFakeClock({ checks: [absent()], contentHash: null })).toMatchObject({ live: false, failures: [{ path: OWN, reason: 'scan_incomplete' }] });
  });
  it('a present check still passes when its marker is found before the scan stops', async () => {
    site.pages.set(OWN, { status: 200, html: `<html><body>${entryMarker(ID, NEW)}<script>x` });
    expect(await runOnFakeClock({ checks: [present()] })).toEqual({ live: true, failures: [] });
  });
});

// Task 21 security r1, Minor: page fetches per site are bounded and identical ones shared.
describe('page fetches', () => {
  it(`runs at most ${MAX_CONCURRENT_FETCHES} fetches at a time against a site`, async () => {
    let active = 0;
    let peak = 0;
    site.handler = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 30));
      active--;
      return page('<p>ekkert</p>');
    };
    const checks = Array.from({ length: 20 }, (_, i) => absent(`/listi/${i}`));
    const result = await runLiveChecks({ baseUrl: site.origin, checks, ownPath: OWN, entry: { id: ID, contentHash: null }, mediaUrls: [], resend: async () => {}, pollMs: 20, timeoutMs: 3_000 });
    expect(result).toEqual({ live: true, failures: [] });
    expect(site.requests).toHaveLength(20);
    expect(peak).toBe(MAX_CONCURRENT_FETCHES);
  });
  it('a shared fetcher fetches a page once for every run that checks it at the same time', async () => {
    site.handler = async () => {
      await new Promise((r) => setTimeout(r, 30));
      return undefined;
    };
    site.pages.set('/frettir', page(entryMarker('a', NEW) + entryMarker('b', NEW)));
    const fetchPage = createPageFetcher();
    const one = (id: string) =>
      runLiveChecks({ baseUrl: site.origin, checks: [present('/frettir')], ownPath: OWN, entry: { id, contentHash: NEW }, mediaUrls: [], resend: async () => {}, fetchPage, ...fast });
    expect(await Promise.all([one('a'), one('b'), one('a')])).toEqual([0, 1, 2].map(() => ({ live: true, failures: [] })));
    expect(site.hits('/frettir')).toBe(1);
  });
  it('checks of one run on the same path share the fetch', async () => {
    site.handler = async () => {
      await new Promise((r) => setTimeout(r, 30));
      return undefined;
    };
    site.pages.set('/frettir', page(entryMarker(ID, NEW)));
    expect((await run({ checks: [present('/frettir'), present('/frettir')] })).live).toBe(true);
    expect(site.hits('/frettir')).toBe(1);
  });
  it('a fetch waiting for a free slot past the deadline is not made', async () => {
    site.handler = () => 'hang';
    const fetchPage = createPageFetcher(1);
    const deadline = Date.now() + 1_200;
    const results = await Promise.all([fetchPage(`${site.origin}/a`, deadline, 100), fetchPage(`${site.origin}/b`, deadline, 100)]);
    expect(results.map((r) => r.error)).toEqual(['fetch_failed', 'timeout']);
    expect(site.requests.map((r) => r.path)).toEqual(['/a']);
  });
});
