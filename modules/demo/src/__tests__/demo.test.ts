import { describe, expect, it } from 'vitest';
import { isManuallyOrdered, isSingleton, structureItems, type AnyFieldKind, type ReleaseView, type SiteEntry } from '@litljomi/cms-schema';
import fixture from '../../fixtures/event.json';
import demo from '../index.ts';

const event = demo.types.find((t) => t.name === 'event')!;
const e: SiteEntry = { id: '00000000-0000-4000-8000-000000000001', type: 'event', slug: 'opid-hus', sortAt: '2026-12-01' };
const release = (present: boolean): ReleaseView => ({ entries: (t) => (t === 'event' && present ? [e] : []) });

describe('demo module', () => {
  it('declares the tenant and five types, event, the schema-evolution test type notice, the singletons site-info and events-page and the manually ordered partner; there is no news type', () => {
    expect(demo.tenant).toBe('demo');
    expect(demo.types.map((t) => t.name)).toEqual(['event', 'notice', 'site-info', 'events-page', 'partner']);
    expect(structureItems(demo).map((s) => s.type)).toEqual(['event', 'partner', 'site-info', 'events-page']);
    expect(demo.structure[0]).toMatchObject({ group: 'Content' });
    expect(isSingleton(demo, 'site-info')).toBe(true);
    expect(isSingleton(demo, 'event')).toBe(false);
    expect(demo.site['site-info']).toBeUndefined();
    expect(demo.site.notice).toBeUndefined();
    expect(demo.types.some((t) => t.name === 'news')).toBe(false);
    expect(demo.site.news).toBeUndefined();
  });
  it('validates its fixture with the publish validator', () => {
    expect(event.publishValidator().safeParse(fixture).success).toBe(true);
  });
  it('requires only title and startDate, and has no image field', () => {
    const r = event.publishValidator().safeParse({});
    const paths = r.success ? [] : r.error.issues.map((i) => i.path[0]).sort();
    expect(paths).toEqual(['startDate', 'title']);
    expect(Object.values<AnyFieldKind>(event.fields).some((f) => f.kind === 'image')).toBe(false);
    expect(event.orderBy).toBe('startDate');
    expect(event.version).toBe(1);
  });
  it('has one manually ordered type, partner, in the Content group and with no site pages (A12)', () => {
    const partner = demo.types.find((t) => t.name === 'partner')!;
    expect(demo.types.filter((t) => isManuallyOrdered(t)).map((t) => t.name)).toEqual(['partner']);
    expect(partner.orderBy).toBe('manual');
    expect(partner.version).toBe(1);
    expect(demo.structure[0]).toMatchObject({ group: 'Content', items: [{ type: 'event' }, { type: 'partner', label: 'Partners' }] });
    expect(isSingleton(demo, 'partner')).toBe(false);
    expect(demo.site.partner).toBeUndefined();
    expect(partner.publishValidator().safeParse({ title: 'Samstarfsaðili' }).success).toBe(true);
    expect(partner.publishValidator().safeParse({}).success).toBe(false);
    expect(partner.queryColumns({ title: 'Samstarfsaðili' })).toEqual({ title: 'Samstarfsaðili', sortAt: null });
  });
  it('has an optional reference to another event (plan M2-04)', () => {
    const related = event.fields.related as AnyFieldKind & { to: readonly string[] };
    expect(related).toMatchObject({ kind: 'reference', required: false, to: ['event'] });
  });
  it('has an optional group holding a list of event references (plan M2-06)', () => {
    const program = event.fields.program as AnyFieldKind & { fields: Record<string, AnyFieldKind & { of?: AnyFieldKind; max?: number }> };
    expect(program).toMatchObject({ kind: 'group', required: false });
    expect(program.fields.highlights).toMatchObject({ kind: 'list', required: false, max: 10 });
    expect(program.fields.highlights!.of).toMatchObject({ kind: 'reference', to: ['event'] });
    const highlight = { _key: 'h1', value: { _ref: '00000000-0000-4000-8000-000000000002', _kind: 'entry' } };
    expect(event.publishValidator().safeParse({ ...fixture, program: { highlights: [highlight] } }).success).toBe(true);
    const tooMany = Array.from({ length: 11 }, (_, i) => ({ ...highlight, _key: `h${i}` }));
    expect(event.publishValidator().safeParse({ ...fixture, program: { highlights: tooMany } }).success).toBe(false);
  });
  it('has an optional list of videos in its program group, the still optional (A11)', () => {
    const program = event.fields.program as AnyFieldKind & { fields: Record<string, AnyFieldKind & { of?: AnyFieldKind & { still?: string }; max?: number }> };
    expect(program.fields.videos).toMatchObject({ kind: 'list', required: false, max: 3 });
    expect(program.fields.videos!.of).toMatchObject({ kind: 'video', required: false, still: 'optional' });
    const clip = { _key: 'v1', value: { url: 'https://vimeo.com/76979871', title: 'Opnunin', still: null } };
    expect(event.publishValidator().safeParse({ ...fixture, program: { videos: [clip] } }).success).toBe(true);
    const unknown = { ...clip, value: { ...clip.value, url: 'https://example.com/1' } };
    expect(event.publishValidator().safeParse({ ...fixture, program: { videos: [unknown] } }).success).toBe(false);
  });
  it('has an optional list of up to twelve images in its program group (media library L6)', () => {
    const program = event.fields.program as AnyFieldKind & { fields: Record<string, AnyFieldKind & { of?: AnyFieldKind; max?: number }> };
    expect(program.fields.gallery).toMatchObject({ kind: 'list', required: false, max: 12 });
    expect(program.fields.gallery!.of).toMatchObject({ kind: 'image', required: false });
    const photo = (n: number) => ({ _key: `g${n}`, value: { _ref: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, _kind: 'asset', alt: '' } });
    const twelve = Array.from({ length: 12 }, (_, i) => photo(i + 1));
    expect(event.publishValidator().safeParse({ ...fixture, program: { gallery: twelve } }).success).toBe(true);
    expect(event.publishValidator().safeParse({ ...fixture, program: { gallery: [...twelve, photo(13)] } }).success).toBe(false);
    // An empty item is refused on publish.
    expect(event.publishValidator().safeParse({ ...fixture, program: { gallery: [{ _key: 'g1', value: null }] } }).success).toBe(false);
  });
  it('has an optional field of each scalar kind, filled in its fixture (M2-03)', () => {
    const byKind = Object.fromEntries(Object.entries<AnyFieldKind>(event.fields).map(([k, f]) => [f.kind, { key: k, f }]));
    for (const kind of ['number', 'boolean', 'select', 'datetime']) {
      const field = byKind[kind];
      expect(field, kind).toBeDefined();
      expect(field!.f.required).toBe(false);
      expect((fixture as Record<string, unknown>)[field!.key]).not.toBeUndefined();
    }
  });
  it.each([
    ['capacity', -1],
    ['capacity', 2.5],
    ['freeEntry', 'yes'],
    ['category', 'party'],
    ['doorsOpen', '2026-12-01T17:30:00'],
  ])('refuses the fixture with %s = %j', (key, value) => {
    expect(event.publishValidator().safeParse({ ...fixture, [key]: value }).success).toBe(false);
  });
  it('builds paths and checks', () => {
    const s = demo.site.event!;
    expect(s.path!(e)).toBe('/events/opid-hus');
    expect(s.checks(e, release(true), null)).toEqual([
      { path: '/events/opid-hus', expect: 'present' },
      { path: '/events', expect: 'present' },
    ]);
    expect(s.checks(e, release(false), release(true)).map((c) => c.expect)).toEqual(['absent', 'absent']);
  });
  it('refuses to build a path for an entry without a slug', () => {
    const s = demo.site.event!;
    const noSlug: SiteEntry = { ...e, slug: null };
    expect(() => s.path!(noSlug)).toThrow(/has no slug/);
    expect(() => s.checks(noSlug, release(true), null)).toThrow(/has no slug/);
  });
});

// A7: content with no page of its own, shown on a shared page (as a home page's settings are).
describe('demo events-page singleton', () => {
  const type = demo.types.find((t) => t.name === 'events-page')!;
  const p: SiteEntry = { id: '00000000-0000-4000-8000-000000000002', type: 'events-page', slug: null, sortAt: null };
  const view = (present: boolean): ReleaseView => ({ entries: (t) => (t === 'events-page' && present ? [p] : []) });

  it('is a singleton with a site integration that has no path of its own', () => {
    expect(isSingleton(demo, 'events-page')).toBe(true);
    expect(demo.site['events-page']).toBeDefined();
    expect(demo.site['events-page']!.path).toBeUndefined();
  });

  it('is checked on the events page: present while published, absent once withdrawn, with no slug', () => {
    const s = demo.site['events-page']!;
    expect(s.checks(p, view(true), null)).toEqual([{ path: '/events', expect: 'present' }]);
    expect(s.checks(p, view(false), view(true))).toEqual([{ path: '/events', expect: 'absent' }]);
  });

  it('has no text title, so it never gets a slug, and requires only its introduction', () => {
    expect(type.queryColumns({ intro: 'Velkomin', featured: [] })).toEqual({ title: null, sortAt: null });
    const r = type.publishValidator().safeParse({});
    expect(r.success ? [] : r.error.issues.map((i) => i.path[0])).toEqual(['intro']);
  });
});

describe('demo notice type (schema evolution, M2-05)', () => {
  const notice = demo.types.find((t) => t.name === 'notice')!;

  it('is at version 2 with the transform 1 → 2', () => {
    expect(notice.version).toBe(2);
    expect(Object.keys(notice.transforms ?? {})).toEqual(['1']);
  });

  it('upcasts version 1 data (heading) to version 2 (title), which the publish validator accepts', () => {
    const v1 = { heading: 'Lokað á morgun' };
    const v2 = notice.upcast(v1, 1);
    expect(v2).toEqual({ title: 'Lokað á morgun' });
    expect(notice.publishValidator().safeParse(v2).success).toBe(true);
    expect(v1).toEqual({ heading: 'Lokað á morgun' });
  });

  it('orders by its date field, so sort_at (a timestamp) is never the title (M2-13)', () => {
    expect(notice.orderBy).toBe('date');
    expect(notice.queryColumns({ title: 'Lokað', date: '2026-11-04' })).toEqual({ title: 'Lokað', sortAt: '2026-11-04' });
  });

  it('version 1 data is not valid at version 2 without the upcast', () => {
    expect(notice.publishValidator().safeParse({ heading: 'x' }).success).toBe(false);
  });
});
