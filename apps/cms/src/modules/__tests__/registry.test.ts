import { describe, expect, it } from 'vitest';
import { getModule, getType, modules } from '../registry';

describe('module registry', () => {
  it('registers labak and demo, once each', () => {
    expect(modules.map((m) => m.tenant).sort()).toEqual(['demo', 'labak']);
  });
  it('finds a module by its tenant slug', () => {
    expect(getModule('labak')?.tenant).toBe('labak');
    expect(getModule('demo')?.tenant).toBe('demo');
    expect(getModule('nope')).toBeUndefined();
  });
  it("returns labak's news type with its extra field secondaryImage", () => {
    const news = getType('labak', 'news');
    expect(news?.name).toBe('news');
    expect(news?.fields).toHaveProperty('secondaryImage');
  });
  it('returns undefined for a type the tenant does not have, or an unknown tenant', () => {
    expect(getType('demo', 'news')).toBeUndefined();
    expect(getType('demo', 'event')?.name).toBe('event');
    expect(getType('nope', 'news')).toBeUndefined();
  });
  it('does not resolve inherited object properties as tenants or types', () => {
    expect(getModule('constructor')).toBeUndefined();
    expect(getType('labak', 'constructor')).toBeUndefined();
  });
});
