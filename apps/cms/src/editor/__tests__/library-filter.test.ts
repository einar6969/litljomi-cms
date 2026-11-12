import { describe, expect, it } from 'vitest';
import {
  applyLibraryFilter,
  isLibraryFiltered,
  LIBRARY_PAGE_SIZE,
  libraryHref,
  libraryRange,
  MAX_LIBRARY_PAGE,
  orderLibrary,
  parseLibraryState,
  type LibraryQuery,
  type LibraryState,
} from '../media/library-filter';
import { MAX_QUERY_LENGTH } from '../entry-list-filter';

// A query that records the calls made on it, in order.
type Call = [method: string, ...args: unknown[]];
class Recorder implements LibraryQuery<Recorder> {
  calls: Call[] = [];
  ilike(column: string, pattern: string) { this.calls.push(['ilike', column, pattern]); return this; }
  is(column: string, value: null | boolean) { this.calls.push(['is', column, value]); return this; }
  order(column: string, options: { ascending: boolean }) { this.calls.push(['order', column, options.ascending]); return this; }
}

const DEFAULT: LibraryState = { q: '', filter: null, sort: 'newest', view: 'grid', page: 1, file: null };
const FILE = '00000000-0000-4000-8000-0000000000a1';

describe('parseLibraryState', () => {
  it('is the default state for empty search params: newest first, grid, first page, no file', () => {
    expect(parseLibraryState({})).toEqual(DEFAULT);
    expect(parseLibraryState({ q: '', filter: '', sort: '', view: '', page: '', file: '' })).toEqual(DEFAULT);
  });

  it('reads each known value', () => {
    expect(parseLibraryState({ q: '  Rúgbrauð ', filter: 'missing-alt', sort: 'largest', view: 'list', page: '3', file: FILE })).toEqual({
      q: 'Rúgbrauð',
      filter: 'missing-alt',
      sort: 'largest',
      view: 'list',
      page: 3,
      file: FILE,
    });
    expect(parseLibraryState({ filter: 'unused' }).filter).toBe('unused');
    for (const sort of ['newest', 'oldest', 'name', 'largest'] as const) expect(parseLibraryState({ sort }).sort).toBe(sort);
  });

  it('ignores unknown values as if none were given, and takes the first of repeated values', () => {
    expect(parseLibraryState({ filter: 'video', sort: 'random', view: 'table', file: 'x' })).toEqual(DEFAULT);
    expect(parseLibraryState({ file: FILE.toUpperCase() }).file).toBeNull();
    expect(parseLibraryState({ q: ['a', 'b'], filter: ['unused', 'missing-alt'] })).toMatchObject({ q: 'a', filter: 'unused' });
  });

  it(`reads the page as a whole number from 1 to ${MAX_LIBRARY_PAGE}`, () => {
    for (const page of ['0', '-2', '1.5', 'x', '1e2', ' 2']) expect(parseLibraryState({ page }).page, page).toBe(1);
    expect(parseLibraryState({ page: '16' }).page).toBe(16);
    expect(parseLibraryState({ page: '17' }).page).toBe(MAX_LIBRARY_PAGE);
    expect(parseLibraryState({ page: '99999999999999999999' }).page).toBe(MAX_LIBRARY_PAGE);
  });

  it(`cuts a search longer than ${MAX_QUERY_LENGTH} characters`, () => {
    expect(parseLibraryState({ q: 'x'.repeat(5000) }).q).toHaveLength(MAX_QUERY_LENGTH);
  });
});

describe('applyLibraryFilter', () => {
  const callsFor = (change: Partial<LibraryState>) => applyLibraryFilter(new Recorder(), { ...DEFAULT, ...change }).calls;

  it('without a filter lists every file that is not taken out of the library', () => {
    expect(callsFor({})).toEqual([['is', 'archived_at', null]]);
  });

  it('searches file name, alt, caption and credit through search_text, with the entry list\'s escaping', () => {
    expect(callsFor({ q: '50%_*' })).toEqual([['is', 'archived_at', null], ['ilike', 'search_text', '%50\\%\\__%']]);
  });

  it('narrows to images missing their alt text, or to unused files', () => {
    expect(callsFor({ filter: 'missing-alt' })).toEqual([['is', 'archived_at', null], ['is', 'missing_alt', true]]);
    expect(callsFor({ filter: 'unused' })).toEqual([['is', 'archived_at', null], ['is', 'in_use', false]]);
  });

  it('combines the search and a filter', () => {
    expect(callsFor({ q: 'kaka', filter: 'unused' })).toEqual([['is', 'archived_at', null], ['ilike', 'search_text', '%kaka%'], ['is', 'in_use', false]]);
  });
});

describe('orderLibrary', () => {
  const orderFor = (sort: LibraryState['sort']) => orderLibrary(new Recorder(), sort).calls;

  it('orders by each sort, always with the id last, so a page boundary never repeats or skips a file', () => {
    expect(orderFor('newest')).toEqual([['order', 'created_at', false], ['order', 'id', true]]);
    expect(orderFor('oldest')).toEqual([['order', 'created_at', true], ['order', 'id', true]]);
    expect(orderFor('name')).toEqual([['order', 'filename', true], ['order', 'id', true]]);
    expect(orderFor('largest')).toEqual([['order', 'bytes', false], ['order', 'id', true]]);
  });
});

describe('libraryRange', () => {
  it(`asks for ${LIBRARY_PAGE_SIZE} files per page shown so far, and one more to know whether there are more`, () => {
    expect(libraryRange(1)).toEqual({ from: 0, to: LIBRARY_PAGE_SIZE });
    expect(libraryRange(3)).toEqual({ from: 0, to: 3 * LIBRARY_PAGE_SIZE });
  });

  it('stays within the 1,000 rows PostgREST returns at most', () => {
    expect(libraryRange(MAX_LIBRARY_PAGE).to + 1).toBeLessThanOrEqual(1000);
  });
});

describe('libraryHref', () => {
  const base = '/t/demo/assets';

  it('is the bare path for the default state', () => {
    expect(libraryHref(base, DEFAULT)).toBe(base);
  });

  it('keeps only what differs from the default, in a fixed order', () => {
    expect(libraryHref(base, { q: 'brauð & smjör', filter: 'unused', sort: 'name', view: 'list', page: 2, file: FILE })).toBe(
      `${base}?q=brau%C3%B0+%26+smj%C3%B6r&filter=unused&sort=name&view=list&page=2&file=${FILE}`,
    );
  });

  it('applies a change to the state', () => {
    const state: LibraryState = { ...DEFAULT, q: 'a', filter: 'unused', page: 3 };
    expect(libraryHref(base, state, { file: FILE })).toBe(`${base}?q=a&filter=unused&page=3&file=${FILE}`);
    expect(libraryHref(base, { ...state, file: FILE }, { file: null })).toBe(`${base}?q=a&filter=unused&page=3`);
    expect(libraryHref(base, state, { filter: null, page: 1 })).toBe(`${base}?q=a`);
  });
});

describe('isLibraryFiltered', () => {
  it('is true when the search or a filter narrows the list, not for the sort, view or page', () => {
    expect(isLibraryFiltered(DEFAULT)).toBe(false);
    expect(isLibraryFiltered({ ...DEFAULT, sort: 'name', view: 'list', page: 2 })).toBe(false);
    expect(isLibraryFiltered({ ...DEFAULT, q: 'a' })).toBe(true);
    expect(isLibraryFiltered({ ...DEFAULT, filter: 'missing-alt' })).toBe(true);
  });
});
