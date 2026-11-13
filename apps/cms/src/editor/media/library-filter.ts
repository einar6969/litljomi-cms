// The media library's search, filters, sort, view and paging (docs/plans/media-library.md section
// 6.1, slice L4). The state lives in the URL (`?q=…&filter=…&sort=…&view=…&page=…&file=…`), as the
// entry list's does, so a filtered view can be reloaded and shared, and the search form works
// before JavaScript loads. The filter is applied to the api.asset_list query under the editor's own
// session, so RLS still decides which tenant's files can match. No full-text index (§10.2): one
// case-insensitive substring match on the view's `search_text` (file name, alt text, caption and
// credit), escaped as the entry list's title search is.
//
// This file imports nothing from the app, so the integration tests run the same query builder.
import { MAX_QUERY_LENGTH, titlePattern } from '../entry-list-filter';

/** The quick filters: images whose default alt text is empty, and files nothing uses (plan section 4.1). */
export const LIBRARY_FILTERS = ['missing-alt', 'unused'] as const;
export type LibraryFilter = (typeof LIBRARY_FILTERS)[number];

/** The sort choices, in the order the menu offers them. The first is the default. */
export const LIBRARY_SORTS = ['newest', 'oldest', 'name', 'largest'] as const;
export type LibrarySort = (typeof LIBRARY_SORTS)[number];

export const LIBRARY_VIEWS = ['grid', 'list'] as const;
export type LibraryView = (typeof LIBRARY_VIEWS)[number];

/** Files per "Sýna fleiri". */
export const LIBRARY_PAGE_SIZE = 60;
/**
 * The most pages shown at once. Each page shows every file up to it, read in one request with one
 * row more to know whether there are more, and PostgREST returns at most 1,000 rows (config.toml).
 */
export const MAX_LIBRARY_PAGE = Math.floor((1000 - 1) / LIBRARY_PAGE_SIZE);

export type LibraryState = {
  /** The search, trimmed; '' for none. */
  q: string;
  filter: LibraryFilter | null;
  sort: LibrarySort;
  view: LibraryView;
  /** How many pages of files are shown, from 1 to MAX_LIBRARY_PAGE. */
  page: number;
  /** The file whose details are open, a canonical asset id, or null. */
  file: string | null;
};

type Param = string | string[] | undefined;

const firstValue = (value: Param): string => (Array.isArray(value) ? (value[0] ?? '') : (value ?? ''));
const oneOf = <T extends string>(values: readonly T[], value: string): T | null => ((values as readonly string[]).includes(value) ? (value as T) : null);
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The state in a page's search params. An unknown value is ignored, as if none were given. */
export function parseLibraryState(params: Record<string, Param>): LibraryState {
  const q = firstValue(params.q).trim().slice(0, MAX_QUERY_LENGTH).trim();
  const page = firstValue(params.page);
  const file = firstValue(params.file);
  return {
    q,
    filter: oneOf(LIBRARY_FILTERS, firstValue(params.filter)),
    sort: oneOf(LIBRARY_SORTS, firstValue(params.sort)) ?? 'newest',
    view: oneOf(LIBRARY_VIEWS, firstValue(params.view)) ?? 'grid',
    page: /^[1-9][0-9]*$/.test(page) ? Math.min(Number(page), MAX_LIBRARY_PAGE) : 1,
    file: CANONICAL_UUID.test(file) ? file : null,
  };
}

/** The filter and order methods of a PostgREST query that the library uses. */
export interface LibraryQuery<Q> {
  ilike(column: string, pattern: string): Q;
  is(column: string, value: null | boolean): Q;
  order(column: string, options: { ascending: boolean }): Q;
}

/**
 * Narrows an api.asset_list query to the state's search and filter. A file taken out of the
 * library (`archived_at`) is never listed. "Unused" is `not in_use` among those (plan section 4.1).
 */
export function applyLibraryFilter<Q extends LibraryQuery<Q>>(query: Q, state: Pick<LibraryState, 'q' | 'filter'>): Q {
  const listed = query.is('archived_at', null);
  const searched = state.q ? listed.ilike('search_text', titlePattern(state.q)) : listed;
  switch (state.filter) {
    case 'missing-alt':
      return searched.is('missing_alt', true);
    case 'unused':
      return searched.is('in_use', false);
    default:
      return searched;
  }
}

const ORDER: Record<LibrarySort, [column: string, ascending: boolean]> = {
  newest: ['created_at', false],
  oldest: ['created_at', true],
  name: ['filename', true],
  largest: ['bytes', false],
};

/** Orders the query by the sort, then by id, so that rows with the same value keep one order across pages. */
export function orderLibrary<Q extends LibraryQuery<Q>>(query: Q, sort: LibrarySort): Q {
  const [column, ascending] = ORDER[sort];
  return query.order(column, { ascending }).order('id', { ascending: true });
}

/** The rows to read for `page` pages (inclusive bounds, as PostgREST's range): one more than are shown. */
export const libraryRange = (page: number): { from: number; to: number } => ({ from: 0, to: page * LIBRARY_PAGE_SIZE });

/**
 * The library's URL for the state with the change applied. Only what differs from the default is
 * written, in a fixed order, so equal states have equal URLs.
 */
export function libraryHref(base: string, state: LibraryState, change: Partial<LibraryState> = {}): string {
  const next = { ...state, ...change };
  const params = new URLSearchParams();
  if (next.q) params.set('q', next.q);
  if (next.filter) params.set('filter', next.filter);
  if (next.sort !== 'newest') params.set('sort', next.sort);
  if (next.view !== 'grid') params.set('view', next.view);
  if (next.page > 1) params.set('page', String(next.page));
  if (next.file) params.set('file', next.file);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

/** Whether the search or a filter narrows the list. The sort, view and page only arrange it. */
export const isLibraryFiltered = (state: LibraryState): boolean => state.q !== '' || state.filter !== null;
