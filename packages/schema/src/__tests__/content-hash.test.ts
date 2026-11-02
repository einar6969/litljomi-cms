import { describe, expect, it } from 'vitest';
import { canonicalJson, contentHash, defineType, image, projectEntry, text } from '../index.ts';
import { fakeCtx } from './helpers.ts';

const A = '11111111-1111-4111-8111-111111111111';
const asset = (url: string) => ({ id: A, url, width: 1, height: 1, mime: 'image/png', alt: '', focal: null });

describe('canonicalJson and contentHash', () => {
  it('canonical JSON sorts keys at every depth and hashes deterministically', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    expect(contentHash({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(
      '71669b868168f568bda0860b89ed77dabe80ad6cf7842eff8cafc1d81185ef9e',
    );
  });
  it('drops undefined in objects, keeps array order, no whitespace, escapes strings', () => {
    expect(canonicalJson({ a: undefined, b: null, c: 'é"\n' })).toBe('{"b":null,"c":"é\\"\\n"}');
    expect(canonicalJson([3, 1, undefined])).toBe('[3,1,null]');
    expect(canonicalJson({ B: 1, a: 2, 'é': 3 })).toBe('{"B":1,"a":2,"é":3}');
  });
  it('rejects values JSON cannot represent', () => {
    expect(() => canonicalJson(NaN)).toThrow();
    expect(() => canonicalJson({ a: () => 1 })).toThrow();
    expect(() => canonicalJson(10n)).toThrow();
  });
  it('hash is a lowercase hex sha-256', () => {
    expect(contentHash({})).toMatch(/^[0-9a-f]{64}$/);
  });
  it('hash changes when a resolved asset URL changes', () => {
    const t = defineType({
      name: 'p',
      version: 1,
      label: 'P',
      fields: { title: text({ label: 'T' }), pic: image({ label: 'I' }) },
      preview: { title: 'title' },
      orderBy: 'title',
    });
    const data = { title: 'x', pic: { _ref: A, _kind: 'asset', alt: 'a' } };
    const h = (url: string) => contentHash(projectEntry(t, data, fakeCtx({ assets: { [A]: asset(url) } })));
    expect(h('https://m.test/1.png')).toBe(h('https://m.test/1.png'));
    expect(h('https://m.test/1.png')).not.toBe(h('https://m.test/2.png'));
  });
});
