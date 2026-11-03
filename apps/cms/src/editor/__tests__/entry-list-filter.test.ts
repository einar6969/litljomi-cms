import { describe, expect, it } from 'vitest';
import { applyEntryListFilter, isFiltered, MAX_QUERY_LENGTH, parseEntryListFilter, STATUS_FILTERS, titlePattern, type FilterableQuery } from '../entry-list-filter';

// A query that records the filter calls made on it, in order.
type Call = [method: string, ...args: unknown[]];
class Recorder implements FilterableQuery<Recorder> {
  calls: Call[] = [];
  ilike(column: string, pattern: string) { this.calls.push(['ilike', column, pattern]); return this; }
  eq(column: string, value: string) { this.calls.push(['eq', column, value]); return this; }
  is(column: string, value: null) { this.calls.push(['is', column, value]); return this; }
  not(column: string, operator: string, value: unknown) { this.calls.push(['not', column, operator, value]); return this; }
}
const callsFor = (q: string, status: (typeof STATUS_FILTERS)[number] | null) => applyEntryListFilter(new Recorder(), { q, status }).calls;

describe('parseEntryListFilter', () => {
  it('is no filter for empty search params', () => {
    expect(parseEntryListFilter({})).toEqual({ q: '', status: null });
    expect(parseEntryListFilter({ q: '', status: '' })).toEqual({ q: '', status: null });
  });

  it('reads a trimmed title search and each known status', () => {
    for (const status of STATUS_FILTERS) expect(parseEntryListFilter({ q: '  brauð ', status })).toEqual({ q: 'brauð', status });
  });

  it('ignores an unknown status, and takes the first of repeated values', () => {
    expect(parseEntryListFilter({ status: 'deleted' }).status).toBeNull();
    expect(parseEntryListFilter({ status: 'Published' }).status).toBeNull();
    expect(parseEntryListFilter({ q: ['a', 'b'], status: ['changed', 'draft'] })).toEqual({ q: 'a', status: 'changed' });
  });

  it(`cuts a search longer than ${MAX_QUERY_LENGTH} characters`, () => {
    expect(parseEntryListFilter({ q: 'x'.repeat(5000) }).q).toHaveLength(MAX_QUERY_LENGTH);
  });
});

describe('titlePattern', () => {
  it('is a substring pattern', () => {
    expect(titlePattern('Brauð')).toBe('%Brauð%');
  });

  it('makes the LIKE wildcards and the escape match themselves', () => {
    expect(titlePattern('50%_af\\')).toBe('%50\\%\\_af\\\\%');
  });

  it("sends a * as one any-character, since PostgREST reads every * as %", () => {
    expect(titlePattern('a*b')).toBe('%a_b%');
  });
});

describe('applyEntryListFilter', () => {
  it('without a filter lists every entry that is not archived, as before M2-10', () => {
    expect(callsFor('', null)).toEqual([['is', 'archived_at', null]]);
  });

  it('searches the title case-insensitively', () => {
    expect(callsFor('kaka', null)).toEqual([['ilike', 'title', '%kaka%'], ['is', 'archived_at', null]]);
  });

  it('filters published, changed and archived by the derived status', () => {
    expect(callsFor('', 'published')).toEqual([['eq', 'status', 'published']]);
    expect(callsFor('', 'changed')).toEqual([['eq', 'status', 'changed']]);
    expect(callsFor('', 'archived')).toEqual([['eq', 'status', 'archived']]);
  });

  it('tells a never-published draft from an unpublished entry by first_published_at', () => {
    expect(callsFor('', 'draft')).toEqual([['eq', 'status', 'draft'], ['is', 'first_published_at', null]]);
    expect(callsFor('', 'unpublished')).toEqual([['eq', 'status', 'draft'], ['not', 'first_published_at', 'is', null]]);
  });

  it('combines the search and the status', () => {
    expect(callsFor('kaka', 'archived')).toEqual([['ilike', 'title', '%kaka%'], ['eq', 'status', 'archived']]);
  });
});

describe('isFiltered', () => {
  it('is true when the search or the status narrows the list', () => {
    expect(isFiltered({ q: '', status: null })).toBe(false);
    expect(isFiltered({ q: 'a', status: null })).toBe(true);
    expect(isFiltered({ q: '', status: 'draft' })).toBe(true);
  });
});
