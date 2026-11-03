// Schema evolution core (spec §5.1 `version` and `transforms`, §5.3; plan M2-05).
import { describe, expect, it } from 'vitest';
import { DRAFT_OUTDATED, DRAFT_SCHEMA_AHEAD, UpcastError, defineType, extendType, text, upcast } from '../index.ts';

type Data = Record<string, unknown>;

/** v1 had `heading`; v2 renamed it to `title`; v3 added a required `kicker` with a default. */
const v3 = () =>
  defineType({
    name: 'notice',
    version: 3,
    label: 'Notice',
    fields: { title: text({ label: 'Title', required: true }), kicker: text({ label: 'Kicker', required: true }) },
    preview: { title: 'title' },
    orderBy: 'title',
    transforms: {
      1: (d) => {
        const { heading, ...rest } = d as Data;
        return { ...rest, title: heading };
      },
      2: (d) => ({ ...(d as Data), kicker: 'Tilkynning' }),
    },
  });

const deepFreeze = <T>(x: T): T => {
  if (x !== null && typeof x === 'object') {
    for (const v of Object.values(x)) deepFreeze(v);
    Object.freeze(x);
  }
  return x;
};

describe('upcast', () => {
  it('applies a chain of two transforms in order, n → n+1', () => {
    const calls: number[] = [];
    const t = defineType({
      name: 'c',
      version: 3,
      label: 'C',
      fields: { title: text({ label: 'T' }) },
      preview: { title: 'title' },
      orderBy: 'title',
      transforms: {
        2: (d) => (calls.push(2), { ...(d as Data), title: `${(d as Data).title}+2` }),
        1: (d) => (calls.push(1), { ...(d as Data), title: `${(d as Data).title}+1` }),
      },
    });
    expect(t.upcast({ title: 'a' }, 1)).toEqual({ title: 'a+1+2' });
    expect(calls).toEqual([1, 2]);
    expect(t.upcast({ title: 'b' }, 2)).toEqual({ title: 'b+2' });
  });

  it('turns version 1 data into data the current publish validator accepts', () => {
    const t = v3();
    const out = t.upcast({ heading: 'Lokað á morgun' }, 1);
    expect(out).toEqual({ title: 'Lokað á morgun', kicker: 'Tilkynning' });
    expect(t.publishValidator().safeParse(out).success).toBe(true);
  });

  it('returns current-version data unchanged, without running a transform', () => {
    const data = { title: 'x', kicker: 'y' };
    expect(v3().upcast(data, 3)).toBe(data);
  });

  it('never modifies the stored data, even when a transform mutates its input (revisions are never rewritten)', () => {
    const t = defineType({
      name: 'm',
      version: 2,
      label: 'M',
      fields: { title: text({ label: 'T' }) },
      preview: { title: 'title' },
      orderBy: 'title',
      transforms: {
        1: (d) => {
          const o = d as Data & { nested: { n: number } };
          o.nested.n += 1;
          o.title = 'changed';
          return o;
        },
      },
    });
    const stored = { title: 'orig', nested: { n: 1 } };
    const before = structuredClone(stored);
    expect(t.upcast(stored, 1)).toEqual({ title: 'changed', nested: { n: 2 } });
    expect(stored).toEqual(before);
    // A frozen (read-only) document upcasts too: the transform gets a copy.
    expect(t.upcast(deepFreeze(structuredClone(before)), 1)).toEqual({ title: 'changed', nested: { n: 2 } });
  });

  it('refuses a gap: a missing transform fails before any transform runs', () => {
    let ran = false;
    const t = defineType({
      name: 'g',
      version: 3,
      label: 'G',
      fields: { title: text({ label: 'T' }) },
      preview: { title: 'title' },
      orderBy: 'title',
      transforms: { 2: (d) => ((ran = true), d) },
    });
    const error = (() => {
      try {
        t.upcast({ title: 'x' }, 1);
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(UpcastError);
    expect(error).toMatchObject({ type: 'g', code: 'transform_missing', fromVersion: 1, toVersion: 3, atVersion: 1 });
    expect(ran).toBe(false);
    // From 2 the chain is complete.
    expect(t.upcast({ title: 'x' }, 2)).toEqual({ title: 'x' });
  });

  it('refuses data at a version newer than the type, and a version that is not a positive integer', () => {
    const t = v3();
    expect(() => t.upcast({}, 4)).toThrow(expect.objectContaining({ code: 'version_ahead', fromVersion: 4, toVersion: 3 }));
    for (const bad of [0, -1, 1.5, Number.NaN, '1' as unknown as number]) {
      expect(() => t.upcast({}, bad)).toThrow(expect.objectContaining({ code: 'version_invalid' }));
    }
  });

  it('wraps a throwing transform, and one that returns something other than an object', () => {
    const make = (fn: (d: unknown) => unknown) =>
      defineType({ name: 'f', version: 2, label: 'F', fields: { title: text({ label: 'T' }) }, preview: { title: 'title' }, orderBy: 'title', transforms: { 1: fn } });
    const boom = new Error('boom');
    expect(() =>
      make(() => {
        throw boom;
      }).upcast({}, 1),
    ).toThrow(expect.objectContaining({ code: 'transform_failed', atVersion: 1, cause: boom }));
    for (const result of [null, undefined, 'x', 1, ['a']]) {
      expect(() => make(() => result).upcast({}, 1)).toThrow(expect.objectContaining({ code: 'transform_failed', atVersion: 1 }));
    }
  });

  it('tolerates unknown keys on read; the validators strip them', () => {
    const t = v3();
    const out = t.upcast({ heading: 'H', legacy: { old: true } }, 1) as Data;
    expect(out.legacy).toEqual({ old: true });
    const parsed = t.publishValidator().safeParse(out);
    expect(parsed.success && parsed.data).toEqual({ title: 'H', kicker: 'Tilkynning' });
    const draft = t.draftValidator().safeParse(out);
    expect(draft.success && draft.data).toEqual({ title: 'H', kicker: 'Tilkynning' });
  });

  it('is also a standalone function over a type definition', () => {
    expect(upcast(v3(), { heading: 'H' }, 1)).toEqual({ title: 'H', kicker: 'Tilkynning' });
  });

  it('survives extendType', () => {
    const ext = extendType(v3(), { label: 'Tilkynning' });
    expect(ext.upcast({ heading: 'H' }, 1)).toEqual({ title: 'H', kicker: 'Tilkynning' });
  });
});

describe('defineType: version and transforms', () => {
  const base = { name: 'v', label: 'V', fields: { title: text({ label: 'T' }) }, preview: { title: 'title' as const }, orderBy: 'title' as const };

  it.each([0, -1, 1.5, Number.NaN])('refuses version %s', (version) => {
    expect(() => defineType({ ...base, version })).toThrow(/version/);
  });

  it.each([['0'], ['3'], ['4'], ['1.5'], ['01'], ['x']])('refuses a transform keyed %s on a version 3 type', (key) => {
    expect(() => defineType({ ...base, version: 3, transforms: { [key]: (d: unknown) => d } as Record<number, (d: unknown) => unknown> })).toThrow(/transform/);
  });

  it('refuses a transform that is not a function', () => {
    expect(() => defineType({ ...base, version: 2, transforms: { 1: 'nope' as unknown as (d: unknown) => unknown } })).toThrow(/transform/);
  });

  it('accepts no transforms, and transforms for some versions only (the gap is refused at upcast)', () => {
    expect(defineType({ ...base, version: 1 }).upcast({ title: 'a' }, 1)).toEqual({ title: 'a' });
    expect(() => defineType({ ...base, version: 3, transforms: { 2: (d: unknown) => d } })).not.toThrow();
  });
});

describe('named publish error codes', () => {
  it('are distinct, stable strings', () => {
    expect(DRAFT_OUTDATED).toBe('draft_outdated');
    expect(DRAFT_SCHEMA_AHEAD).toBe('draft_schema_ahead');
  });
});
