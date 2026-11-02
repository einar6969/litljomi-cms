import { expect, it } from 'vitest';
import { isHttpsUrl, isRootRelativePath } from '../index.ts';

it('isRootRelativePath', () => {
  for (const ok of ['/', '/a', '/a/b?c=1#d']) expect(isRootRelativePath(ok)).toBe(true);
  for (const bad of ['', 'a', '//evil.com', '/\\evil.com', '/\t/evil.com', '/a b', '/a\nb', 'https://a.is', 'javascript:1'])
    expect(isRootRelativePath(bad)).toBe(false);
});
it('isHttpsUrl', () => {
  expect(isHttpsUrl('https://m.test/a.jpg')).toBe(true);
  for (const bad of ['http://m.test', 'data:x', 'javascript:1', '//m.test', '/a', 'https://', ' https://m.test', 'https://m.test/\n', ''])
    expect(isHttpsUrl(bad)).toBe(false);
});
