import 'server-only';
import type { StructureNode } from '@litljomi/cms-schema';
import type { SupabaseClient } from '@/lib/supabase/types';
import {
  deriveBand,
  needsPublishedCount,
  OVERVIEW_STATUS_FIELDS,
  overviewTypes,
  summarizeStatus,
  usableSiteUrl,
  waitingIds,
  type Band,
  type EntryCount,
  type OverviewEntry,
  type OverviewPage,
  type OverviewSite,
  type OverviewStatusRow,
  type Read,
  type StatusSummary,
} from '../overview';

export type TenantOverviewData = {
  band: Band;
  /** The count line of each list type whose two reads succeeded. */
  counts: ReadonlyMap<string, EntryCount>;
  recent: Read<OverviewEntry[]>;
  /** `recent` holds the waiting entries (`?breytingar=1`). */
  showingWaiting: boolean;
  pages: OverviewPage[];
  pagesFailed: boolean;
  status: Read<StatusSummary>;
};

type Answer<T> = { data: T | null; error: { code?: string } | null; count?: number | null };
type Query = PromiseLike<Answer<unknown>>;

const ENTRY_COLUMNS = 'id, type, title, status, updated_at';
export const OVERVIEW_STATUS_COLUMNS = OVERVIEW_STATUS_FIELDS.join(', ');
const RECENT_LIMIT = 5;
/** The `.in('id', ...)` list goes in the URL, so it stays short. */
const WAITING_LIMIT = 50;
/** The stack's `max_rows`: asking for more cannot return more. */
const MAX_ROWS = 1000;

/** Runs a read. A failure of any kind is a result with its code, never a throw to the error page. */
async function settle<T>(query: Query, take: (answer: Answer<unknown>) => Read<T>): Promise<Read<T>> {
  try {
    const answer = await query;
    return answer.error ? { ok: false, code: answer.error.code ?? 'unknown' } : take(answer);
  } catch {
    return { ok: false, code: 'unknown' };
  }
}

const rows = <T>(query: Query): Promise<Read<T[]>> => settle(query, ({ data }) => ({ ok: true, value: (data ?? []) as T[] }));

/** Rows whose count must prove they are all of them: fewer rows than the count is capped, a failed read. */
const allRows = <T>(query: Query): Promise<Read<T[]>> =>
  settle(query, ({ data, count }) => {
    const value = (data ?? []) as T[];
    if (typeof count !== 'number') return { ok: false, code: 'no_count' };
    return count > value.length ? { ok: false, code: 'capped' } : { ok: true, value };
  });

const count = (query: Query): Promise<Read<number>> =>
  settle(query, ({ count: exact }) => (typeof exact === 'number' ? { ok: true, value: exact } : { ok: false, code: 'no_count' }));

const mapRead = <T, U>(read: Read<T>, fn: (value: T) => U): Read<U> => (read.ok ? { ok: true, value: fn(read.value) } : read);

/**
 * Everything the tenant home's overview shows, read in parallel under the editor's own session
 * (§4.5): RLS decides the rows, and every read is also scoped to the tenant. Each read fails on its
 * own into a result the page can show. No read selects `slug`, `data` or a column it does not use.
 *
 * Two reads wait for the first round. The published count runs only when the band has reached
 * "nothing proven, n = 0"; with `showWaiting`, the list is the waiting entries when there are any
 * and the recent entries otherwise, so one request never runs both.
 */
export async function loadTenantOverview(
  client: SupabaseClient,
  { tenantId, structure, showWaiting }: { tenantId: string; structure: StructureNode[]; showWaiting: boolean },
): Promise<TenantOverviewData> {
  const { list, singletons } = overviewTypes(structure);
  const known = [...list, ...singletons].map((item) => item.type);
  const entries = () => client.from('entry_list');

  const readRecent = async (): Promise<Read<OverviewEntry[]>> =>
    known.length === 0
      ? { ok: true, value: [] }
      : rows<OverviewEntry>(
          entries()
            .select(ENTRY_COLUMNS)
            .eq('tenant_id', tenantId)
            .is('archived_at', null)
            .in('type', known)
            .order('updated_at', { ascending: false })
            .limit(RECENT_LIMIT),
        );

  const readCount = async ({ type }: { type: string }): Promise<[string, EntryCount] | null> => {
    const live = () => entries().select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('type', type).is('archived_at', null);
    // The list's Uppkast filter: never published (entry-list-filter.ts).
    const [total, drafts] = await Promise.all([count(live()), count(live().eq('status', 'draft').is('first_published_at', null))]);
    return total.ok && drafts.ok ? [type, { total: total.value, drafts: drafts.value }] : null;
  };

  const [site, changed, status, counts, pageRows, firstRecent] = await Promise.all([
    settle<OverviewSite | null>(
      client.from('tenant_sites').select('base_url').eq('tenant_id', tenantId).eq('active', true).order('base_url').limit(1),
      ({ data }) => {
        const [row] = (data ?? []) as { base_url: string }[];
        return { ok: true, value: row ? { url: usableSiteUrl(row.base_url) } : null };
      },
    ),
    allRows<{ id: string }>(
      entries().select('id', { count: 'exact' }).eq('tenant_id', tenantId).eq('status', 'changed').order('updated_at', { ascending: false }).limit(MAX_ROWS),
    ),
    // No status filter, ever: the view has already picked each entry's latest request, so a filter
    // here does not fall back to an older one. It loses the entry, and with it the failure (§7.4).
    allRows<OverviewStatusRow>(client.from('publication_status').select(OVERVIEW_STATUS_COLUMNS, { count: 'exact' }).eq('tenant_id', tenantId).limit(MAX_ROWS)),
    Promise.all(list.map(readCount)),
    singletons.length === 0
      ? ({ ok: true, value: [] } satisfies Read<OverviewEntry[]>)
      : rows<OverviewEntry>(
          entries()
            .select(ENTRY_COLUMNS)
            .eq('tenant_id', tenantId)
            .is('archived_at', null)
            .in(
              'type',
              singletons.map((item) => item.type),
            ),
        ),
    showWaiting ? null : readRecent(),
  ]);

  const summary = mapRead(status, summarizeStatus);
  const changedIds = mapRead(changed, (found) => found.map((row) => row.id));
  const bandReads = { site, changed: changedIds, status: summary };
  const waiting = changedIds.ok && summary.ok ? waitingIds(changedIds.value, summary.value) : [];
  const showingWaiting = showWaiting && waiting.length > 0;

  const [recent, published] = await Promise.all([
    firstRecent ??
      (showingWaiting
        ? rows<OverviewEntry>(
            entries()
              .select(ENTRY_COLUMNS)
              .eq('tenant_id', tenantId)
              .in('id', waiting.slice(0, WAITING_LIMIT))
              .order('updated_at', { ascending: false }),
          )
        : readRecent()),
    needsPublishedCount(bandReads)
      ? count(entries().select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).not('first_published_at', 'is', null).is('archived_at', null))
      : null,
  ]);

  const found = pageRows.ok ? pageRows.value : [];
  return {
    band: deriveBand({ ...bandReads, published }),
    counts: new Map(counts.filter((entry) => entry !== null)),
    recent,
    showingWaiting,
    pages: singletons.map(({ type, label }) => ({ type, label, entry: found.find((row) => row.type === type) ?? null })),
    pagesFailed: !pageRows.ok,
    status: summary,
  };
}
