// The tenant overview's pure logic: the band, the waiting set, the pills, the counts and the times
// (spec §7.4: success is never shown before its proof exists).
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n/is';
import {
  deriveBand,
  entriesLine,
  entryPill,
  formatOverviewTime,
  needsPublishedCount,
  overviewTypes,
  parseChangesParam,
  summarizeStatus,
  usableSiteUrl,
  waitingHeading,
  waitingIds,
  type OverviewStatusRow,
  type Read,
} from '../overview';

const row = (overrides: Partial<OverviewStatusRow> = {}): OverviewStatusRow => ({
  entry_id: 'e1',
  action: 'publish',
  status: 'committed',
  requested_at: '2026-11-05T12:00:00+00:00',
  release_status: 'delivered',
  omitted: false,
  site_count: 1,
  sites_notified: 1,
  sites_live_ok: 1,
  sites_not_confirmed: 0,
  retries_exhausted: false,
  live_retrying: false,
  latest_action: 'publish',
  ...overrides,
});

const pending = (entry_id: string) => row({ entry_id, status: 'pending', release_status: null, sites_notified: 0, sites_live_ok: 0 });
const failed = (entry_id: string) => row({ entry_id, sites_live_ok: 0, retries_exhausted: true });
const notConfirmed = (entry_id: string) => row({ entry_id, sites_live_ok: 0, sites_not_confirmed: 1 });
const removed = (entry_id: string) => row({ entry_id, action: 'unpublish' });
const retrying = (entry_id: string) => row({ entry_id, sites_live_ok: 0, sites_not_confirmed: 1, live_retrying: true });
const noSite = (entry_id: string) => row({ entry_id, site_count: 0, sites_notified: 0, sites_live_ok: 0 });
/** A request that ended before any release: the view's row has no release and no delivery. */
const ended = (entry_id: string, overrides: Partial<OverviewStatusRow>) => row({ entry_id, release_status: null, sites_notified: 0, sites_live_ok: 0, ...overrides });
const invalid = `${t.publish.invalid} ${t.publish.invalidGeneric}`;

const ok = <T,>(value: T): Read<T> => ({ ok: true, value });
const bad: Read<never> = { ok: false, code: '42501' };
const capped: Read<never> = { ok: false, code: 'capped' };

const SITE = ok({ url: 'https://example.test/' });
const band = (
  input: Partial<{
    site: Read<{ url: string | null } | null>;
    changed: Read<string[]>;
    status: Read<OverviewStatusRow[]>;
    abandoned: string[];
    published: Read<number> | null;
    currentlyPublished: Read<number> | null;
  }> = {},
) => {
  const status = input.status ?? ok([]);
  return deriveBand({
    site: input.site ?? SITE,
    changed: input.changed ?? ok([]),
    status: status.ok ? ok(summarizeStatus(status.value, new Set(input.abandoned))) : status,
    published: input.published ?? null,
    currentlyPublished: input.currentlyPublished ?? null,
  });
};

const UP_TO_DATE = t.overview.upToDate;
/** Einar's words, verbatim (2026-11-06). */
const NOTHING_ON_SITE = 'Ekkert er á vefnum eins og er.';

describe('the waiting set', () => {
  it('is the union of the changed ids and the unproven rows, each entry once', () => {
    const summary = summarizeStatus([pending('a'), failed('b'), row({ entry_id: 'c' })]);
    expect(waitingIds(['a', 'd'], summary).sort()).toEqual(['a', 'b', 'd']);
  });

  it('puts the unproven entries first, then the changed ones in the order they were read', () => {
    const summary = summarizeStatus([pending('a'), failed('b')]);
    expect(waitingIds(['newest', 'a', 'older'], summary)).toEqual(['a', 'b', 'newest', 'older']);
  });

  it('leaves out proven, withdrawn, and no-site rows', () => {
    const summary = summarizeStatus([row({ entry_id: 'a' }), removed('b'), row({ entry_id: 'c', site_count: 0, sites_notified: 0, sites_live_ok: 0 })]);
    expect(waitingIds([], summary)).toEqual([]);
  });

  it('counts a live check still running, and one that was not confirmed, as unproven', () => {
    const summary = summarizeStatus([row({ entry_id: 'a', sites_live_ok: 0 }), notConfirmed('b')]);
    expect(waitingIds([], summary).sort()).toEqual(['a', 'b']);
    expect(summary.failed).toBe(true);
  });

  it('counts a request that ended in failure, of either action', () => {
    const summary = summarizeStatus([
      ended('a', { status: 'failed_validation' }),
      ended('b', { status: 'failed' }),
      ended('c', { status: 'rejected' }),
      ended('d', { action: 'unpublish', status: 'failed' }),
    ]);
    expect(waitingIds([], summary).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('leaves out a no-site row, and keeps the changed entries, however many are published', () => {
    const summary = summarizeStatus([noSite('a'), noSite('b'), noSite('c')]);
    expect(waitingIds(['b', 'd'], summary)).toEqual(['b', 'd']);
  });

  it('leaves out a publish cancelled by an unpublish: neutral, and nothing failed', () => {
    const summary = summarizeStatus([ended('a', { status: 'superseded', latest_action: 'unpublish' })]);
    expect(waitingIds([], summary)).toEqual([]);
    expect(summary.failed).toBe(false);
  });

  it('counts a superseded publish that no unpublish cancelled: the editor has to publish again', () => {
    const summary = summarizeStatus([ended('a', { status: 'superseded' })]);
    expect(waitingIds([], summary)).toEqual(['a']);
    expect(summary.failed).toBe(true);
  });
});

describe('the status summary', () => {
  it('takes the newest requested_at among proven rows only', () => {
    const summary = summarizeStatus([
      row({ entry_id: 'a', requested_at: '2026-11-01T10:00:00+00:00' }),
      row({ entry_id: 'b', requested_at: '2026-11-03T10:00:00+00:00' }),
      row({ entry_id: 'c', requested_at: '2026-11-02T10:00:00Z' }),
      pending('d'),
      removed('e'),
    ]);
    expect(summary.lastPublished).toBe('2026-11-03T10:00:00+00:00');
  });

  it('never treats a proven unpublish as proof of publishing', () => {
    const summary = summarizeStatus([removed('a')]);
    expect(summary.proven.size).toBe(0);
    expect(summary.lastPublished).toBeNull();
  });

  it.each([
    ['a request still on its way', pending('a'), false],
    ['a live check still running', row({ entry_id: 'a', sites_live_ok: 0 }), false],
    ['one of two sites not confirmed, the other still checking', row({ entry_id: 'a', site_count: 2, sites_notified: 2, sites_live_ok: 0, sites_not_confirmed: 1 }), true],
    ['a delivery not confirmed and checked again', retrying('a'), true],
    ['an unpublish not confirmed and checked again', { ...retrying('a'), action: 'unpublish' as const }, true],
    ['no site', noSite('a'), false],
  ])('sets failed rightly for %s', (_name, input, expected) => {
    expect(summarizeStatus([input]).failed).toBe(expected);
  });
});

describe('the band, in order', () => {
  describe('1. a failed, capped or missing read', () => {
    it.each([
      ['site failed', { site: bad }],
      ['changed failed', { changed: bad }],
      ['changed capped', { changed: capped }],
      ['status failed', { status: bad }],
      ['status capped', { status: capped }],
      ['published count failed', { published: bad }],
      ['currently-published count failed', { published: ok(2), currentlyPublished: bad }],
    ])('%s: "status unavailable", and nothing else that claims anything', (_name, input) => {
      const result = band({ ...input });
      expect(result.heading).toBe(t.publish.statusUnavailable);
      expect(result).toMatchObject({ tag: false, lastPublished: null, viewChanges: false });
    });

    it('wins even when the rest proves publication and n is above 0', () => {
      const result = band({ changed: bad, status: ok([row(), pending('b')]) });
      expect(result).toEqual({ heading: t.publish.statusUnavailable, tag: false, lastPublished: null, viewChanges: false, siteUrl: 'https://example.test/' });
    });

    it('keeps "Skoða vef" only when the site read succeeded with a usable URL', () => {
      expect(band({ status: bad }).siteUrl).toBe('https://example.test/');
      expect(band({ site: bad }).siteUrl).toBeNull();
      expect(band({ status: bad, site: ok({ url: null }) }).siteUrl).toBeNull();
    });

    it('wins over "no site" when another read failed', () => {
      expect(band({ site: ok(null), changed: bad }).heading).toBe(t.publish.statusUnavailable);
    });
  });

  describe('2. no active site', () => {
    it('says so, with no tag, no last published and no site link', () => {
      const result = band({ site: ok(null), status: ok([row()]) });
      expect(result).toEqual({ heading: t.publish.noSite, tag: false, lastPublished: null, viewChanges: false, siteUrl: null });
    });

    it('offers the changes when n > 0', () => {
      expect(band({ site: ok(null), changed: ok(['a']) })).toMatchObject({ heading: t.publish.noSite, viewChanges: true });
    });
  });

  describe('3. an active site', () => {
    it('n > 0 with proof: waiting heading, tag, last published, the changes link', () => {
      const result = band({ changed: ok(['a', 'b']), status: ok([row({ entry_id: 'c' })]) });
      expect(result).toEqual({
        heading: '2 breytingar bíða birtingar.',
        tag: true,
        lastPublished: '2026-11-05T12:00:00+00:00',
        viewChanges: true,
        siteUrl: 'https://example.test/',
      });
    });

    it('n = 0 with proof: "up to date", with the tag and no changes link', () => {
      const result = band({ status: ok([row()]) });
      expect(result).toMatchObject({ heading: UP_TO_DATE, tag: true, viewChanges: false });
    });

    it('takes the tag away when any row failed, and keeps last published', () => {
      const result = band({ status: ok([row({ entry_id: 'a' }), failed('b')]) });
      expect(result).toMatchObject({ heading: '1 breyting bíður birtingar.', tag: false, lastPublished: '2026-11-05T12:00:00+00:00', viewChanges: true });
    });

    it('takes the tag away for a delivery not confirmed, and counts it in n', () => {
      const result = band({ status: ok([row({ entry_id: 'x' }), retrying('y')]) });
      expect(result).toMatchObject({ heading: waitingHeading(1), tag: false, lastPublished: '2026-11-05T12:00:00+00:00', viewChanges: true });
    });

    it('keeps the tag while a request is simply on its way', () => {
      expect(band({ status: ok([row({ entry_id: 'x' }), pending('y')]) })).toMatchObject({ heading: waitingHeading(1), tag: true });
    });

    it.each([
      ['failed_validation', ended('y', { status: 'failed_validation' })],
      ['failed', ended('y', { status: 'failed' })],
      ['rejected', ended('y', { status: 'rejected' })],
      ['a failed unpublish', ended('y', { action: 'unpublish', status: 'failed' })],
    ])('a latest request that ended %s: waiting, no tag', (_name, failure) => {
      const result = band({ status: ok([row({ entry_id: 'x' }), failure]) });
      expect(result).toMatchObject({ heading: waitingHeading(1), tag: false, lastPublished: '2026-11-05T12:00:00+00:00', viewChanges: true });
    });

    it('takes the tag away for a failed first publish too', () => {
      const result = band({ status: ok([row({ entry_id: 'x' }), ended('new', { status: 'failed' })]) });
      expect(result).toMatchObject({ heading: waitingHeading(1), tag: false, viewChanges: true });
    });

    it('a publish cancelled by an unpublish leaves the proof alone', () => {
      const result = band({ status: ok([row({ entry_id: 'x' }), ended('y', { status: 'superseded', latest_action: 'unpublish' })]) });
      expect(result).toMatchObject({ heading: UP_TO_DATE, tag: true, viewChanges: false });
    });

    it('n > 0 with no proof: no tag and no last published', () => {
      expect(band({ status: ok([pending('a')]) })).toMatchObject({ heading: '1 breyting bíður birtingar.', tag: false, lastPublished: null, viewChanges: true });
    });

    it('n = 0, nothing proven, nothing ever published: says so', () => {
      const result = band({ published: ok(0), currentlyPublished: ok(0) });
      expect(result).toMatchObject({ heading: t.overview.nothingPublished, tag: false, lastPublished: null, viewChanges: false });
    });

    it('n = 0, nothing proven, published once and none published now: nothing is on the site', () => {
      expect(band({ published: ok(3), currentlyPublished: ok(0) })).toEqual({
        heading: NOTHING_ON_SITE,
        tag: false,
        lastPublished: null,
        viewChanges: false,
        siteUrl: 'https://example.test/',
      });
    });

    it('says the same when the withdrawals are the rows it has, each confirmed', () => {
      const result = band({ status: ok([removed('a'), removed('b')]), published: ok(2), currentlyPublished: ok(0) });
      expect(result).toMatchObject({ heading: NOTHING_ON_SITE, tag: false, lastPublished: null, viewChanges: false });
    });

    it('n = 0, nothing proven, something published now: never reassures', () => {
      const result = band({ published: ok(3), currentlyPublished: ok(1) });
      expect(result).toMatchObject({ heading: t.publish.statusUnavailable, tag: false, lastPublished: null, viewChanges: false });
    });

    it.each([
      ['the published count failed', { published: bad, currentlyPublished: ok(0) }],
      ['the published count was not read', { published: null, currentlyPublished: ok(0) }],
      ['the currently-published count failed', { published: ok(3), currentlyPublished: bad }],
      ['the currently-published count was not read', { published: ok(3), currentlyPublished: null }],
      ['neither count was read', { published: null, currentlyPublished: null }],
      ['nothing was ever published, and the currently-published count failed', { published: ok(0), currentlyPublished: bad }],
      ['nothing was ever published, and the currently-published count was not read', { published: ok(0), currentlyPublished: null }],
      ['the counts contradict each other', { published: ok(0), currentlyPublished: ok(1) }],
    ])('fails closed when %s', (_name, counts) => {
      const result = band(counts);
      expect(result).toMatchObject({ heading: t.publish.statusUnavailable, tag: false, lastPublished: null, viewChanges: false });
    });

    it('keeps the site link with the new heading, only when the URL is usable', () => {
      const counts = { published: ok(3), currentlyPublished: ok(0) };
      expect(band({ ...counts, site: ok({ url: null }) })).toMatchObject({ heading: NOTHING_ON_SITE, siteUrl: null });
    });

    it('hides "Skoða vef" for an unusable URL, and the site still counts', () => {
      const result = band({ site: ok({ url: null }), status: ok([row()]) });
      expect(result).toMatchObject({ heading: UP_TO_DATE, siteUrl: null, tag: true });
    });
  });

  describe('"nothing on the site" is impossible', () => {
    const counts = { published: ok(3), currentlyPublished: ok(0) };
    it.each([
      ['while an entry is published', { ...counts, currentlyPublished: ok(1) }],
      ['while a change waits', { ...counts, changed: ok(['a']) }],
      ['with proof of a publication', { ...counts, status: ok([row()]) }],
      ['while a publish is on its way', { ...counts, status: ok([pending('a')]) }],
      ['with a failed row', { ...counts, status: ok([failed('a')]) }],
      ['with a withdrawal on its way', { ...counts, status: ok([{ ...pending('a'), action: 'unpublish' as const }]) }],
      ['with a withdrawal being checked again', { ...counts, status: ok([{ ...retrying('a'), action: 'unpublish' as const }]) }],
      ['with a withdrawal not confirmed', { ...counts, status: ok([{ ...notConfirmed('a'), action: 'unpublish' as const }]) }],
      ['with a failed withdrawal', { ...counts, status: ok([ended('a', { action: 'unpublish', status: 'failed' })]) }],
      ['with no site', { ...counts, site: ok(null) }],
      ['when the site read failed', { ...counts, site: bad }],
      ['when the changed read failed', { ...counts, changed: bad }],
      ['when the changed read was capped', { ...counts, changed: capped }],
      ['when the status read failed', { ...counts, status: bad }],
      ['when the status read was capped', { ...counts, status: capped }],
      ['when the published count failed', { ...counts, published: bad }],
      ['when the published count is missing', { ...counts, published: null }],
      ['when the currently-published count failed', { ...counts, currentlyPublished: bad }],
      ['when the currently-published count is missing', { ...counts, currentlyPublished: null }],
    ])('%s', (_name, input) => {
      expect(band(input).heading).not.toBe(NOTHING_ON_SITE);
    });

    it.each([
      ['on its way', { ...pending('a'), action: 'unpublish' as const }],
      ['checked again', { ...retrying('a'), action: 'unpublish' as const }],
      ['not confirmed', { ...notConfirmed('a'), action: 'unpublish' as const }],
    ])('an unconfirmed withdrawal, %s, is in n and never reaches the counts', (_name, withdrawal) => {
      expect(band({ status: ok([withdrawal]) }).heading).toBe(waitingHeading(1));
      expect(needsPublishedCount({ site: SITE, changed: ok([]), status: ok(summarizeStatus([withdrawal])) })).toBe(false);
    });
  });

  describe('"up to date" is impossible', () => {
    const proof = ok([row()]);
    it.each([
      ['while a change waits', { changed: ok(['a']), status: proof }],
      ['while a request is unproven', { status: ok([row(), pending('b')]) }],
      ['with a failed row', { status: ok([row(), failed('b')]) }],
      ['with no site', { site: ok(null), status: proof }],
      ['when the site read failed', { site: bad, status: proof }],
      ['when the changed read failed', { changed: bad, status: proof }],
      ['when the changed read was capped', { changed: capped, status: proof }],
      ['when the status read failed', { status: bad, published: ok(0) }],
      ['when the status read was capped', { status: capped, published: ok(0) }],
    ])('%s', (_name, input) => {
      expect(band(input).heading).not.toBe(UP_TO_DATE);
    });

    // Every way an entry's latest row can be an error, as the read returns it, beside every way the
    // other rows can stand. Nothing else waits, so only that row can hold the words back.
    const X = row({ entry_id: 'x' });
    describe.each([
      ['one proven entry', [X]],
      ['proven entries and a withdrawn one', [X, row({ entry_id: 'x2' }), removed('w')]],
      ['a proven entry and a cancelled publish', [X, ended('c', { status: 'superseded', latest_action: 'unpublish' })]],
    ])('beside %s', (_name, others) => {
      it.each([
        ['failed_validation', ended('y', { status: 'failed_validation' })],
        ['failed', ended('y', { status: 'failed' })],
        ['rejected', ended('y', { status: 'rejected' })],
        ['superseded', ended('y', { status: 'superseded' })],
        ['a failed unpublish', ended('y', { action: 'unpublish', status: 'failed' })],
        ['a rejected unpublish', ended('y', { action: 'unpublish', status: 'rejected' })],
        ['a publish retried at the same version, failed after a failed delivery', ended('y', { status: 'failed_validation', requested_at: '2026-11-05T13:00:00+00:00' })],
        ['left out of its release', row({ entry_id: 'y', omitted: true, sites_notified: 0, sites_live_ok: 0 })],
        ['retries exhausted', failed('y')],
        ['a build that kept failing', row({ entry_id: 'y', release_status: 'failed', sites_notified: 0, sites_live_ok: 0, retries_exhausted: true })],
        ['not confirmed, no retry left', notConfirmed('y')],
        ['an unpublish not confirmed', { ...notConfirmed('y'), action: 'unpublish' as const }],
      ])('with a latest row: %s', (_state, failure) => {
        const summary = summarizeStatus([...others, failure]);
        expect(summary.unproven.get('y')?.tone).toBe('error');
        expect(band({ status: ok([...others, failure]) })).toMatchObject({ heading: waitingHeading(1), tag: false, viewChanges: true });
      });
    });
  });
});

describe('an entry archived before it was ever published', () => {
  const proof = row({ entry_id: 'x' });

  describe.each([
    ['failed_validation', ended('gone', { status: 'failed_validation' })],
    ['failed', ended('gone', { status: 'failed' })],
    ['rejected', ended('gone', { status: 'rejected' })],
    ['superseded', ended('gone', { status: 'superseded' })],
  ])('with a latest request that ended %s', (_status, abandoned) => {
    it('adds nothing to n, sets no failure, and is no state of the entry', () => {
      const summary = summarizeStatus([proof, abandoned], new Set(['gone']));
      expect(waitingIds([], summary)).toEqual([]);
      expect(summary.failed).toBe(false);
      expect(summary.unproven.has('gone')).toBe(false);
      expect(summary.proven).toEqual(new Set(['x']));
    });

    it('leaves "Vefurinn þinn er uppfærður." and the tag reachable', () => {
      const result = band({ status: ok([proof, abandoned]), abandoned: ['gone'] });
      expect(result).toMatchObject({ heading: UP_TO_DATE, tag: true, lastPublished: proof.requested_at, viewChanges: false });
    });

    it('does not hold back "nothing published" either', () => {
      const result = band({ status: ok([abandoned]), abandoned: ['gone'], published: ok(0), currentlyPublished: ok(0) });
      expect(result).toMatchObject({ heading: t.overview.nothingPublished, tag: false, viewChanges: false });
    });
  });

  // A sibling that is dropped, so each of these shows that the rule picks rows, not entries or tenants.
  const dropped = ended('dropped', { status: 'failed' });

  it.each([
    ['pending', pending('gone'), true],
    ['validating', ended('gone', { status: 'validating' }), true],
    ['committed, a live check still running', row({ entry_id: 'gone', sites_live_ok: 0 }), true],
    ['committed, its retries exhausted', failed('gone'), false],
  ])('keeps counting a request that is %s', (_status, abandoned, tag) => {
    const rows = [proof, dropped, abandoned];
    const result = band({ status: ok(rows), abandoned: ['dropped', 'gone'] });
    expect(result).toMatchObject({ heading: waitingHeading(1), tag, viewChanges: true });
    expect(waitingIds([], summarizeStatus(rows, new Set(['dropped', 'gone'])))).toEqual(['gone']);
  });

  it('keeps counting a committed request that was proven', () => {
    const summary = summarizeStatus([dropped, row({ entry_id: 'gone' })], new Set(['dropped', 'gone']));
    expect(summary.proven).toEqual(new Set(['gone']));
    expect(summary.unproven.has('dropped')).toBe(false);
  });

  it('fails closed on a status it does not know: only the four listed are ignored', () => {
    const unknown = ended('gone', { status: 'new_status' as OverviewStatusRow['status'] });
    const summary = summarizeStatus([dropped, unknown], new Set(['dropped', 'gone']));
    expect(waitingIds([], summary)).toEqual(['gone']);
    expect(summary.failed).toBe(true);
  });

  it.each([
    ['failed', ended('once', { status: 'failed' })],
    ['failed_validation', ended('once', { status: 'failed_validation' })],
    ['rejected', ended('once', { status: 'rejected' })],
    ['superseded', ended('once', { status: 'superseded' })],
    ['a failed unpublish', ended('once', { action: 'unpublish', status: 'failed' })],
  ])('an archived entry that was published once keeps counting: %s', (_status, latest) => {
    const result = band({ status: ok([proof, dropped, latest]), abandoned: ['dropped'] });
    expect(result).toMatchObject({ heading: waitingHeading(1), tag: false, viewChanges: true });
  });
});

describe('needsPublishedCount (read 7)', () => {
  const needs = (input: { site?: Read<{ url: string | null } | null>; changed?: Read<string[]>; status?: Read<OverviewStatusRow[]> }) => {
    const status = input.status ?? ok([]);
    return needsPublishedCount({ site: input.site ?? SITE, changed: input.changed ?? ok([]), status: status.ok ? ok(summarizeStatus(status.value)) : status });
  };

  it('runs only at "nothing proven, n = 0" with an active site', () => {
    expect(needs({})).toBe(true);
    expect(needs({ status: ok([row()]) })).toBe(false);
    expect(needs({ changed: ok(['a']) })).toBe(false);
    expect(needs({ status: ok([pending('a')]) })).toBe(false);
    expect(needs({ site: ok(null) })).toBe(false);
    expect(needs({ site: bad })).toBe(false);
    expect(needs({ changed: bad })).toBe(false);
    expect(needs({ status: capped })).toBe(false);
  });
});

describe('the singular rule', () => {
  it.each([
    [0, '0 breytingar bíða birtingar.', '0 færslur'],
    [1, '1 breyting bíður birtingar.', '1 færsla'],
    [2, '2 breytingar bíða birtingar.', '2 færslur'],
    [11, '11 breytingar bíða birtingar.', '11 færslur'],
    [21, '21 breyting bíður birtingar.', '21 færsla'],
    [101, '101 breyting bíður birtingar.', '101 færsla'],
    [111, '111 breytingar bíða birtingar.', '111 færslur'],
  ])('%i', (n, heading, line) => {
    expect(waitingHeading(n)).toBe(heading);
    expect(entriesLine(n, 0)).toBe(line);
  });

  it('adds the drafts only when there are any', () => {
    expect(entriesLine(24, 1)).toBe('24 færslur, 1 uppkast');
    expect(entriesLine(38, 0)).toBe('38 færslur');
    expect(entriesLine(21, 3)).toBe('21 færsla, 3 uppkast');
  });
});

describe('the pills', () => {
  const summary = ok(summarizeStatus([row({ entry_id: 'live' }), pending('going'), failed('broken')]));

  it('shows an unproven state as that state, never green "Birt"', () => {
    expect(entryPill({ id: 'going', status: 'published' }, summary)).toEqual({ label: t.publish.inProgress, tone: 'pending' });
    expect(entryPill({ id: 'broken', status: 'published' }, summary)).toEqual({ label: t.publish.deliveryFailed, tone: 'error' });
  });

  it("uses the entry list's words and tones otherwise", () => {
    expect(entryPill({ id: 'live', status: 'published' }, summary)).toEqual({ label: t.entries.statuses.published, tone: 'ok' });
    expect(entryPill({ id: 'x', status: 'changed' }, summary)).toEqual({ label: t.entries.statuses.changed, tone: 'warning' });
    expect(entryPill({ id: 'x', status: 'draft' }, summary)).toEqual({ label: t.entries.statuses.draft, tone: 'neutral' });
  });

  it.each([
    ['failed', bad],
    ['capped', capped],
  ])('makes a published entry neutral when the status read %s: nothing proves it', (_name, status) => {
    expect(entryPill({ id: 'live', status: 'published' }, status)).toEqual({ label: t.entries.statuses.published, tone: 'neutral' });
    expect(entryPill({ id: 'x', status: 'changed' }, status)).toEqual({ label: t.entries.statuses.changed, tone: 'warning' });
  });

  it('gives "ok" only with proof: a published entry with no proven row is neutral', () => {
    expect(entryPill({ id: 'no-row', status: 'published' }, summary)).toEqual({ label: t.entries.statuses.published, tone: 'neutral' });
  });

  it.each([
    ['failed validation', ended('y', { status: 'failed_validation' }), invalid],
    ['failed', ended('y', { status: 'failed' }), t.publish.failed],
    ['rejected', ended('y', { status: 'rejected' }), t.publish.rejected],
    ['an unpublish that failed', ended('y', { action: 'unpublish', status: 'failed' }), t.publish.failed],
  ])('shows a published entry whose latest request %s as that failure, never green', (_name, failure, label) => {
    const status = ok(summarizeStatus([row({ entry_id: 'x' }), failure]));
    expect(entryPill({ id: 'y', status: 'published' }, status)).toEqual({ label, tone: 'error' });
  });

  it('shows a delivery not confirmed as being retried', () => {
    const status = ok(summarizeStatus([row({ entry_id: 'x' }), retrying('y')]));
    expect(entryPill({ id: 'y', status: 'published' }, status)).toEqual({ label: t.publish.notConfirmedRetrying, tone: 'pending' });
  });

  it('says so when there is no site, with the warning tone, never "Birt"', () => {
    const status = ok(summarizeStatus([noSite('a')]));
    expect(entryPill({ id: 'a', status: 'published' }, status)).toEqual({ label: t.publish.noSite, tone: 'warning' });
  });

  it('shows a cancelled publish as the entry itself: neutral "Birt" with nothing proving it', () => {
    const status = ok(summarizeStatus([ended('a', { status: 'superseded', latest_action: 'unpublish' })]));
    expect(entryPill({ id: 'a', status: 'published' }, status)).toEqual({ label: t.entries.statuses.published, tone: 'neutral' });
  });
});

describe('the site URL', () => {
  it.each([
    ['https://example.test', 'https://example.test'],
    ['http://localhost:3101', 'http://localhost:3101'],
  ])('keeps %s', (url, expected) => {
    expect(usableSiteUrl(url)).toBe(expected);
  });

  it.each(['javascript:alert(1)', 'ftp://example.test', 'not a url', '', '/relative'])('drops %j', (url) => {
    expect(usableSiteUrl(url)).toBeNull();
  });
});

describe('the breytingar param', () => {
  it('counts only the exact value 1', () => {
    expect(parseChangesParam('1')).toBe(true);
  });

  it.each([[undefined], [''], ['0'], ['01'], ['1 '], ['true'], [['1']], [['1', '1']], [[]]])('ignores %j', (value) => {
    expect(parseChangesParam(value)).toBe(false);
  });
});

describe('overviewTypes', () => {
  it('splits the structure into list types and singletons, in order, through groups', () => {
    const { list, singletons } = overviewTypes([
      { type: 'settings', label: 'Stillingar', singleton: true },
      { group: 'Efni', items: [{ type: 'news', label: 'Fréttir' }, { type: 'about', label: 'Um okkur', singleton: true }] },
      { type: 'staff', label: 'Starfsfólk' },
    ]);
    expect(list.map((item) => item.type)).toEqual(['news', 'staff']);
    expect(singletons.map((item) => item.type)).toEqual(['settings', 'about']);
  });
});

describe('the times, in Reykjavík', () => {
  const now = new Date('2026-11-05T15:00:00Z');

  it('says "í dag" and "í gær" with the time', () => {
    expect(formatOverviewTime('2026-11-05T14:32:00Z', now)).toBe('í dag, 14:32');
    expect(formatOverviewTime('2026-11-04T16:20:00Z', now)).toBe('í gær, 16:20');
  });

  it('gives the date otherwise', () => {
    expect(formatOverviewTime('2026-11-02T13:12:00Z', now)).toBe('2. nóv., 13:12');
    expect(formatOverviewTime('2026-11-03T23:59:00Z', now)).toBe('3. nóv., 23:59');
  });

  it('turns over at midnight', () => {
    const justAfter = new Date('2026-11-05T00:00:30Z');
    expect(formatOverviewTime('2026-11-04T23:59:30Z', justAfter)).toBe('í gær, 23:59');
    expect(formatOverviewTime('2026-11-05T00:00:10Z', justAfter)).toBe('í dag, 00:00');
    const justBefore = new Date('2026-11-04T23:59:59Z');
    expect(formatOverviewTime('2026-11-04T00:00:00Z', justBefore)).toBe('í dag, 00:00');
    expect(formatOverviewTime('2026-11-03T23:59:59Z', justBefore)).toBe('í gær, 23:59');
  });

  it('compares days in Reykjavík, not in the offset of the timestamp', () => {
    expect(formatOverviewTime('2026-11-05T01:30:00+02:00', now)).toBe('í gær, 23:30');
  });

  it('crosses a month and a year', () => {
    expect(formatOverviewTime('2026-11-30T12:00:00Z', new Date('2026-12-01T09:00:00Z'))).toBe('í gær, 12:00');
    expect(formatOverviewTime('2026-12-31T22:15:00Z', new Date('2027-01-01T00:05:00Z'))).toBe('í gær, 22:15');
    expect(formatOverviewTime('2026-12-30T22:15:00Z', new Date('2027-01-01T00:05:00Z'))).toBe('30. des. 2026, 22:15');
    expect(formatOverviewTime('2025-11-02T13:12:00Z', now)).toBe('2. nóv. 2025, 13:12');
  });
});
