// The entry list's title search and status filter (spec §10.1; plan M2-10). The state lives in
// the URL (`?q=…&status=…`), so a filtered list can be reloaded, bookmarked and shared, and the
// form works without JavaScript. The filter is applied to the api.entry_list query under the
// editor's own session, so RLS still decides which tenant's rows can match. No full-text search
// and no index (§10.2): a case-insensitive substring match on the promoted `title` column, within
// one tenant and type.
//
// This file imports nothing from the app, so the integration tests run the same query builder.

/** The status filter's values, in the order the filter offers them. */
export const STATUS_FILTERS = ['draft', 'published', 'changed', 'unpublished', 'archived'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export type EntryListFilter = {
  /** The title search, trimmed; '' for none. */
  q: string;
  /** null: every entry that is not archived (the list's default). */
  status: StatusFilter | null;
};

/** Longer searches are cut to this many characters. A title never needs more to be found. */
export const MAX_QUERY_LENGTH = 200;

type Param = string | string[] | undefined;

const firstValue = (value: Param): string => (Array.isArray(value) ? (value[0] ?? '') : (value ?? ''));

const isStatusFilter = (value: string): value is StatusFilter => (STATUS_FILTERS as readonly string[]).includes(value);

/** The filter in a page's search params. An unknown status is ignored, as if none were given. */
export function parseEntryListFilter(params: Record<string, Param>): EntryListFilter {
  const q = firstValue(params.q).trim().slice(0, MAX_QUERY_LENGTH).trim();
  const status = firstValue(params.status);
  return { q, status: isStatusFilter(status) ? status : null };
}

/**
 * The ILIKE pattern for a substring search. The LIKE wildcards `%` and `_` and the escape `\` in
 * the search match themselves. PostgREST turns every `*` in a like pattern into `%` and has no
 * escape for it, so a `*` in the search is sent as `_` (any one character): it still finds the
 * titles with the `*`, and may also find a few with another character there.
 */
export function titlePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/\*/g, '_')}%`;
}

/** The filter methods of a PostgREST query that the entry list uses. */
export interface FilterableQuery<Q> {
  ilike(column: string, pattern: string): Q;
  eq(column: string, value: string): Q;
  is(column: string, value: null): Q;
  not(column: string, operator: string, value: unknown): Q;
}

/**
 * Narrows an api.entry_list query to the filter. `status` is derived as in §4.3; an entry that was
 * published and then unpublished has the status `draft` there, so the filter tells "draft" (never
 * published) and "unpublished" apart by `first_published_at`.
 */
export function applyEntryListFilter<Q extends FilterableQuery<Q>>(query: Q, filter: EntryListFilter): Q {
  const searched = filter.q ? query.ilike('title', titlePattern(filter.q)) : query;
  switch (filter.status) {
    case null:
      return searched.is('archived_at', null);
    case 'draft':
      return searched.eq('status', 'draft').is('first_published_at', null);
    case 'unpublished':
      return searched.eq('status', 'draft').not('first_published_at', 'is', null);
    default:
      return searched.eq('status', filter.status);
  }
}

/** Whether the filter narrows the list at all. */
export const isFiltered = (filter: EntryListFilter): boolean => filter.q !== '' || filter.status !== null;
