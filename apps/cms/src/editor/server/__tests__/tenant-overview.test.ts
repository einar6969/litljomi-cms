// The overview's reads, against a fake client that records every query: all of them under the
// editor's session and scoped to the tenant, none selecting a column it does not use, each failing
// on its own into a result the page can show.
import type { StructureNode } from '@litljomi/cms-schema';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n/is';
import type { SupabaseClient } from '@/lib/supabase/types';
import { waitingHeading } from '../../overview';
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
};
const UNPROVEN = { ...LIVE, entry_id: 'e2', status: 'pending', release_status: null, sites_notified: 0, sites_live_ok: 0 };

const isSite = (c: Call) => c.table === 'tenant_sites';
const isStatus = (c: Call) => c.table === 'publication_status';
const isChanged = (c: Call) => c.table === 'entry_list' && c.eq.status === 'changed';
const isCount = (c: Call) => c.table === 'entry_list' && c.options?.head === true && c.eq.type !== undefined;
const isDraftCount = (c: Call) => isCount(c) && c.eq.status === 'draft';
const isPublishedCount = (c: Call) => c.table === 'entry_list' && c.options?.head === true && c.eq.type === undefined;
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
  if (isPublishedCount(c)) return { count: 0 };
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
      'entry_id, action, status, requested_at, release_status, omitted, site_count, sites_notified, sites_live_ok, sites_not_confirmed, retries_exhausted, live_retrying',
    );
    expect(status.in.status).toEqual(['pending', 'validating', 'committed']);
    expect(status.limit).toBe(1000);
    expect(status.options).toEqual({ count: 'exact' });
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

  it('do not read the published count unless the band needs it', async () => {
    const { client, calls } = fakeClient(healthy);
    await load(client);
    expect(calls.some(isPublishedCount)).toBe(false);
  });

  it('read the published count at "nothing proven, n = 0"', async () => {
    const { client, calls } = withAnswers((c) => (isStatus(c) ? { data: [], count: 0 } : undefined));
    const overview = await load(client);
    expect(calls.find(isPublishedCount)).toMatchObject({ columns: 'id', options: { count: 'exact', head: true }, is: { archived_at: null } });
    expect(calls.find(isPublishedCount)!.not).toEqual([['first_published_at', 'is', null]]);
    expect(overview.band.heading).toBe(t.overview.nothingPublished);
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
      is: { archived_at: null },
      order: [['updated_at', { ascending: false }]],
    });
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
