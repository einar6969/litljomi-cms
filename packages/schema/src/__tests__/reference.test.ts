import { describe, expect, it } from 'vitest';
import { fakeCtx } from './helpers.ts';
import {
  ProjectionError,
  defineType,
  entryContentHash,
  extendType,
  generateDeliveryTypes,
  projectEntry,
  reference,
  text,
  type EntrySummary,
} from '../index.ts';

const E = '22222222-2222-4222-8222-222222222222';
const F = '44444444-4444-4444-8444-444444444444';

const summary = (o: Partial<EntrySummary> = {}): EntrySummary => ({
  id: E,
  type: 'event',
  slug: 'opid-hus',
  title: 'Opið hús',
  path: '/events/opid-hus',
  ...o,
});

const t = defineType({
  name: 'article',
  version: 1,
  label: 'Grein',
  fields: {
    title: text({ label: 'Titill', required: true }),
    related: reference({ label: 'Tengt', to: ['event', 'news'] }),
    main: reference({ label: 'Aðal', to: ['event'], required: true }),
  },
  preview: { title: 'title' },
  orderBy: 'title',
});

const ref = (id: string) => ({ _ref: id, _kind: 'entry' });

describe('reference: definition', () => {
  it('exposes its kind, label, required flag and target types', () => {
    const f = reference({ label: 'R', to: ['event'] });
    expect(f.kind).toBe('reference');
    expect(f.label).toBe('R');
    expect(f.required).toBe(false);
    expect(f.to).toEqual(['event']);
  });
  it('refuses an empty or malformed target list', () => {
    expect(() => reference({ label: 'R', to: [] })).toThrow(/at least one/);
    expect(() => reference({ label: 'R', to: ['Event'] })).toThrow(/"Event"/);
    expect(() => reference({ label: 'R', to: ['event', 'event'] })).toThrow(/duplicate/);
  });
  it('keeps its own copy of the target list', () => {
    const to = ['event'];
    const f = reference({ label: 'R', to });
    to.push('news');
    expect(f.to).toEqual(['event']);
    expect(Object.isFrozen(f.to)).toBe(true);
  });
  it('withOptions keeps the kind and targets and changes label and required', () => {
    const f = reference({ label: 'R', to: ['event'] }).withOptions({ label: 'S', required: true });
    expect(f).toMatchObject({ kind: 'reference', label: 'S', required: true, to: ['event'] });
    const u = extendType(t, { fieldOverrides: { related: { required: true } } });
    expect(u.fields.related).toMatchObject({ kind: 'reference', required: true, to: ['event', 'news'] });
  });
});

describe('reference: validation', () => {
  const f = reference({ label: 'R', to: ['event'] });
  const req = reference({ label: 'R', to: ['event'], required: true });

  it('stores the standard `_ref` shape (spec §4.3)', () => {
    expect(f.publishSchema().safeParse(ref(E)).success).toBe(true);
    expect(f.draftSchema().safeParse(ref(E)).success).toBe(true);
  });
  it('refuses wrong kinds, non-canonical ids, extra keys and other shapes, in drafts too', () => {
    for (const bad of [
      { _ref: E, _kind: 'asset' },
      { _ref: 'ABCDEF12-2222-4222-8222-222222222222', _kind: 'entry' },
      { _ref: 'not-a-uuid', _kind: 'entry' },
      { _ref: E },
      { _ref: E, _kind: 'entry', type: 'event' },
      { entry: ref(E) },
      E,
      42,
    ]) {
      expect(f.draftSchema().safeParse(bad).success, JSON.stringify(bad)).toBe(false);
      expect(f.publishSchema().safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
  it('draft accepts an empty required reference; publish refuses it', () => {
    expect(req.draftSchema().safeParse(null).success).toBe(true);
    expect(req.draftSchema().safeParse(undefined).success).toBe(true);
    expect(req.publishSchema().safeParse(null).success).toBe(false);
    expect(req.publishSchema().safeParse(undefined).success).toBe(false);
    expect(f.publishSchema().safeParse(null).success).toBe(true);
  });
});

describe('reference: projection', () => {
  const data = { title: 'Halló', related: ref(F), main: ref(E) };
  const ctx = fakeCtx({ entries: { [E]: summary(), [F]: summary({ id: F, type: 'news', slug: 'frett', path: '/frettir/frett' }) } });

  it('resolves to the target summary through the projection context', () => {
    expect(projectEntry(t, data, ctx)).toEqual({
      title: 'Halló',
      related: summary({ id: F, type: 'news', slug: 'frett', path: '/frettir/frett' }),
      main: summary(),
    });
  });
  it('resolves to null when the target is not published (or unknown, or left out of the release)', () => {
    expect(projectEntry(t, data, fakeCtx({ entries: { [E]: summary() } })).related).toBeNull();
    expect(projectEntry(t, data, fakeCtx({})).main).toBeNull();
  });
  it('an absent optional reference projects as null', () => {
    expect(projectEntry(t, { title: 'Halló', main: ref(E) }, ctx).related).toBeNull();
  });
  it('keeps only the summary fields and drops a path that is not root-relative', () => {
    const odd = { ...summary({ path: '//evil.test/x' }), extra: 'internal' } as EntrySummary;
    expect(projectEntry(t, { title: 'Halló', main: ref(E) }, fakeCtx({ entries: { [E]: odd } })).main).toEqual(summary({ path: null }));
  });
  it('refuses a target of a type the field does not allow, naming the field', () => {
    const wrong = fakeCtx({ entries: { [E]: summary({ type: 'news' }) } });
    let error: unknown;
    try {
      projectEntry(t, { title: 'Halló', main: ref(E) }, wrong);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ProjectionError);
    const issues = (error as ProjectionError).issues;
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'custom', path: ['main', '_ref'] });
    expect(issues[0]!.message).toMatch(/"news".*event/);
    expect((error as Error).message).toMatch(/^cannot project article: main\._ref: /);
  });
  it('the content hash is stable under key order and changes with the resolved summary', () => {
    const a = projectEntry(t, data, ctx);
    const b = projectEntry(t, { main: { _kind: 'entry', _ref: E }, related: { _kind: 'entry', _ref: F }, title: 'Halló' }, ctx);
    const c = projectEntry(t, data, fakeCtx({ entries: { [E]: summary({ title: 'Nýtt heiti' }), [F]: summary({ id: F, type: 'news' }) } }));
    const hash = (d: Record<string, unknown>) => entryContentHash({ id: 'x', data: d });
    expect(hash(a)).toBe(hash(b));
    expect(hash(a)).not.toBe(hash(c));
  });
});

describe('reference: delivery types', () => {
  it('marks the reference nullable', () => {
    expect(reference({ label: 'R', to: ['event'] }).tsType()).toBe('EntrySummary | null');
    const out = generateDeliveryTypes([t]);
    expect(out).toContain('  related: EntrySummary | null;');
    expect(out).toContain('  main: EntrySummary | null;');
  });
});
