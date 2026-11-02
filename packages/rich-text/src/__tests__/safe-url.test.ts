import { expect, it } from 'vitest';
import { canonicalHttpsUrl, isHttpsUrl, isRootRelativePath } from '../index.ts';

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
// Deferred Minors (Task 15 security r1; C1 cleanup security r1): resolver URLs with credentials are
// refused, and an accepted URL is delivered in its canonical form, so `https:m.test/a` (which a
// browser would resolve against the page as a relative path) is never delivered raw.
it('isHttpsUrl refuses credentials', () => {
  for (const bad of ['https://user:pw@m.test/a.jpg', 'https://user@m.test/a.jpg', 'https://:pw@m.test/a.jpg'])
    expect(isHttpsUrl(bad)).toBe(false);
});
it('canonicalHttpsUrl returns the URL as new URL(s).href, or null', () => {
  expect(canonicalHttpsUrl('https:m.test/a.jpg')).toBe('https://m.test/a.jpg');
  expect(canonicalHttpsUrl('https:/m.test/a.jpg')).toBe('https://m.test/a.jpg');
  expect(canonicalHttpsUrl('HTTPS://M.TEST/a.jpg')).toBe('https://m.test/a.jpg');
  expect(canonicalHttpsUrl('https://m.test/a.jpg')).toBe('https://m.test/a.jpg');
  for (const bad of ['http://m.test', 'https://user:pw@m.test/a.jpg', ' https://m.test', 'https://', ''])
    expect(canonicalHttpsUrl(bad)).toBeNull();
});
