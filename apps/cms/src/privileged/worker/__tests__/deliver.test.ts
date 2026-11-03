// Which entries a delivered release live-checks, and how (plan Task 21, decision 35; spec §7.1, §7.4).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModuleManifest, SiteEntry } from '@litljomi/cms-schema';
import type { Bundle, BundleEntry } from '@litljomi/cms-sdk';
import type { SupabaseClient } from '../../../lib/supabase/types';
import { entryMarker, html, releaseMeta, startFakeSite, type FakeSite } from './fake-site';

const mocks = vi.hoisted(() => ({
  alert: vi.fn(async (_event: string, _details: Record<string, unknown>) => {}),
  module: { current: undefined as unknown },
}));
vi.mock('../alerts', () => ({ alert: (event: string, details: Record<string, unknown>) => mocks.alert(event, details) }));
vi.mock('@/modules/registry', () => ({ getModule: (slug: string) => (slug === 'prufa' ? mocks.module.current : undefined) }));

const { clockOf, confirmRelease, confirmSite, liveTargets, releaseView } = await import('../deliver');
type DeliveredRelease = import('../deliver').DeliveredRelease;
type LiveTarget = import('../deliver').LiveTarget;
type WorkerSite = import('../deliver').WorkerSite;

const MEDIA = 'https://media.example/storage/v1/object/public/media-public/';
const E1 = '11111111-1111-4111-8111-111111111111';
const E2 = '22222222-2222-4222-8222-222222222222';
const E3 = '33333333-3333-4333-8333-333333333333';
const E4 = '44444444-4444-4444-8444-444444444444';

const entry = (id: string, slug: string, sortAt: string | null, data: Record<string, unknown> = {}): BundleEntry => ({
  id,
  revisionId: 'r-' + id,
  contentHash: 'h-' + id,
  slug,
  title: slug,
  sortAt,
  firstPublishedAt: '2026-01-01T00:00:00.000Z',
  lastPublishedAt: '2026-01-01T00:00:00.000Z',
  schemaVersion: 1,
  data,
});
const bundle = (release: number, entries: BundleEntry[]): Bundle => ({ format: 1, tenant: 'prufa', release, generatedAt: 'x', entries: { news: entries } });

const seen: Array<{ e: SiteEntry; release: string[]; previous: string[] | null }> = [];
const module = {
  tenant: 'prufa',
  site: {
    news: {
      path: (e: SiteEntry) => `/n/${e.slug}`,
      checks(e: SiteEntry, release: { entries(t: string): SiteEntry[] }, previous: { entries(t: string): SiteEntry[] } | null) {
        seen.push({ e, release: release.entries('news').map((x) => x.id), previous: previous?.entries('news').map((x) => x.id) ?? null });
        const expect = release.entries('news').some((x) => x.id === e.id) ? 'present' : 'absent';
        return [
          { path: `/n/${e.slug}`, expect },
          { path: '/n', expect },
        ];
      },
    },
  },
} as unknown as ModuleManifest;
mocks.module.current = module;

describe('releaseView', () => {
  it('lists a type’s entries by sortAt descending, entries without one last', () => {
    const view = releaseView(bundle(2, [entry(E1, 'a', '2026-01-01T00:00:00.000Z'), entry(E2, 'b', null), entry(E3, 'c', '2026-02-01T00:00:00.000Z')]));
    expect(view.entries('news').map((e) => e.id)).toEqual([E3, E1, E2]);
    expect(view.entries('other')).toEqual([]);
    expect(view.entries('news')[0]).toEqual({ id: E3, type: 'news', slug: 'c', sortAt: '2026-02-01T00:00:00.000Z' });
  });
});

describe('liveTargets', () => {
  const image = { url: `${MEDIA}prufa/${E4}/a.jpg`, alt: 'x' };
  const current = bundle(3, [entry(E1, 'a', '2026-03-01T00:00:00.000Z', { image, body: [{ src: `${MEDIA}prufa/x/b.png` }, 'https://other.example/c.jpg'] })]);
  const previous = bundle(2, [entry(E2, 'b', '2026-02-01T00:00:00.000Z'), entry(E3, 'c', null)]);

  it('a published entry: present checks against this release, its new hash, its own path and its media URLs', () => {
    seen.length = 0;
    const [t] = liveTargets(module, { bundle: current, previousBundle: previous, requests: [{ id: 'q1', entryId: E1, action: 'publish' }] }, MEDIA);
    expect(t).toEqual({
      entryId: E1,
      requestIds: ['q1'],
      failure: null,
      checks: [
        { path: '/n/a', expect: 'present' },
        { path: '/n', expect: 'present' },
      ],
      ownPath: '/n/a',
      contentHash: 'h-' + E1,
      mediaUrls: [`${MEDIA}prufa/${E4}/a.jpg`, `${MEDIA}prufa/x/b.png`],
    });
    expect(seen[0]).toMatchObject({ release: [E1], previous: [E2, E3] });
  });

  it('an unpublished entry: absent checks computed from the previous release’s record, no hash', () => {
    const [t] = liveTargets(module, { bundle: current, previousBundle: previous, requests: [{ id: 'q2', entryId: E2, action: 'unpublish' }] }, MEDIA);
    expect(t).toMatchObject({
      entryId: E2,
      failure: null,
      checks: [
        { path: '/n/b', expect: 'absent' },
        { path: '/n', expect: 'absent' },
      ],
      ownPath: '/n/b',
      contentHash: null,
      mediaUrls: [],
    });
  });

  it('a published entry left out of the release (omitted) is delivery failed, never checked as present', () => {
    const [t] = liveTargets(module, { bundle: current, previousBundle: previous, requests: [{ id: 'q3', entryId: E3, action: 'publish' }] }, MEDIA);
    expect(t).toMatchObject({ entryId: E3, failure: 'delivery_failed', checks: [] });
  });

  it('an unpublished entry that no delivered release contained has nothing to check', () => {
    const [t] = liveTargets(module, { bundle: current, previousBundle: null, requests: [{ id: 'q4', entryId: E4, action: 'unpublish' }] }, MEDIA);
    expect(t).toMatchObject({ entryId: E4, failure: null, checks: [], mediaUrls: [] });
  });

  it('one target per entry; the release’s content decides (a publish then an unpublish of the same entry)', () => {
    const targets = liveTargets(
      module,
      {
        bundle: current,
        previousBundle: previous,
        requests: [
          { id: 'q5', entryId: E2, action: 'publish' },
          { id: 'q6', entryId: E2, action: 'unpublish' },
          { id: 'q7', entryId: E1, action: 'publish' },
        ],
      },
      MEDIA,
    );
    expect(targets.map((t) => [t.entryId, t.requestIds, t.failure, t.checks[0]?.expect])).toEqual([
      [E2, ['q5', 'q6'], null, 'absent'],
      [E1, ['q7'], null, 'present'],
    ]);
  });

  it('a type without site pages has no checks, but its media is still checked', () => {
    const other = bundle(3, []);
    other.entries['page'] = [{ ...entry(E1, 'a', null, { image }) }];
    const [t] = liveTargets(module, { bundle: other, previousBundle: null, requests: [{ id: 'q8', entryId: E1, action: 'publish' }] }, MEDIA);
    expect(t).toMatchObject({ failure: null, checks: [], mediaUrls: [image.url], contentHash: 'h-' + E1 });
  });

  it('a module whose checks throw gives a failure, not an exception', () => {
    const broken = { site: { news: { path: () => '/x', checks: () => { throw new Error('boom'); } } } } as unknown as ModuleManifest;
    const [t] = liveTargets(broken, { bundle: current, previousBundle: null, requests: [{ id: 'q9', entryId: E1, action: 'publish' }] }, MEDIA);
    expect(t).toMatchObject({ failure: 'checks_failed', checks: [] });
  });
});

// Task 21 security r1, Minor: the targets of one delivery to a site share its page fetches.
describe('confirmSite', () => {
  it('fetches a page shared by several targets once per round', async () => {
    const site = await startFakeSite();
    try {
      site.pages.set('/api/revalidate', { status: 200 });
      site.handler = async (req) => {
        if (req.method === 'GET') await new Promise((r) => setTimeout(r, 30));
        return undefined;
      };
      site.pages.set('/n', { status: 200, html: entryMarker(E1, 'h1') + entryMarker(E2, 'h2') + entryMarker(E3, 'h3') });
      const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
      const db = {
        rpc: async (fn: string, args: Record<string, unknown>) => {
          calls.push({ fn, args });
          return { data: null, error: null };
        },
      } as unknown as SupabaseClient;
      const target = (id: string, hash: string): LiveTarget => ({ entryId: id, requestIds: ['r-' + id], failure: null, checks: [{ path: '/n', expect: 'present' }], ownPath: '/n/x', contentHash: hash, mediaUrls: [] });
      const release: DeliveredRelease = { tenantId: 't', tenantSlug: 'prufa', releaseId: 'rel', number: 2, bundle: bundle(2, []), previousBundle: null, requests: [] };
      const outcome = await confirmSite(
        db,
        release,
        { id: 's', base_url: site.origin, revalidate_url: `${site.origin}/api/revalidate`, webhook_secrets: ['leyndo'] },
        [target(E1, 'h1'), target(E2, 'h2'), target(E3, 'h3')],
        { pollMs: 20, timeoutMs: 1_000 },
      );
      expect(outcome).toBe('ok');
      expect(site.hits('/n')).toBe(1);
      expect(calls.at(-1)?.args).toMatchObject({ p_live_status: 'ok' });
    } finally {
      await site.close();
    }
  });
});

// Task 21 quality r1, Minor 1: the branches of confirmSite's failure paths.
describe('confirmSite: failures', () => {
  let site: FakeSite;
  const recorded: Array<Record<string, unknown>> = [];
  /** What api.worker_record_delivery answers: the delivery's schedule after the call (M3-02). */
  let schedule: unknown = [{ notify_attempts: 1, next_attempt_at: '2026-11-03T12:01:00.000Z', retries_exhausted: false }];
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'worker_record_delivery') recorded.push(args);
      return { data: fn === 'worker_record_delivery' ? schedule : null, error: null };
    },
  } as unknown as SupabaseClient;
  /** A fake clock: 2026-11-03 12:00 UTC. */
  const clock = { now: () => Date.UTC(2026, 10, 3, 12, 0, 0) };
  const release: DeliveredRelease = { tenantId: 't', tenantSlug: 'prufa', releaseId: 'rel', number: 2, bundle: bundle(2, []), previousBundle: null, requests: [] };
  const workerSite = (secrets = ['leyndo']): WorkerSite => ({ id: 's', base_url: site.origin, revalidate_url: `${site.origin}/api/revalidate`, webhook_secrets: secrets });

  beforeEach(async () => {
    recorded.length = 0;
    schedule = [{ notify_attempts: 1, next_attempt_at: '2026-11-03T12:01:00.000Z', retries_exhausted: false }];
    mocks.alert.mockClear();
    site = await startFakeSite();
  });
  afterEach(async () => {
    await site.close();
  });

  it('records a failed notification at the options\' clock (M3-02: the database schedules the retry)', async () => {
    site.pages.set('/api/revalidate', { status: 500 });

    expect(await confirmSite(db, release, workerSite(), [], clock)).toBe('notify_failed');

    expect(recorded).toEqual([
      {
        p_release_id: 'rel',
        p_site_id: 's',
        p_notify_status: 'failed',
        p_live_status: null,
        p_error: { code: 'notify_failed', status: 500 },
        p_now: '2026-11-03T12:00:00.000Z',
      },
    ]);
  });

  it('a failed notification with a next attempt scheduled does not alert', async () => {
    site.pages.set('/api/revalidate', { status: 500 });
    expect(await confirmSite(db, release, workerSite(), [], clock)).toBe('notify_failed');
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it('alerts once that the retries are exhausted when the record says so (24 hours after the first failure)', async () => {
    site.pages.set('/api/revalidate', { status: 500 });
    schedule = [{ notify_attempts: 12, next_attempt_at: null, retries_exhausted: true }];

    expect(await confirmSite(db, release, workerSite(), [], clock)).toBe('notify_failed');

    expect(mocks.alert.mock.calls).toEqual([
      ['delivery.retries_exhausted', { tenantId: 't', releaseId: 'rel', number: 2, siteId: 's', attempts: 12, code: 'notify_failed', status: 500 }],
    ]);
  });

  it('a record that fails does not alert (the row is unchanged, so the sweep retries it)', async () => {
    site.pages.set('/api/revalidate', { status: 500 });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = { rpc: async () => ({ data: null, error: { code: '08006', message: 'connection failure' } }) } as unknown as SupabaseClient;

    expect(await confirmSite(failing, release, workerSite(), [], clock)).toBe('notify_failed');

    expect(mocks.alert).not.toHaveBeenCalled();
    vi.mocked(console.error).mockRestore();
  });

  it('records every status at the clock: an ok notification and its live status', async () => {
    site.pages.set('/api/revalidate', { status: 200 });
    expect(await confirmSite(db, release, workerSite(), [], clock)).toBe('ok');
    expect(recorded.map((r) => [r.p_notify_status, r.p_live_status, r.p_now])).toEqual([
      ['ok', null, '2026-11-03T12:00:00.000Z'],
      [null, 'ok', '2026-11-03T12:00:00.000Z'],
    ]);
  });

  it('clockOf: the options\' clock as an ISO timestamp, Date.now without one', () => {
    expect(clockOf(clock)).toBe('2026-11-03T12:00:00.000Z');
    const before = Date.now();
    const at = Date.parse(clockOf({}));
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  });

  it('a site without a webhook secret is recorded as no_webhook_secret and is never called', async () => {
    expect(await confirmSite(db, release, workerSite(['']), [], {})).toBe('notify_failed');
    expect(recorded[0]).toMatchObject({ p_notify_status: 'failed', p_error: { code: 'no_webhook_secret', status: 0 } });
    expect(site.requests).toEqual([]);
  });

  it('stores at most 50 live-check failures in last_error, with the count of the rest', async () => {
    site.pages.set('/api/revalidate', { status: 200 });
    const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    const targets: LiveTarget[] = Array.from({ length: 53 }, (_, i) => ({
      entryId: id(i),
      requestIds: [],
      failure: 'delivery_failed',
      checks: [],
      ownPath: '',
      contentHash: null,
      mediaUrls: [],
    }));

    expect(await confirmSite(db, release, workerSite(), targets, {})).toBe('not_confirmed');

    const last = recorded.at(-1)!;
    expect(last).toMatchObject({ p_notify_status: null, p_live_status: 'not_confirmed' });
    const error = last.p_error as { code: string; failures: unknown[]; more: number };
    expect(error.code).toBe('live_not_confirmed');
    expect(error.failures).toHaveLength(50);
    expect(error.more).toBe(3);
  });
});

// Task 21 quality r1, Minors 3 and 5: one confirmation path for the fast path and the sweep, and
// one site's error does not stop the others.
describe('confirmRelease', () => {
  let site: FakeSite;
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  let sites: unknown[];
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === 'worker_sites') return { data: sites, error: null };
      // A failed notification of s2 exhausts its retries (M3-02); everything else is scheduled.
      if (fn === 'worker_record_delivery' && args.p_notify_status === 'failed') {
        const exhausted = args.p_site_id === 's2';
        return { data: [{ notify_attempts: exhausted ? 12 : 1, next_attempt_at: exhausted ? null : '2026-11-03T12:01:00Z', retries_exhausted: exhausted }], error: null };
      }
      return { data: null, error: null };
    },
  } as unknown as SupabaseClient;
  const release: DeliveredRelease = { tenantId: 't', tenantSlug: 'prufa', releaseId: 'rel', number: 2, bundle: bundle(2, []), previousBundle: null, requests: [] };
  const workerSite = (id: string, secrets: unknown = ['leyndo']) => ({ id, base_url: site.origin, revalidate_url: `${site.origin}/api/revalidate/${id}`, webhook_secrets: secrets });
  const recordedSites = () => calls.filter((c) => c.fn === 'worker_record_delivery').map((c) => c.args.p_site_id);

  beforeEach(async () => {
    calls.length = 0;
    mocks.alert.mockClear();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    site = await startFakeSite();
    for (const id of ['s1', 's2', 's3']) site.pages.set(`/api/revalidate/${id}`, { status: 200 });
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await site.close();
  });

  it('confirms every active site of the tenant', async () => {
    sites = [workerSite('s1'), workerSite('s2')];
    await confirmRelease(db, release, {});
    expect(calls[0]).toEqual({ fn: 'worker_sites', args: { p_tenant_id: 't' } });
    expect(new Set(recordedSites())).toEqual(new Set(['s1', 's2']));
  });

  it('a retry confirms only the sites it names; a site no longer active is skipped', async () => {
    sites = [workerSite('s1'), workerSite('s2')];
    site.pages.set('/api/revalidate/s2', { status: 500 });

    await confirmRelease(db, release, {}, new Set(['s2', 's3']));

    expect(site.requests.map((r) => r.path)).toEqual(['/api/revalidate/s2']);
    expect(recordedSites()).toEqual(['s2']);
    expect(mocks.alert).toHaveBeenCalledWith('delivery.retries_exhausted', expect.objectContaining({ siteId: 's2', attempts: 12 }));
  });

  it('one site’s error does not stop the others; the errors are thrown together after all settled', async () => {
    // A malformed row (no secret list) makes that site's confirmation throw.
    sites = [workerSite('s1', null), workerSite('s2'), workerSite('s3', null)];

    const error = await confirmRelease(db, release, {}).then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toHaveLength(2);
    expect(calls.filter((c) => c.fn === 'worker_record_delivery' && c.args.p_site_id === 's2').at(-1)?.args).toMatchObject({ p_live_status: 'ok' });
  });

  it('a tenant without a module is an error', async () => {
    sites = [];
    await expect(confirmRelease(db, { ...release, tenantSlug: 'onnur' }, {})).rejects.toThrow(/no module for tenant onnur/);
  });
});

// Decision 49.1: a fresh delivery waits until the pointer's public URL serves its release before
// any site is notified, within a bound; then the per-publish, per-resend and per-result log lines.
describe('confirmRelease: the public pointer', () => {
  let site: FakeSite;
  const events: string[] = [];
  const recorded: Array<Record<string, unknown>> = [];
  let sites: unknown[];
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'worker_record_delivery') recorded.push(args);
      return { data: fn === 'worker_sites' ? sites : null, error: null };
    },
  } as unknown as SupabaseClient;
  const POINTER_URL = 'https://example.supabase.co/storage/v1/object/public/delivery/prufa/current.json';
  const published: DeliveredRelease = {
    tenantId: 't',
    tenantSlug: 'prufa',
    releaseId: 'rel',
    number: 2,
    bundle: bundle(2, [entry(E1, 'a', null)]),
    previousBundle: null,
    requests: [{ id: 'q1', entryId: E1, action: 'publish' }],
  };
  const workerSite = (id: string) => ({ id, base_url: site.origin, revalidate_url: `${site.origin}/api/revalidate/${id}`, webhook_secrets: ['leyndo'] });

  /** A fake clock (starting now) and a fake public fetch answering `releases` in order (the last repeats). */
  function pointerSeams(releases: number[]) {
    const c = { t: Date.now() };
    const urls: string[] = [];
    const fetch = (async (url: string) => {
      urls.push(String(url));
      const n = releases[Math.min(urls.length - 1, releases.length - 1)]!;
      events.push(`poll ${n}`);
      c.t += 20;
      return new Response(JSON.stringify({ format: 1, tenant: 'prufa', release: n, bundle: `releases/${n}.json`, generatedAt: 'x' }));
    }) as unknown as typeof globalThis.fetch;
    return { c, urls, seams: { fetch, now: () => c.t, sleep: async (ms: number) => void (c.t += ms) } };
  }

  let info: ReturnType<typeof vi.spyOn>;
  beforeEach(async () => {
    events.length = 0;
    recorded.length = 0;
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    info = vi.spyOn(console, 'info').mockImplementation(() => {});
    site = await startFakeSite();
    site.handler = (req) => {
      if (req.method === 'POST') {
        events.push(`notify ${req.path}`);
        return { status: 200 };
      }
      return undefined;
    };
    for (const path of ['/n/a', '/n']) site.pages.set(path, { status: 200, html: entryMarker(E1, 'h-' + E1) });
    sites = [workerSite('s1')];
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    info.mockRestore();
    await site.close();
  });

  const infoLines = (label: string) => info.mock.calls.filter((c) => c[0] === `[cms-worker] ${label}`).map((c) => c[1] as Record<string, unknown>);

  it('polls the public pointer until it serves the release, and only then notifies', async () => {
    const p = pointerSeams([1, 1, 2]);
    const written = p.c.t;

    await confirmRelease(db, { ...published, pointerWrittenAt: written }, { pollMs: 20, timeoutMs: 1_000, pointer: p.seams });

    expect(p.urls).toEqual([POINTER_URL, POINTER_URL, POINTER_URL]);
    expect(events).toEqual(['poll 1', 'poll 1', 'poll 2', 'notify /api/revalidate/s1']);
    expect(recorded.at(-1)).toMatchObject({ p_site_id: 's1', p_live_status: 'ok' });
    expect(infoLines('pointer')).toEqual([{ tenant: 'prufa', release: 2, fresh: true, lagMs: 2_060, polls: 3 }]);
  });

  it('polls once per release, not once per site', async () => {
    sites = [workerSite('s1'), workerSite('s2')];
    const p = pointerSeams([2]);
    await confirmRelease(db, { ...published, pointerWrittenAt: p.c.t }, { pollMs: 20, timeoutMs: 1_000, pointer: p.seams });
    expect(p.urls).toHaveLength(1);
    expect(events.filter((e) => e.startsWith('notify')).sort()).toEqual(['notify /api/revalidate/s1', 'notify /api/revalidate/s2']);
  });

  it('(c) never fresh within the bound: the site is still notified and the live check runs', async () => {
    const p = pointerSeams([1]);
    const written = p.c.t;

    await confirmRelease(db, { ...published, pointerWrittenAt: written }, { pollMs: 20, timeoutMs: 1_000, pointer: p.seams });

    expect(p.c.t).toBe(written + 120_000);
    expect(events.at(-1)).toBe('notify /api/revalidate/s1');
    expect(site.hits('/n/a')).toBeGreaterThan(0);
    expect(recorded.at(-1)).toMatchObject({ p_site_id: 's1', p_live_status: 'ok' });
    expect(infoLines('pointer')).toEqual([{ tenant: 'prufa', release: 2, fresh: false, lagMs: 120_000, polls: expect.any(Number) }]);
  });

  it('the bound is the run deadline less the live check and the margin when that is earlier', async () => {
    const p = pointerSeams([1]);
    const written = p.c.t;
    // 100 s left: 100 - 1 (this live check's timeout) - 10 = 89 s.
    await confirmRelease(db, { ...published, pointerWrittenAt: written }, { pollMs: 20, timeoutMs: 1_000, runDeadline: written + 100_000, pointer: p.seams });
    expect(p.c.t).toBe(written + 89_000);
    expect(events.at(-1)).toBe('notify /api/revalidate/s1');
  });

  it('a run deadline already too close: no poll, the site is notified at once', async () => {
    const p = pointerSeams([2]);
    const written = p.c.t;
    await confirmRelease(db, { ...published, pointerWrittenAt: written }, { pollMs: 20, timeoutMs: 1_000, runDeadline: written + 5_000, pointer: p.seams });
    expect(p.urls).toEqual([]);
    expect(events).toEqual(['notify /api/revalidate/s1']);
    expect(infoLines('pointer')).toEqual([{ tenant: 'prufa', release: 2, fresh: false, lagMs: 0, polls: 0 }]);
  });

  it('a retry (no pointerWrittenAt) does not poll', async () => {
    const p = pointerSeams([2]);
    await confirmRelease(db, published, { pollMs: 20, timeoutMs: 1_000, pointer: p.seams }, new Set(['s1']));
    expect(p.urls).toEqual([]);
    expect(events).toEqual(['notify /api/revalidate/s1']);
    expect(infoLines('pointer')).toEqual([]);
  });

  it('logs each resend and each live-check result per site, without URLs', async () => {
    // A page from the old pointer until the resend arrives.
    let resent = false;
    site.handler = (req) => {
      if (req.method === 'POST') {
        if (events.some((e) => e.startsWith('notify'))) resent = true;
        events.push(`notify ${req.path}`);
        return { status: 200 };
      }
      return req.path === '/n/a' && !resent ? { status: 200, html: entryMarker(E1, 'old') } : undefined;
    };
    sites = [workerSite('s1')];
    const p = pointerSeams([2]);
    // Written long enough ago that the resend is due at once (decision 48).
    const written = Date.now() - 40_000;
    p.c.t = written;

    await confirmRelease(db, { ...published, pointerWrittenAt: written }, { pollMs: 20, timeoutMs: 2_000, pointer: p.seams });

    expect(events.filter((e) => e.startsWith('notify'))).toHaveLength(2);
    const [resend] = infoLines('resend');
    expect(infoLines('resend')).toHaveLength(1);
    expect(resend).toMatchObject({ tenant: 'prufa', release: 2, siteId: 's1', ok: true });
    expect(resend!.msSincePointerWrite).toBeGreaterThanOrEqual(40_000);
    expect(infoLines('live check')).toEqual([{ tenant: 'prufa', release: 2, siteId: 's1', status: 'ok', failures: 0 }]);
    expect(JSON.stringify(info.mock.calls)).not.toMatch(/https?:|leyndo/);
  });

  it('logs a not confirmed result with its number of failures', async () => {
    site.pages.set('/n', { status: 500 });
    const p = pointerSeams([2]);
    await confirmRelease(db, { ...published, pointerWrittenAt: p.c.t }, { pollMs: 20, timeoutMs: 200, pointer: p.seams });
    expect(infoLines('live check')).toEqual([{ tenant: 'prufa', release: 2, siteId: 's1', status: 'not_confirmed', failures: 1 }]);
  });
});

// M3-09: §7.4's re-send, per site and delivery (decisions 48.1 and 49).
describe('confirmSite: §7.4 re-send on a stale hash (M3-09)', () => {
  let site: FakeSite;
  const recorded: Array<Record<string, unknown>> = [];
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'worker_record_delivery') recorded.push(args);
      return { data: null, error: null };
    },
  } as unknown as SupabaseClient;
  const release: DeliveredRelease = { tenantId: 't', tenantSlug: 'prufa', releaseId: 'rel', number: 2, bundle: bundle(2, []), previousBundle: null, requests: [] };
  const target = (id: string, path: string): LiveTarget => ({ entryId: id, requestIds: ['r-' + id], failure: null, checks: [{ path, expect: 'present' }], ownPath: path, contentHash: 'new-' + id, mediaUrls: [] });
  const webhooks = () => site.requests.filter((r) => r.method === 'POST').length;
  let info: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    recorded.length = 0;
    info = vi.spyOn(console, 'info').mockImplementation(() => {});
    site = await startFakeSite();
    site.pages.set('/api/revalidate', { status: 200 });
  });
  afterEach(async () => {
    info.mockRestore();
    await site.close();
  });
  const confirm = (targets: LiveTarget[]) =>
    confirmSite(db, release, { id: 's', base_url: site.origin, revalidate_url: `${site.origin}/api/revalidate`, webhook_secrets: ['leyndo'] }, targets, { pollMs: 20, timeoutMs: 400 });

  it('sends the webhook again once per site, however many entries’ pages still show the old hash, then records live not confirmed', async () => {
    // A newer release marker in the layout changes nothing (§7.4).
    site.pages.set('/a', { status: 200, html: html(releaseMeta(99), entryMarker(E1, 'old')) });
    site.pages.set('/b', { status: 200, html: html(releaseMeta(99), entryMarker(E2, 'old')) });
    expect(await confirm([target(E1, '/a'), target(E2, '/b')])).toBe('not_confirmed');
    expect(webhooks()).toBe(2); // the notification and one resend
    expect(recorded.at(-1)).toMatchObject({
      p_live_status: 'not_confirmed',
      p_error: { code: 'live_not_confirmed', failures: expect.arrayContaining([{ entryId: E1, path: '/a', reason: 'stale_hash' }, { entryId: E2, path: '/b', reason: 'stale_hash' }]) },
    });
  });
  it('records live once the pages show the new hash after the resend', async () => {
    const after = (id: string) => () => ({ status: 200, html: entryMarker(id, webhooks() > 1 ? 'new-' + id : 'old') });
    site.pages.set('/a', after(E1));
    site.pages.set('/b', after(E2));
    expect(await confirm([target(E1, '/a'), target(E2, '/b')])).toBe('ok');
    expect(webhooks()).toBe(2);
    expect(recorded.at(-1)).toMatchObject({ p_live_status: 'ok' });
  });
  it('does not send the webhook again when every page shows the new hash', async () => {
    site.pages.set('/a', { status: 200, html: entryMarker(E1, 'new-' + E1) });
    expect(await confirm([target(E1, '/a')])).toBe('ok');
    expect(webhooks()).toBe(1);
  });
});

// M3-03: a not_confirmed delivery is retried on M3-02's schedule (the database keeps it; the
// selection and supersession are in 104_not_confirmed_retry and pipeline.integration.test.ts).
describe('confirmSite: retries after not_confirmed (M3-03)', () => {
  let site: FakeSite;
  const recorded: Array<Record<string, unknown>> = [];
  /** What api.worker_record_delivery answers for the live status: the delivery's schedule after the call. */
  let schedule: unknown;
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'worker_record_delivery') recorded.push(args);
      if (fn === 'worker_sites') return { data: [workerSite()], error: null };
      return { data: fn === 'worker_record_delivery' ? schedule : null, error: null };
    },
  } as unknown as SupabaseClient;
  const clock = { now: () => Date.UTC(2026, 10, 3, 12, 0, 0) };
  const E = E1;
  const published: DeliveredRelease = {
    tenantId: 't',
    tenantSlug: 'prufa',
    releaseId: 'rel',
    number: 2,
    bundle: bundle(2, [entry(E, 'a', '2026-01-01T00:00:00.000Z')]),
    previousBundle: null,
    requests: [{ id: 'q1', entryId: E, action: 'publish' }],
  };
  const workerSite = (): WorkerSite => ({ id: 's', base_url: site.origin, revalidate_url: `${site.origin}/api/revalidate`, webhook_secrets: ['leyndo'] });
  const webhooks = () => site.requests.filter((r) => r.method === 'POST').length;
  /** The entry's own page and the listing, at the hash the fake site currently renders. */
  const serve = (hash: string) => {
    site.pages.set('/n/a', { status: 200, html: entryMarker(E, hash) });
    site.pages.set('/n', { status: 200, html: entryMarker(E, hash) });
  };
  const fast = { ...clock, pollMs: 20, timeoutMs: 300 };

  beforeEach(async () => {
    recorded.length = 0;
    schedule = [{ notify_attempts: 1, next_attempt_at: '2026-11-03T12:01:00.000Z', retries_exhausted: false }];
    mocks.alert.mockClear();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.spyOn(console, 'info').mockImplementation(() => {});
    site = await startFakeSite();
    site.pages.set('/api/revalidate', { status: 200 });
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.mocked(console.info).mockRestore();
    await site.close();
  });

  it('a stale page that becomes fresh on the second attempt ends ok: re-notified, then live-checked in full', async () => {
    serve('old');
    await confirmRelease(db, published, fast);
    expect(recorded.map((r) => [r.p_notify_status, r.p_live_status])).toEqual([
      ['ok', null],
      [null, 'not_confirmed'],
    ]);
    expect(mocks.alert).not.toHaveBeenCalled(); // a next attempt is scheduled
    const before = webhooks();

    // The site has caught up by the sweep's retry (no pointer wait on a retry).
    serve('h-' + E);
    recorded.length = 0;
    schedule = [{ notify_attempts: 2, next_attempt_at: null, retries_exhausted: false }];
    await confirmRelease(db, published, { ...fast, now: () => clock.now() + 60_000 }, new Set(['s']));

    expect(webhooks() - before).toBe(1); // notified again
    expect(recorded.map((r) => [r.p_notify_status, r.p_live_status, r.p_now])).toEqual([
      ['ok', null, '2026-11-03T12:01:00.000Z'],
      [null, 'ok', '2026-11-03T12:01:00.000Z'],
    ]);
    expect(recorded.at(-1)?.p_error).toBeNull();
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it('a page still stale on a retry is recorded not_confirmed again, without an alert while a next attempt is due', async () => {
    serve('old');
    schedule = [{ notify_attempts: 3, next_attempt_at: '2026-11-03T12:05:00.000Z', retries_exhausted: false }];
    await confirmRelease(db, published, fast, new Set(['s']));
    expect(recorded.at(-1)).toMatchObject({ p_notify_status: null, p_live_status: 'not_confirmed', p_error: { code: 'live_not_confirmed' } });
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it('alerts once that the retries are exhausted when the not_confirmed record says so (24 hours after the first failure)', async () => {
    serve('old');
    schedule = [{ notify_attempts: 12, next_attempt_at: null, retries_exhausted: true }];
    expect(await confirmSite(db, published, workerSite(), [{ entryId: E, requestIds: ['q1'], failure: null, checks: [{ path: '/n', expect: 'present' }], ownPath: '/n/a', contentHash: 'h-' + E, mediaUrls: [] }], fast)).toBe(
      'not_confirmed',
    );
    expect(mocks.alert.mock.calls).toEqual([
      ['delivery.retries_exhausted', { tenantId: 't', releaseId: 'rel', number: 2, siteId: 's', attempts: 12, code: 'live_not_confirmed', failures: 1 }],
    ]);
  });
});
