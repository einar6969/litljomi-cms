import { describe, expect, it } from 'vitest';
import type { AnyFieldKind, ReleaseView, SiteEntry } from '@litljomi/cms-schema';
import fixture from '../../fixtures/event.json';
import demo from '../index.ts';

const event = demo.types.find((t) => t.name === 'event')!;
const e: SiteEntry = { id: '00000000-0000-4000-8000-000000000001', type: 'event', slug: 'opid-hus', sortAt: '2026-12-01' };
const release = (present: boolean): ReleaseView => ({ entries: (t) => (t === 'event' && present ? [e] : []) });

describe('demo module', () => {
  it('declares the tenant and exactly one type, event; there is no news type', () => {
    expect(demo.tenant).toBe('demo');
    expect(demo.types.map((t) => t.name)).toEqual(['event']);
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
  it('has an optional reference to another event (plan M2-04)', () => {
    const related = event.fields.related as AnyFieldKind & { to: readonly string[] };
    expect(related).toMatchObject({ kind: 'reference', required: false, to: ['event'] });
  });
  it('builds paths and checks', () => {
    const s = demo.site.event!;
    expect(s.path(e)).toBe('/events/opid-hus');
    expect(s.checks(e, release(true), null)).toEqual([
      { path: '/events/opid-hus', expect: 'present' },
      { path: '/events', expect: 'present' },
    ]);
    expect(s.checks(e, release(false), release(true)).map((c) => c.expect)).toEqual(['absent', 'absent']);
  });
  it('refuses to build a path for an entry without a slug', () => {
    const s = demo.site.event!;
    const noSlug: SiteEntry = { ...e, slug: null };
    expect(() => s.path(noSlug)).toThrow(/has no slug/);
    expect(() => s.checks(noSlug, release(true), null)).toThrow(/has no slug/);
  });
});
