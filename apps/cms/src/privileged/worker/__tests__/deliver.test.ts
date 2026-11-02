// Which entries a delivered release live-checks, and how (plan Task 21, decision 35; spec §7.1, §7.4).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModuleManifest, SiteEntry } from '@litljomi/cms-schema';
import type { Bundle, BundleEntry } from '@litljomi/cms-sdk';
import type { SupabaseClient } from '../../../lib/supabase/types';
import { entryMarker, startFakeSite, type FakeSite } from './fake-site';

const mocks = vi.hoisted(() => ({
  alert: vi.fn(async (_event: string, _details: Record<string, unknown>) => {}),
  module: { current: undefined as unknown },
}));
vi.mock('../alerts', () => ({ alert: (event: string, details: Record<string, unknown>) => mocks.alert(event, details) }));
vi.mock('@/modules/registry', () => ({ getModule: (slug: string) => (slug === 'prufa' ? mocks.module.current : undefined) }));

const { MAX_NOTIFY_ATTEMPTS, confirmRelease, confirmSite, liveTargets, releaseView } = await import('../deliver');
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
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'worker_record_delivery') recorded.push(args);
      return { data: null, error: null };
    },
  } as unknown as SupabaseClient;
  const release: DeliveredRelease = { tenantId: 't', tenantSlug: 'prufa', releaseId: 'rel', number: 2, bundle: bundle(2, []), previousBundle: null, requests: [] };
  const workerSite = (secrets = ['leyndo']): WorkerSite => ({ id: 's', base_url: site.origin, revalidate_url: `${site.origin}/api/revalidate`, webhook_secrets: secrets });

  beforeEach(async () => {
    recorded.length = 0;
    mocks.alert.mockClear();
    site = await startFakeSite();
  });
  afterEach(async () => {
    await site.close();
  });

  it(`a failed notification reaching attempt ${MAX_NOTIFY_ATTEMPTS} alerts that the retries are exhausted`, async () => {
    expect(MAX_NOTIFY_ATTEMPTS).toBe(10);
    site.pages.set('/api/revalidate', { status: 500 });

    expect(await confirmSite(db, release, workerSite(), [], {}, MAX_NOTIFY_ATTEMPTS - 1)).toBe('notify_failed');

    expect(recorded).toEqual([
      { p_release_id: 'rel', p_site_id: 's', p_notify_status: 'failed', p_live_status: null, p_error: { code: 'notify_failed', status: 500 } },
    ]);
    expect(mocks.alert.mock.calls).toEqual([
      ['delivery.retries_exhausted', { tenantId: 't', releaseId: 'rel', number: 2, siteId: 's', attempts: 10, code: 'notify_failed', status: 500 }],
    ]);
  });

  it('a failed notification before the last attempt does not alert', async () => {
    site.pages.set('/api/revalidate', { status: 500 });
    expect(await confirmSite(db, release, workerSite(), [], {}, MAX_NOTIFY_ATTEMPTS - 2)).toBe('notify_failed');
    expect(mocks.alert).not.toHaveBeenCalled();
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
      return { data: fn === 'worker_sites' ? sites : null, error: null };
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

  it('a retry confirms only the sites it names, each with its attempts so far; a site no longer active is skipped', async () => {
    sites = [workerSite('s1'), workerSite('s2')];
    site.pages.set('/api/revalidate/s2', { status: 500 });

    await confirmRelease(db, release, {}, new Map([['s2', 9], ['s3', 1]]));

    expect(site.requests.map((r) => r.path)).toEqual(['/api/revalidate/s2']);
    expect(recordedSites()).toEqual(['s2']);
    expect(mocks.alert).toHaveBeenCalledWith('delivery.retries_exhausted', expect.objectContaining({ siteId: 's2', attempts: 10 }));
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
