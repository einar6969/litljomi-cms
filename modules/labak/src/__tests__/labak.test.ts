import { newsType, type ReleaseView, type SiteEntry } from '@litljomi/cms-schema';
import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/news.json';
import labak, { HOME_LATEST_COUNT } from '../index.ts';

const news = labak.types.find((t) => t.name === 'news')!;
const site = labak.site.news!;

const entry = (n: number): SiteEntry => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  type: 'news',
  slug: `frett-${n}`,
  sortAt: `2026-01-${String(30 - n).padStart(2, '0')}`,
});
/** A release whose news entries are entry(1)..entry(count), newest first. */
const release = (ids: number[]): ReleaseView => ({ entries: (type) => (type === 'news' ? ids.map(entry) : []) });
const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('labak module', () => {
  it('declares the tenant, locale and one news type', () => {
    expect(labak.tenant).toBe('labak');
    expect(labak.locale).toBe('is');
    expect(labak.types.map((t) => t.name)).toEqual(['news']);
  });
  it('validates its fixture with the publish validator', () => {
    expect(news.publishValidator().safeParse(fixture).success).toBe(true);
  });
  it('adds secondaryImage and Icelandic labels; the library type is untouched', () => {
    expect(Object.keys(news.fields)).toContain('secondaryImage');
    expect(Object.keys(newsType.fields)).not.toContain('secondaryImage');
    expect(news.label).toBe('Frétt');
    expect(news.fields.title!.label).toBe('Titill');
    expect(news.fields.secondaryImage!.label).toBe('Aukamynd');
    expect(newsType.fields.title.label).toBe('Title');
  });
  it('keeps secondaryImage optional on publish', () => {
    const { secondaryImage: _omit, ...rest } = fixture;
    expect(news.publishValidator().safeParse(rest).success).toBe(true);
  });
  it('builds the path from the slug and refuses an entry without one', () => {
    expect(site.path(entry(1))).toBe('/frettir/frett-1');
    expect(() => site.path({ ...entry(1), slug: null })).toThrow();
  });
  it('checks own path, list and home for an entry among the latest six', () => {
    expect(HOME_LATEST_COUNT).toBe(6);
    const r = release(range(7));
    expect(site.checks(entry(6), r, null)).toEqual([
      { path: '/frettir/frett-6', expect: 'present' },
      { path: '/frettir', expect: 'present' },
      { path: '/', expect: 'present' },
    ]);
  });
  it('has no home check for the seventh-newest entry', () => {
    const checks = site.checks(entry(7), release(range(7)), null);
    expect(checks.map((c) => c.path)).toEqual(['/frettir/frett-7', '/frettir']);
    expect(checks.every((c) => c.expect === 'present')).toBe(true);
  });
  it('yields three absent checks when an entry at position 2 is unpublished', () => {
    const previous = release(range(8));
    const current = release([1, 3, 4, 5, 6, 7, 8]);
    expect(site.checks(entry(2), current, previous)).toEqual([
      { path: '/frettir/frett-2', expect: 'absent' },
      { path: '/frettir', expect: 'absent' },
      { path: '/', expect: 'absent' },
    ]);
  });
  it('has no home check when an unpublished entry was not among the latest six before', () => {
    const previous = release(range(8));
    const current = release([1, 2, 3, 4, 5, 6, 7]);
    expect(site.checks(entry(8), current, previous).map((c) => c.path)).toEqual(['/frettir/frett-8', '/frettir']);
  });
  it('has no home check for an absent entry when there is no previous release', () => {
    expect(site.checks(entry(1), release([]), null).map((c) => c.path)).toEqual(['/frettir/frett-1', '/frettir']);
  });
});
