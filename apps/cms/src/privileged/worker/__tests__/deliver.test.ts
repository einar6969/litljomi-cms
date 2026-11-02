// Which entries a delivered release live-checks, and how (plan Task 21, decision 35; spec §7.1, §7.4).
import { describe, expect, it } from 'vitest';
import type { ModuleManifest, SiteEntry } from '@litljomi/cms-schema';
import type { Bundle, BundleEntry } from '@litljomi/cms-sdk';
import { liveTargets, releaseView } from '../deliver';

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
