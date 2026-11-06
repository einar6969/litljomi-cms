// The overview's reads, against a fake client that records every query: all of them under the
// editor's session and scoped to the tenant, none selecting a column it does not use, each failing
// on its own into a result the page can show.
import type { StructureNode } from '@litljomi/cms-schema';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n/is';
import type { SupabaseClient } from '@/lib/supabase/types';
import { entryPill, waitingHeading } from '../../overview';
import { loadTenantOverview, OVERVIEW_STATUS_COLUMNS } from '../tenant-overview';

type Answer = { data?: unknown; error?: { code: string; message?: string } | null; count?: number | null };
type Call = {
  table: string;
  columns: string;
  options: { count?: string; head?: boolean } | undefined;
  eq: Record<string, unknown>;
  is: Record<string, unknown>;
  not: unknown[][];
  in: Record<string, unknown[]>;
  order: unknown[][];
  limit: number | undefined;
};

/** A PostgREST client whose answers come from `answer`; it records each query. */
function fakeClient(answer: (call: Call) => Answer | Promise<Answer>) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, columns: '', options: undefined, eq: {}, is: {}, not: [], in: {}, order: [], limit: undefined };
    calls.push(call);
    const builder = {
      select(columns: string, options?: Call['options']) {
        call.columns = columns;
        call.options = options;
        return builder;
      },
      eq(column: string, value: unknown) {
        call.eq[column] = value;
        return builder;
      },
      is(column: string, value: unknown) {
        call.is[column] = value;
        return builder;
      },
      not(...args: unknown[]) {
        call.not.push(args);
        return builder;
      },
      in(column: string, values: unknown[]) {
        call.in[column] = values;
        return builder;
      },
      order(...args: unknown[]) {
        call.order.push(args);
        return builder;
      },
      limit(n: number) {
        call.limit = n;
        return builder;
      },
      then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
        return Promise.resolve()
          .then(() => answer(call))
          .then((a) => ({ data: a.data ?? null, error: a.error ?? null, count: a.count ?? null }))
          .then(resolve, reject);
      },
    };
    return builder;
  };
  return { client: { from } as unknown as SupabaseClient, calls };
}

const TENANT = '00000000-0000-4000-8000-0000000000f1';
const STRUCTURE: StructureNode[] = [
  { group: 'Efni', items: [{ type: 'news', label: 'Fréttir' }] },
  { type: 'event', label: 'Viðburðir' },
  { type: 'about', label: 'Um okkur', singleton: true },
];
const ENTRY = { id: 'e1', type: 'news', title: 'Frétt', status: 'published', updated_at: '2026-11-05T12:00:00+00:00' };
const LIVE = {
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
};
const UNPROVEN = { ...LIVE, entry_id: 'e2', status: 'pending', release_status: null, sites_notified: 0, sites_live_ok: 0 };
/** Entry e2's latest request ended before any release, in `status`. */
const ENDED = (status: string, action = 'publish') => ({ ...UNPROVEN, status, action, latest_action: action });

const isSite = (c: Call) => c.table === 'tenant_sites';
const isStatus = (c: Call) => c.table === 'publication_status';
const isChanged = (c: Call) => c.table === 'entry_list' && c.eq.status === 'changed';
const isCount = (c: Call) => c.table === 'entry_list' && c.options?.head === true && c.eq.type !== undefined;
const isDraftCount = (c: Call) => isCount(c) && c.eq.status === 'draft';
const isPublishedCount = (c: Call) => c.table === 'entry_list' && c.options?.head === true && c.eq.type === undefined && c.in.status === undefined;
const isCurrentlyPublished = (c: Call) => c.table === 'entry_list' && c.options?.head === true && c.in.status !== undefined;
const isAbandoned = (c: Call) => c.table === 'entry_list' && c.not.some(([column]) => column === 'archived_at');
const isSingletons = (c: Call) => c.table === 'entry_list' && !c.options && c.in.type !== undefined && c.limit === undefined;
const isRecent = (c: Call) => c.table === 'entry_list' && !c.options && c.in.type !== undefined && c.limit === 5;
const isById = (c: Call) => c.table === 'entry_list' && c.in.id !== undefined;

/** A healthy tenant: an active site, one proven entry, nothing waiting. */
const healthy = (c: Call): Answer => {
  if (isSite(c)) return { data: [{ base_url: 'https://example.test' }] };
  if (isStatus(c)) return { data: [LIVE], count: 1 };
  if (isChanged(c)) return { data: [], count: 0 };
  if (isDraftCount(c)) return { count: 1 };
  if (isCount(c)) return { count: 24 };
  if (isPublishedCount(c) || isCurrentlyPublished(c)) return { count: 0 };
  if (isAbandoned(c)) return { data: [], count: 0 };
  if (isSingletons(c)) return { data: [{ ...ENTRY, id: 's1', type: 'about' }] };
  if (isById(c) || isRecent(c)) return { data: [ENTRY] };
  throw new Error(`unexpected query on ${c.table}`);
};

const withAnswers = (override: (c: Call) => Answer | undefined) => fakeClient((c) => override(c) ?? healthy(c));
const load = (client: SupabaseClient, options: { showWaiting?: boolean; structure?: StructureNode[] } = {}) =>
  loadTenantOverview(client, { tenantId: TENANT, structure: options.structure ?? STRUCTURE, showWaiting: options.showWaiting ?? false });

const DENIED: Answer = { error: { code: '42501', message: 'secret database detail' } };

describe('the reads', () => {
  it('scope every read by tenant_id', async () => {
    const { client, calls } = fakeClient(healthy);
    await load(client);
    expect(calls.length).toBeGreaterThanOrEqual(9);
    for (const call of calls) expect(call.eq.tenant_id, call.table).toBe(TENANT);
  });

  it('never select slug, data or more than they use', async () => {
    const { client, calls } = fakeClient((c) => (isChanged(c) ? { data: [{ id: 'e9' }], count: 1 } : healthy(c)));
    await load(client, { showWaiting: true });
    for (const call of calls) {
      const columns = call.columns.split(',').map((c) => c.trim());
      expect(columns, call.table).not.toContain('slug');
      expect(columns, call.table).not.toContain('data');
      expect(columns, call.table).not.toContain('*');
    }
  });

  it('read only the status columns the overview uses', async () => {
    const { client, calls } = fakeClient(healthy);
    await load(client);
    const status = calls.find(isStatus)!;
    expect(status.columns).toBe(OVERVIEW_STATUS_COLUMNS);
    expect(status.columns).toBe(
      'entry_id, action, status, requested_at, release_status, omitted, site_count, sites_notified, sites_live_ok, sites_not_confirmed, retries_exhausted, live_retrying, latest_action',
    );
    expect(status.columns.split(', ')).not.toContain('error');
    expect(status.columns.split(', ')).not.toContain('missing_assets');
    expect(status.limit).toBe(1000);
    expect(status.options).toEqual({ count: 'exact' });
  });

  it('read every status row of the tenant: the tenant is the only filter', async () => {
    const { client, calls } = fakeClient(healthy);
    await load(client);
    expect(calls.find(isStatus)).toMatchObject({ eq: { tenant_id: TENANT }, in: {}, is: {}, not: [] });
    expect(Object.keys(calls.find(isStatus)!.eq)).toEqual(['tenant_id']);
  });

  it('read the first active site by URL', async () => {
    const { client, calls } = fakeClient(healthy);
    await load(client);
    const site = calls.find(isSite)!;
    expect(site).toMatchObject({ columns: 'base_url', eq: { tenant_id: TENANT, active: true }, limit: 1, order: [['base_url']] });
  });

  it('count each list type, total and never-published drafts, and no singleton', async () => {
    const { client, calls } = fakeClient(healthy);
    const overview = await load(client);
    const counts = calls.filter(isCount);
    expect(counts.map((c) => c.eq.type).sort()).toEqual(['event', 'event', 'news', 'news']);
    for (const call of counts) {
      expect(call).toMatchObject({ columns: 'id', options: { count: 'exact', head: true }, is: { archived_at: null } });
    }
    for (const call of counts.filter(isDraftCount)) expect(call.is).toEqual({ archived_at: null, first_published_at: null });
    expect([...overview.counts.entries()]).toEqual([
      ['news', { total: 24, drafts: 1 }],
      ['event', { total: 24, drafts: 1 }],
    ]);
  });

  it('read the five latest of the known types, not archived', async () => {
    const { client, calls } = fakeClient(healthy);
    await load(client);
    const recent = calls.find(isRecent)!;
    expect(recent).toMatchObject({ columns: 'id, type, title, status, updated_at', is: { archived_at: null } });
    expect(recent.in.type).toEqual(['news', 'event', 'about']);
    expect(recent.order).toEqual([['updated_at', { ascending: false }]]);
  });

  it('read the singletons only when there are singleton types', async () => {
    const withSingletons = fakeClient(healthy);
    const overview = await load(withSingletons.client);
    expect(withSingletons.calls.find(isSingletons)).toMatchObject({ in: { type: ['about'] }, is: { archived_at: null } });
    expect(overview.pages).toEqual([{ type: 'about', label: 'Um okkur', entry: { ...ENTRY, id: 's1', type: 'about' } }]);

    const without = fakeClient(healthy);
    expect((await load(without.client, { structure: [{ type: 'news', label: 'Fréttir' }] })).pages).toEqual([]);
    expect(without.calls.some(isSingletons)).toBe(false);
  });

  it('shows a singleton with no row yet without an entry', async () => {
    const { client } = withAnswers((c) => (isSingletons(c) ? { data: [] } : undefined));
    expect((await load(client)).pages).toEqual([{ type: 'about', label: 'Um okkur', entry: null }]);
  });

  it('read the changed ids with an exact count', async () => {
    const { client, calls } = fakeClient(healthy);
    await load(client);
    expect(calls.find(isChanged)).toMatchObject({ columns: 'id', options: { count: 'exact' }, limit: 1000, order: [['updated_at', { ascending: false }]] });
  });

  it('read the archived entries that were never published, each time, with an exact count', async () => {
    const { client, calls } = fakeClient(healthy);
    await load(client);
    const abandoned = calls.filter(isAbandoned);
    expect(abandoned).toHaveLength(1);
    expect(abandoned[0]).toMatchObject({ columns: 'id', options: { count: 'exact' }, limit: 1000, is: { first_published_at: null }, in: {} });
    expect(abandoned[0]!.not).toEqual([['archived_at', 'is', null]]);
    expect(Object.keys(abandoned[0]!.eq)).toEqual(['tenant_id']);
    expect(abandoned[0]!.eq.tenant_id).toBe(TENANT);
    expect(Object.keys(abandoned[0]!.is)).toEqual(['first_published_at']);
  });

  it('do not read the published counts unless the band needs them', async () => {
    const { client, calls } = fakeClient(healthy);
    await load(client);
    expect(calls.some(isPublishedCount)).toBe(false);
    expect(calls.some(isCurrentlyPublished)).toBe(false);
  });

  it.each([
    ['a change waits', (c: Call) => (isStatus(c) ? { data: [], count: 0 } : isChanged(c) ? { data: [{ id: 'a' }], count: 1 } : undefined)],
    ['a request waits', (c: Call) => (isStatus(c) ? { data: [UNPROVEN], count: 1 } : undefined)],
    ['there is no site', (c: Call) => (isStatus(c) ? { data: [], count: 0 } : isSite(c) ? { data: [] } : undefined)],
    ['a read failed', (c: Call) => (isStatus(c) ? { data: [], count: 0 } : isChanged(c) ? DENIED : undefined)],
    ['the status read failed', (c: Call) => (isStatus(c) ? DENIED : undefined)],
    ['the archived read failed', (c: Call) => (isStatus(c) ? { data: [], count: 0 } : isAbandoned(c) ? DENIED : undefined)],
  ])('do not read either count when %s', async (_name, override) => {
    const { client, calls } = withAnswers(override);
    await load(client);
    expect(calls.some(isPublishedCount)).toBe(false);
    expect(calls.some(isCurrentlyPublished)).toBe(false);
  });

  it('read the published count at "nothing proven, n = 0"', async () => {
    const { client, calls } = withAnswers((c) => (isStatus(c) ? { data: [], count: 0 } : undefined));
    const overview = await load(client);
    expect(calls.find(isPublishedCount)).toMatchObject({ columns: 'id', options: { count: 'exact', head: true }, is: { archived_at: null } });
    expect(calls.find(isPublishedCount)!.not).toEqual([['first_published_at', 'is', null]]);
    expect(overview.band.heading).toBe(t.overview.nothingPublished);
  });

  it('read the currently-published count there too: head only, by tenant, the two published statuses', async () => {
    const { client, calls } = withAnswers((c) => (isStatus(c) ? { data: [], count: 0 } : undefined));
    await load(client);
    const current = calls.filter(isCurrentlyPublished);
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({ columns: 'id', options: { count: 'exact', head: true }, in: { status: ['published', 'changed'] }, is: {}, not: [] });
    expect(Object.keys(current[0]!.eq)).toEqual(['tenant_id']);
    expect(current[0]!.eq.tenant_id).toBe(TENANT);
  });

  it('skip the type reads for a tenant with no structure, and still read the band', async () => {
    const { client, calls } = fakeClient(healthy);
    const overview = await load(client, { structure: [] });
    expect(calls.some((c) => c.in.type !== undefined || c.eq.type !== undefined)).toBe(false);
    expect(overview.recent).toEqual({ ok: true, value: [] });
    expect(overview.band.heading).toBe(t.overview.upToDate);
  });

  it('prove the band from the rows: "up to date" with the site link', async () => {
    const { client } = fakeClient(healthy);
    expect((await load(client)).band).toEqual({
      heading: t.overview.upToDate,
      tag: true,
      lastPublished: LIVE.requested_at,
      viewChanges: false,
      siteUrl: 'https://example.test',
    });
  });

  it('count the site but hide the link for an unusable URL', async () => {
    const { client } = withAnswers((c) => (isSite(c) ? { data: [{ base_url: 'javascript:alert(1)' }] } : undefined));
    expect((await load(client)).band).toMatchObject({ heading: t.overview.upToDate, siteUrl: null });
  });

  it('reads no active site as "no site"', async () => {
    const { client } = withAnswers((c) => (isSite(c) ? { data: [] } : undefined));
    expect((await load(client)).band.heading).toBe(t.publish.noSite);
  });
});

describe("an entry's latest request, as the view picks it", () => {
  /** The view: the latest request of each entry is picked first, and a filter can only take rows away. */
  const view = (found: Record<string, unknown>[]) => (c: Call) => {
    if (!isStatus(c)) return undefined;
    const allowed = c.in.status;
    const data = allowed ? found.filter((row) => allowed.includes(row.status)) : found;
    return { data, count: data.length };
  };

  it.each([
    ['failed_validation', ENDED('failed_validation'), `${t.publish.invalid} ${t.publish.invalidGeneric}`],
    ['failed', ENDED('failed'), t.publish.failed],
    ['rejected', ENDED('rejected'), t.publish.rejected],
    ['a failed unpublish', ENDED('failed', 'unpublish'), t.publish.failed],
    ['a rejected unpublish', ENDED('rejected', 'unpublish'), t.publish.rejected],
  ])('%s: the entry waits, the tag goes, and its pill says what happened', async (_name, failure, label) => {
    const { client } = withAnswers(view([LIVE, failure]));
    const overview = await load(client);
    expect(overview.band).toMatchObject({ heading: waitingHeading(1), tag: false, viewChanges: true });
    expect(entryPill({ id: 'e2', status: 'published' }, overview.status)).toEqual({ label, tone: 'error' });
  });

  it('lists a failed entry among the waiting ones', async () => {
    const { client, calls } = withAnswers(view([LIVE, ENDED('failed_validation')]));
    await load(client, { showWaiting: true });
    expect(calls.find(isById)!.in.id).toEqual(['e2']);
  });

  it('takes the tag away for a delivery not confirmed, which stays in n', async () => {
    const retrying = { ...LIVE, entry_id: 'e2', sites_live_ok: 0, sites_not_confirmed: 1, live_retrying: true };
    const { client } = withAnswers(view([LIVE, retrying]));
    expect((await load(client)).band).toMatchObject({ heading: waitingHeading(1), tag: false, viewChanges: true });
  });

  it('with no site, shows that on every published entry and counts only the changed ones', async () => {
    const published = ['e1', 'e2', 'e3'].map((entry_id) => ({ ...LIVE, entry_id, site_count: 0, sites_notified: 0, sites_live_ok: 0 }));
    const { client, calls } = withAnswers((c) =>
      isSite(c) ? { data: [] } : isChanged(c) ? { data: [{ id: 'e3' }, { id: 'e4' }], count: 2 } : view(published)(c),
    );
    const overview = await load(client, { showWaiting: true });
    expect(overview.band).toMatchObject({ heading: t.publish.noSite, tag: false, viewChanges: true });
    expect(calls.find(isById)!.in.id).toEqual(['e3', 'e4']);
    expect(entryPill({ id: 'e1', status: 'published' }, overview.status)).toEqual({ label: t.publish.noSite, tone: 'warning' });
  });

  it('reads the latest action, so a cancelled publish is neither waiting nor failed', async () => {
    const cancelled = { ...ENDED('superseded'), latest_action: 'unpublish' };
    const { client } = withAnswers(view([LIVE, cancelled]));
    expect((await load(client)).band).toMatchObject({ heading: t.overview.upToDate, tag: true, viewChanges: false });
  });

  it('keeps failing closed when the tenant has more rows than the cap', async () => {
    const { client } = withAnswers((c) => (isStatus(c) ? { data: [LIVE], count: 1001 } : undefined));
    expect((await load(client)).band).toMatchObject({ heading: t.publish.statusUnavailable, tag: false, lastPublished: null, viewChanges: false });
  });
});

describe('archived entries that were never published', () => {
  const statusOf = (...found: Record<string, unknown>[]) => (c: Call) => (isStatus(c) ? { data: found, count: found.length } : undefined);
  const abandoned = (ids: string[]) => (c: Call) => (isAbandoned(c) ? { data: ids.map((id) => ({ id })), count: ids.length } : undefined);
  const both = (first: (c: Call) => Answer | undefined, second: (c: Call) => Answer | undefined) => (c: Call) => first(c) ?? second(c);

  it.each([['failed_validation'], ['failed'], ['rejected'], ['superseded']])('a request that ended %s leaves the band and the tag alone', async (status) => {
    const { client } = withAnswers(both(statusOf(LIVE, ENDED(status)), abandoned(['e2'])));
    expect((await load(client)).band).toMatchObject({ heading: t.overview.upToDate, tag: true, lastPublished: LIVE.requested_at, viewChanges: false });
  });

  it('are not in the waiting list', async () => {
    const { client, calls } = withAnswers(both(statusOf(LIVE, ENDED('failed')), abandoned(['e2'])));
    expect((await load(client, { showWaiting: true })).showingWaiting).toBe(false);
    expect(calls.some(isById)).toBe(false);
  });

  it('keep counting while a request is on its way', async () => {
    const { client } = withAnswers(both(statusOf(LIVE, UNPROVEN, ENDED('failed')), abandoned(['e2'])));
    expect((await load(client)).band.heading).toBe(waitingHeading(1));
  });

  it('never cover an entry the read does not name: one published once keeps counting', async () => {
    const once = { ...ENDED('failed'), entry_id: 'e3' };
    const { client } = withAnswers(both(statusOf(LIVE, ENDED('failed'), once), abandoned(['e2'])));
    expect((await load(client)).band).toMatchObject({ heading: waitingHeading(1), tag: false, viewChanges: true });
  });

  it.each([
    ['failed', DENIED],
    ['capped', { data: [{ id: 'e2' }], count: 1001 }],
    ['with no count', { data: [{ id: 'e2' }], count: null }],
  ])('when the read is %s, the status is unavailable to the pills as well', async (_name, answer) => {
    const { client } = withAnswers(both(statusOf(LIVE, ENDED('failed')), (c) => (isAbandoned(c) ? answer : undefined)));
    const overview = await load(client);
    expect(overview.band).toMatchObject({ heading: t.publish.statusUnavailable, tag: false, lastPublished: null, viewChanges: false });
    expect(overview.status.ok).toBe(false);
    expect(entryPill({ id: 'e1', status: 'published' }, overview.status).tone).toBe('neutral');
  });
});

describe('a tenant with nothing proven and nothing waiting', () => {
  const NOTHING_ON_SITE = 'Ekkert er á vefnum eins og er.';
  const counts = (published: Answer, current: Answer) => (c: Call) =>
    isStatus(c) ? { data: [], count: 0 } : isPublishedCount(c) ? published : isCurrentlyPublished(c) ? current : undefined;

  it('published once and none published now: nothing is on the site', async () => {
    const { client } = withAnswers(counts({ count: 2 }, { count: 0 }));
    expect((await load(client)).band).toEqual({ heading: NOTHING_ON_SITE, tag: false, lastPublished: null, viewChanges: false, siteUrl: 'https://example.test' });
  });

  it.each([
    ['nothing ever published', { count: 0 }, { count: 0 }, t.overview.nothingPublished],
    ['something published now', { count: 2 }, { count: 1 }, t.publish.statusUnavailable],
    ['the published count failed', DENIED, { count: 0 }, t.publish.statusUnavailable],
    ['the published count missing', { count: null }, { count: 0 }, t.publish.statusUnavailable],
    ['the currently-published count failed', { count: 2 }, DENIED, t.publish.statusUnavailable],
    ['the currently-published count missing', { count: 2 }, { count: null }, t.publish.statusUnavailable],
  ])('%s', async (_name, published, current, heading) => {
    const { client } = withAnswers(counts(published, current));
    expect((await load(client)).band).toMatchObject({ heading, tag: false, lastPublished: null, viewChanges: false });
  });
});

describe('capped and failed reads', () => {
  it.each([
    ['status capped', (c: Call) => (isStatus(c) ? { data: [LIVE], count: 1001 } : undefined)],
    ['status with no count', (c: Call) => (isStatus(c) ? { data: [LIVE], count: null } : undefined)],
    ['status failed', (c: Call) => (isStatus(c) ? DENIED : undefined)],
    ['changed capped', (c: Call) => (isChanged(c) ? { data: [{ id: 'a' }], count: 1400 } : undefined)],
    ['changed with no count', (c: Call) => (isChanged(c) ? { data: [], count: null } : undefined)],
    ['changed failed', (c: Call) => (isChanged(c) ? DENIED : undefined)],
    ['site failed', (c: Call) => (isSite(c) ? DENIED : undefined)],
    ['published count failed', (c: Call) => (isStatus(c) ? { data: [], count: 0 } : isPublishedCount(c) ? DENIED : undefined)],
    ['published count missing', (c: Call) => (isStatus(c) ? { data: [], count: 0 } : isPublishedCount(c) ? { count: null } : undefined)],
    ['archived read failed', (c: Call) => (isAbandoned(c) ? DENIED : undefined)],
    ['archived read capped', (c: Call) => (isAbandoned(c) ? { data: [{ id: 'a' }], count: 1001 } : undefined)],
    ['archived read with no count', (c: Call) => (isAbandoned(c) ? { data: [], count: null } : undefined)],
  ])('%s: the band says the status is unavailable, never a smaller number', async (_name, override) => {
    const { client } = withAnswers(override);
    expect((await load(client)).band).toMatchObject({ heading: t.publish.statusUnavailable, tag: false, lastPublished: null, viewChanges: false });
  });

  it('a capped status read is treated as failed for the pills too', async () => {
    const { client } = withAnswers((c) => (isStatus(c) ? { data: [LIVE], count: 1001 } : undefined));
    expect((await load(client)).status).toEqual({ ok: false, code: 'capped' });
  });

  it('one failed read leaves the others usable', async () => {
    const { client } = withAnswers((c) => (isStatus(c) ? DENIED : undefined));
    const overview = await load(client);
    expect(overview.status.ok).toBe(false);
    expect(overview.recent).toEqual({ ok: true, value: [ENTRY] });
    expect(overview.counts.size).toBe(2);
    expect(overview.pages[0]!.entry).not.toBeNull();
  });

  it('a failed count leaves that card out and keeps the other', async () => {
    const { client } = withAnswers((c) => (isDraftCount(c) && c.eq.type === 'news' ? DENIED : undefined));
    expect([...(await load(client)).counts.keys()]).toEqual(['event']);
  });

  it('a missing count leaves that card out', async () => {
    const { client } = withAnswers((c) => (isCount(c) && !isDraftCount(c) && c.eq.type === 'event' ? { count: null } : undefined));
    expect([...(await load(client)).counts.keys()]).toEqual(['news']);
  });

  it('a failed recent read stays a failure, never an empty list', async () => {
    const { client } = withAnswers((c) => (isRecent(c) ? DENIED : undefined));
    expect((await load(client)).recent).toEqual({ ok: false, code: '42501' });
  });

  it('a failed singleton read keeps the rows, with no entries', async () => {
    const { client } = withAnswers((c) => (isSingletons(c) ? DENIED : undefined));
    const overview = await load(client);
    expect(overview.pages).toEqual([{ type: 'about', label: 'Um okkur', entry: null }]);
    expect(overview.pagesFailed).toBe(true);
  });

  it('a read that throws is a failed read, not an error page', async () => {
    const { client } = fakeClient(() => {
      throw new Error('network: secret detail');
    });
    const overview = await load(client);
    expect(overview.band.heading).toBe(t.publish.statusUnavailable);
    expect(overview.recent).toEqual({ ok: false, code: 'unknown' });
  });

  it('carries only codes, never the database message', async () => {
    const { client } = fakeClient(() => DENIED);
    expect(JSON.stringify(await load(client))).not.toContain('secret database detail');
  });
});

describe('the waiting view (?breytingar=1)', () => {
  const waiting = (c: Call) => (isChanged(c) ? { data: [{ id: 'e1' }, { id: 'e3' }], count: 2 } : isStatus(c) ? { data: [LIVE, UNPROVEN], count: 2 } : undefined);

  it('reads the waiting entries by id instead of the recent list', async () => {
    const { client, calls } = withAnswers(waiting);
    const overview = await load(client, { showWaiting: true });
    expect(overview.showingWaiting).toBe(true);
    expect(calls.some(isRecent)).toBe(false);
    const byId = calls.find(isById)!;
    expect(byId.in.id!.slice().sort()).toEqual(['e1', 'e2', 'e3']);
    expect(byId).toMatchObject({
      columns: 'id, type, title, status, updated_at',
      eq: { tenant_id: TENANT },
      order: [['updated_at', { ascending: false }]],
    });
    // The band counts archived entries that wait too, so this read must not filter them out.
    expect(byId.is).toEqual({});
  });

  it('asks for the unproven entries first, then the newest changed ones, each once', async () => {
    const { client, calls } = withAnswers(
      (c) => (isChanged(c) ? { data: [{ id: 'newest' }, { id: 'e2' }, { id: 'older' }], count: 3 } : isStatus(c) ? { data: [LIVE, UNPROVEN], count: 2 } : undefined),
    );
    await load(client, { showWaiting: true });
    expect(calls.find(isById)!.in.id).toEqual(['e2', 'newest', 'older']);
  });

  it('never lets the changed entries push an unproven one past the bound, and n stays the full count', async () => {
    const unproven = Array.from({ length: 30 }, (_, i) => ({ ...UNPROVEN, entry_id: `u${i}` }));
    const changed = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}` }));
    const { client, calls } = withAnswers((c) => (isChanged(c) ? { data: changed, count: 40 } : isStatus(c) ? { data: unproven, count: 30 } : undefined));
    const overview = await load(client, { showWaiting: true });
    expect(calls.find(isById)!.in.id).toEqual([...unproven.map((row) => row.entry_id), ...changed.slice(0, 20).map((row) => row.id)]);
    expect(overview.band.heading).toBe(waitingHeading(70));
  });

  it('asks for the first 50 ids', async () => {
    const ids = Array.from({ length: 70 }, (_, i) => ({ id: `e${i}` }));
    const { client, calls } = withAnswers((c) => (isChanged(c) ? { data: ids, count: 70 } : undefined));
    await load(client, { showWaiting: true });
    expect(calls.find(isById)!.in.id).toHaveLength(50);
  });

  it('does not run the waiting read without the param', async () => {
    const { client, calls } = withAnswers(waiting);
    expect((await load(client)).showingWaiting).toBe(false);
    expect(calls.some(isById)).toBe(false);
    expect(calls.filter(isRecent)).toHaveLength(1);
  });

  it.each([
    ['nothing waits', () => undefined],
    ['the changed read failed', (c: Call) => (isChanged(c) ? DENIED : undefined)],
    ['the status read failed', (c: Call) => (isStatus(c) ? DENIED : undefined)],
    ['the status read was capped', (c: Call) => (isStatus(c) ? { data: [LIVE], count: 2000 } : undefined)],
    ['the archived read failed', (c: Call) => (isAbandoned(c) ? DENIED : undefined)],
  ])('falls back to the recent list when %s', async (_name, override) => {
    const { client, calls } = withAnswers(override);
    const overview = await load(client, { showWaiting: true });
    expect(overview.showingWaiting).toBe(false);
    expect(calls.some(isById)).toBe(false);
    expect(calls.filter(isRecent)).toHaveLength(1);
    expect(overview.recent).toEqual({ ok: true, value: [ENTRY] });
  });

  it('reports a failed waiting read as a failed list', async () => {
    const { client } = withAnswers((c) => waiting(c) ?? (isById(c) ? DENIED : undefined));
    const overview = await load(client, { showWaiting: true });
    expect(overview.showingWaiting).toBe(true);
    expect(overview.recent).toEqual({ ok: false, code: '42501' });
  });
});
