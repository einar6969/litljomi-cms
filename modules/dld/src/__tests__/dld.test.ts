import { describe, expect, it } from 'vitest';
import { isSingleton, newsType as libraryNews, structureItems, type AnyFieldKind, type ReleaseView, type SiteEntry } from '@litljomi/cms-schema';
import project from '../../fixtures/project.json';
import news from '../../fixtures/news.json';
import person from '../../fixtures/person.json';
import home from '../../fixtures/home.json';
import contact from '../../fixtures/contact.json';
import dld, { CATEGORIES, HOME_LATEST_COUNT } from '../index.ts';

const type = (name: string) => dld.types.find((t) => t.name === name)!;
const field = (t: string, k: string) => type(t).fields[k] as AnyFieldKind & { max?: number; min?: number; of?: AnyFieldKind & { still?: string }; fields?: Record<string, AnyFieldKind & { max?: number }> };
const ok = (t: string, data: unknown) => type(t).publishValidator().safeParse(data).success;

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const post = (n: number, sortAt: string | null = `2026-01-${String(30 - n).padStart(2, '0')}`, slug = `frett-${n}`): SiteEntry => ({ id: id(n), type: 'news', slug, sortAt });
const releaseOf = (entries: SiteEntry[], t = 'news'): ReleaseView => ({ entries: (x) => (x === t ? entries : []) });

describe('dld module', () => {
  it('declares the tenant, locale, five types and the structure', () => {
    expect(dld.tenant).toBe('dld');
    expect(dld.locale).toBe('is');
    expect(dld.branding.name).toBe('Dagný Land Design');
    expect(dld.types.map((t) => t.name)).toEqual(['project', 'news', 'person', 'home', 'contact']);
    expect(structureItems(dld).map((s) => s.type)).toEqual(['project', 'news', 'person', 'home', 'contact']);
    expect(isSingleton(dld, 'home')).toBe(true);
    expect(isSingleton(dld, 'contact')).toBe(true);
    for (const t of ['project', 'news', 'person']) expect(isSingleton(dld, t)).toBe(false);
  });

  it('validates every fixture with the publish validator', () => {
    expect(ok('project', project)).toBe(true);
    expect(ok('news', news)).toBe(true);
    expect(ok('person', person)).toBe(true);
    expect(ok('home', home)).toBe(true);
    expect(ok('contact', contact)).toBe(true);
  });

  it('project: required title and images, limits, seven optional facts', () => {
    expect(ok('project', { ...project, title: '' })).toBe(false);
    expect(ok('project', { ...project, title: 'x'.repeat(121) })).toBe(false);
    expect(ok('project', { ...project, images: [] })).toBe(false);
    const { images: _i, ...noImages } = project;
    expect(ok('project', noImages)).toBe(false);
    expect(ok('project', { title: 'T', images: project.images })).toBe(true);
    const img = project.images[0]!;
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ ...img, _key: `k${i}` }));
    expect(ok('project', { ...project, images: many(40) })).toBe(true);
    expect(ok('project', { ...project, images: many(41) })).toBe(false);
    expect(Object.keys(field('project', 'facts').fields!)).toEqual(['client', 'year', 'contractors', 'collaborators', 'location', 'role', 'award']);
    expect(ok('project', { ...project, facts: { client: 'x'.repeat(300) } })).toBe(true);
    expect(ok('project', { ...project, facts: { client: 'x'.repeat(301) } })).toBe(false);
    expect(Object.values(field('project', 'facts').fields!).every((f) => !f.required && f.max === 300)).toBe(true);
    expect(type('project').preview).toEqual({ title: 'title' });
  });

  it('project: the seven categories, at most seven chosen, unknown value refused', () => {
    expect(CATEGORIES.map((c) => c.value)).toEqual(['fraedsluefni', 'honnun', 'samkeppnir', 'skipulag-utivist', 'voruhonnun', 'thatttokuhonnun', 'throunarverkefni']);
    const cats = (vals: string[]) => vals.map((value, i) => ({ _key: `c${i}`, value }));
    expect(ok('project', { ...project, categories: cats(CATEGORIES.map((c) => c.value)) })).toBe(true);
    expect(ok('project', { ...project, categories: cats(['annad']) })).toBe(false);
    expect(field('project', 'categories').max).toBe(7);
  });

  it('select values and labels are as approved, verbatim', () => {
    expect(CATEGORIES.map((c) => c.label)).toEqual(['Fræðsluefni', 'Hönnun', 'Samkeppnir', 'Skipulag / útivist', 'Vöruhönnun', 'Þátttökuhönnun', 'Þróunarverkefni, sýningar og innsetningar']);
    expect(field('project', 'categories').of).toMatchObject({ kind: 'select', options: CATEGORIES });
    expect(field('news', 'kind')).toMatchObject({
      kind: 'select',
      options: [
        { value: 'frett', label: 'Frétt eða verkefnapistill' },
        { value: 'jolakvedja', label: 'Jólakveðja' },
      ],
    });
  });

  it('videos: video kind with a required still, at most six, on project and news', () => {
    for (const t of ['project', 'news']) {
      expect(field(t, 'videos')).toMatchObject({ kind: 'list', required: false, max: 6 });
      expect(field(t, 'videos').of).toMatchObject({ kind: 'video', still: 'required' });
    }
    const clip = project.videos[0]!;
    expect(ok('project', { ...project, videos: [{ ...clip, value: { ...clip.value, still: null } }] })).toBe(false);
    const seven = Array.from({ length: 7 }, (_, i) => ({ ...clip, _key: `v${i}` }));
    expect(ok('project', { ...project, videos: seven })).toBe(false);
  });

  it('news: a tenant type whose shared fields match the library type', () => {
    const n = type('news');
    expect(Object.keys(n.fields)).toEqual(['title', 'date', 'kind', 'image', 'gallery', 'body', 'relatedProject', 'videos']);
    expect(Object.keys(n.fields)).not.toContain('excerpt');
    expect(Object.keys(n.fields)).not.toContain('source');
    for (const k of ['title', 'date', 'image', 'body']) {
      const a = n.fields[k] as AnyFieldKind & { max?: number };
      const b = libraryNews.fields[k as 'title'] as AnyFieldKind & { max?: number };
      expect({ kind: a.kind, required: a.required, max: a.max }).toEqual({ kind: b.kind, required: b.required, max: b.max });
    }
    expect(n.orderBy).toBe('date');
    expect(n.preview).toEqual({ title: 'title' });
    expect(n.queryColumns(news)).toEqual({ title: 'Dæmi um frétt', sortAt: '2026-10-15' });
    expect(field('news', 'relatedProject')).toMatchObject({ kind: 'reference', to: ['project'] });
    expect(field('news', 'gallery').max).toBe(20);
  });

  it('news: kind and date are required; kind has two options', () => {
    const { kind: _k, ...noKind } = news;
    const { date: _d, ...noDate } = news;
    const { image: _m, ...noImage } = news;
    expect(ok('news', noKind)).toBe(false);
    expect(ok('news', noDate)).toBe(false);
    expect(ok('news', noImage)).toBe(false);
    expect(ok('news', { ...news, kind: 'jolakvedja' })).toBe(true);
    expect(ok('news', { ...news, kind: 'annad' })).toBe(false);
    expect(ok('news', { ...news, title: 'x'.repeat(201) })).toBe(false);
  });

  it('project and person are ordered by hand; only news is ordered by a date', () => {
    expect(type('news').orderBy).toBe('date');
    expect(type('project').orderBy).toBe('manual');
    expect(type('person').orderBy).toBe('manual');
    for (const t of ['home', 'contact']) {
      const o = field(t, type(t).orderBy);
      expect(['date', 'datetime']).not.toContain(o.kind);
    }
  });

  it('person: required name, jobTitle and portrait; bio limits', () => {
    expect(ok('person', {})).toBe(false);
    expect(ok('person', { name: 'A', jobTitle: 'B', portrait: person.portrait })).toBe(true);
    expect(ok('person', { ...person, name: 'x'.repeat(121) })).toBe(false);
    const section = (heading: string) => ({ _key: 'b' + heading.length, value: { heading, items: [] } });
    expect(ok('person', { ...person, bio: [{ _key: 'b1', value: { items: [] } }] })).toBe(false);
    expect(ok('person', { ...person, bio: [section('x'.repeat(81))] })).toBe(false);
    const seven = Array.from({ length: 7 }, (_, i) => ({ _key: `b${i}`, value: { heading: 'H', items: [] } }));
    expect(ok('person', { ...person, bio: seven })).toBe(false);
    expect(ok('person', { ...person, bio: seven.slice(0, 6) })).toBe(true);
    expect(type('person').preview).toEqual({ title: 'name' });
  });

  it('home: slides 1 to 8, featured at most 6 references to project, slogans at most 12 of 120', () => {
    const imgs = (n: number) => Array.from({ length: n }, (_, i) => ({ _key: `s${i}`, value: home.slides[0]!.value }));
    expect(ok('home', { ...home, slides: [] })).toBe(false);
    expect(ok('home', { ...home, slides: imgs(8) })).toBe(true);
    expect(ok('home', { ...home, slides: imgs(9) })).toBe(false);
    expect(field('home', 'featured')).toMatchObject({ max: 6 });
    expect(field('home', 'featured').of).toMatchObject({ kind: 'reference', to: ['project'] });
    const slogans = (n: number, len = 5) => Array.from({ length: n }, (_, i) => ({ _key: `g${i}`, value: 'x'.repeat(len) }));
    expect(ok('home', { ...home, slogans: slogans(12) })).toBe(true);
    expect(ok('home', { ...home, slogans: slogans(13) })).toBe(false);
    expect(ok('home', { ...home, slogans: slogans(1, 121) })).toBe(false);
  });

  it('contact: required email, address line1, social label and url', () => {
    expect(ok('contact', {})).toBe(false);
    expect(ok('contact', { email: 'a@example.is' })).toBe(true);
    expect(ok('contact', { email: 'a@example.is', address: { line2: 'x' } })).toBe(false);
    expect(ok('contact', { email: 'a@example.is', phone: 'x'.repeat(41) })).toBe(false);
    expect(ok('contact', { email: 'a@example.is', footerText: 'x'.repeat(201) })).toBe(false);
    const social = (value: Record<string, unknown>) => ({ _key: 's1', value });
    expect(ok('contact', { email: 'a@example.is', socials: [social({ label: 'L' })] })).toBe(false);
    expect(ok('contact', { email: 'a@example.is', socials: [social({ url: { href: 'https://example.is' } })] })).toBe(false);
    const nine = Array.from({ length: 9 }, (_, i) => ({ _key: `s${i}`, value: { label: 'L', url: { href: 'https://example.is' } } }));
    expect(ok('contact', { email: 'a@example.is', socials: nine })).toBe(false);
  });

  it('has a site entry for every type; only project and news have a path of their own', () => {
    expect(Object.keys(dld.site).sort()).toEqual(['contact', 'home', 'news', 'person', 'project']);
    for (const t of ['person', 'home', 'contact']) expect(dld.site[t]!.path).toBeUndefined();
    for (const t of ['project', 'news']) expect(dld.site[t]!.path).toBeTypeOf('function');
  });

  describe('site checks for content with no page of its own', () => {
    const entry = (type: string, n: number): SiteEntry => ({ id: id(n), type, slug: null, sortAt: null });
    const cases: [string, string[]][] = [
      ['person', ['/um-okkur']],
      ['home', ['/']],
      ['contact', ['/', '/hafdu-samband']],
    ];
    for (const [t, paths] of cases) {
      it(`${t} is checked on ${paths.join(' and ')}, present or absent`, () => {
        const e = entry(t, 9);
        expect(dld.site[t]!.checks(e, releaseOf([e], t), null)).toEqual(paths.map((path) => ({ path, expect: 'present' })));
        expect(dld.site[t]!.checks(e, releaseOf([], t), null)).toEqual(paths.map((path) => ({ path, expect: 'absent' })));
      });
    }
  });

  describe('project site checks', () => {
    const site = dld.site.project!;
    const p: SiteEntry = { id: id(1), type: 'project', slug: 'braggi', sortAt: null };
    it('has the path /verk/{slug} and refuses an entry without a slug', () => {
      expect(site.path!(p)).toBe('/verk/braggi');
      expect(() => site.path!({ ...p, slug: null })).toThrow();
    });
    it('checks its own page and /verk, present or absent', () => {
      expect(site.checks(p, releaseOf([p], 'project'), null)).toEqual([
        { path: '/verk/braggi', expect: 'present' },
        { path: '/verk', expect: 'present' },
      ]);
      expect(site.checks(p, releaseOf([], 'project'), null)).toEqual([
        { path: '/verk/braggi', expect: 'absent' },
        { path: '/verk', expect: 'absent' },
      ]);
    });
  });

  describe('news site checks', () => {
    const site = dld.site.news!;
    const range = (n: number) => Array.from({ length: n }, (_, i) => post(i + 1));
    it('has the path /frettir/{slug} and refuses an entry without a slug', () => {
      expect(HOME_LATEST_COUNT).toBe(3);
      expect(site.path!(post(1))).toBe('/frettir/frett-1');
      expect(() => site.path!(post(1, '2026-01-01', null as unknown as string))).toThrow();
    });
    it('checks own page, /frettir and / for the third-newest', () => {
      expect(site.checks(post(3), releaseOf(range(4)), null)).toEqual([
        { path: '/frettir/frett-3', expect: 'present' },
        { path: '/frettir', expect: 'present' },
        { path: '/', expect: 'present' },
      ]);
    });
    it('has no home check for the fourth-newest', () => {
      expect(site.checks(post(4), releaseOf(range(4)), null).map((c) => c.path)).toEqual(['/frettir/frett-4', '/frettir']);
    });
    it('sorts by date descending whatever order the release gives', () => {
      const shuffled = [post(4), post(1), post(3), post(2)];
      expect(site.checks(post(2), releaseOf(shuffled), null).map((c) => c.path)).toContain('/');
      expect(site.checks(post(4), releaseOf(shuffled), null).map((c) => c.path)).not.toContain('/');
    });
    it('breaks a date tie by slug ascending', () => {
      const a = post(1, '2026-05-01', 'a');
      const b = post(2, '2026-05-01', 'b');
      const c = post(3, '2026-05-01', 'c');
      const d = post(4, '2026-05-01', 'd');
      // The release view gives them in an arbitrary order within the tie.
      const r = releaseOf([d, b, a, c]);
      expect(site.checks(c, r, null).map((x) => x.path)).toContain('/');
      expect(site.checks(d, r, null).map((x) => x.path)).not.toContain('/');
      // A newer entry pushes the alphabetically last of the tie out of the three.
      const newer = post(5, '2026-06-01', 'z');
      expect(site.checks(c, releaseOf([d, newer, b, a, c]), null).map((x) => x.path)).not.toContain('/');
      expect(site.checks(b, releaseOf([d, newer, b, a, c]), null).map((x) => x.path)).toContain('/');
    });
    it('yields three absent checks when an unpublished entry was among the three newest', () => {
      const previous = releaseOf(range(5));
      const current = releaseOf([post(1), post(3), post(4), post(5)]);
      expect(site.checks(post(2), current, previous)).toEqual([
        { path: '/frettir/frett-2', expect: 'absent' },
        { path: '/frettir', expect: 'absent' },
        { path: '/', expect: 'absent' },
      ]);
    });
    it('has no home check when an unpublished entry was not among the three newest', () => {
      const previous = releaseOf(range(5));
      const current = releaseOf(range(4));
      expect(site.checks(post(5), current, previous).map((c) => c.path)).toEqual(['/frettir/frett-5', '/frettir']);
    });
    it('has no home check for an absent entry with no previous release', () => {
      expect(site.checks(post(1), releaseOf([]), null).map((c) => c.path)).toEqual(['/frettir/frett-1', '/frettir']);
    });
  });
});
