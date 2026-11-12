import { describe, expect, it } from 'vitest';
import { canonicalHttpsUrl, canonicalMediaUrl, isHttpsUrl, isRootRelativePath, loopbackHttpOrigin } from '../index.ts';

it('isRootRelativePath', () => {
  for (const ok of ['/', '/a', '/a/b?c=1#d']) expect(isRootRelativePath(ok)).toBe(true);
  for (const bad of ['', 'a', '//evil.com', '/\\evil.com', '/\t/evil.com', '/a b', '/a\nb', 'https://a.is', 'javascript:1'])
    expect(isRootRelativePath(bad)).toBe(false);
});
// Security review B2: dot segments that resolve to a protocol-relative path.
it('isRootRelativePath refuses a path that resolves to //host', () => {
  for (const bad of ['/.//evil.com', '/%2e//evil.com', '/%2E//evil.com', '/a/..//evil.com', '/././/evil.com/x'])
    expect(isRootRelativePath(bad), bad).toBe(false);
  for (const ok of ['/a//b', '/a/../b', '/%2e/b']) expect(isRootRelativePath(ok), ok).toBe(true);
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

// Enhancement A4: a local stack's media are http on the stack's own loopback address.
it('loopbackHttpOrigin is the origin of an http address on a loopback host, and null for anything else', () => {
  expect(loopbackHttpOrigin('http://127.0.0.1:54321')).toBe('http://127.0.0.1:54321');
  expect(loopbackHttpOrigin('http://127.0.0.1:54331/')).toBe('http://127.0.0.1:54331');
  expect(loopbackHttpOrigin('http://localhost:54321/storage/v1')).toBe('http://localhost:54321');
  expect(loopbackHttpOrigin('http://127.1.2.3')).toBe('http://127.1.2.3');
  expect(loopbackHttpOrigin('http://[::1]:54321')).toBe('http://[::1]:54321');
  for (const bad of [
    'https://127.0.0.1:54321',
    'https://abcdefghijklmnopqrst.supabase.co',
    'http://abcdefghijklmnopqrst.supabase.co',
    'http://example.com',
    'http://10.0.0.1:54321',
    'http://192.168.1.2',
    'http://0.0.0.0:54321',
    'http://128.0.0.1',
    'http://localhost.example.com',
    'http://127.0.0.1.example.com',
    'http://[::2]',
    'http://user:pw@127.0.0.1:54321',
    'http://u@localhost',
    ' http://127.0.0.1:54321',
    'http://127.0.0.1:54321/\n',
    '//127.0.0.1:54321',
    'ftp://127.0.0.1',
    '',
  ])
    expect(loopbackHttpOrigin(bad), bad).toBeNull();
});
describe('canonicalMediaUrl', () => {
  const LOCAL = 'http://127.0.0.1:54331';
  it('is canonicalHttpsUrl without a local origin: every http address is refused', () => {
    expect(canonicalMediaUrl('https:m.test/a.jpg', null)).toBe('https://m.test/a.jpg');
    for (const bad of ['http://127.0.0.1:54331/a.jpg', 'http://m.test/a.jpg', 'https://u:p@m.test/a.jpg', 'data:x', ''])
      expect(canonicalMediaUrl(bad, null), bad).toBeNull();
  });
  it('accepts https and, on a local stack, http on exactly its own origin, in canonical form', () => {
    expect(canonicalMediaUrl('https://m.test/a.jpg', LOCAL)).toBe('https://m.test/a.jpg');
    expect(canonicalMediaUrl(`${LOCAL}/storage/v1/object/public/media-public/demo/x/a.jpg`, LOCAL)).toBe(
      `${LOCAL}/storage/v1/object/public/media-public/demo/x/a.jpg`,
    );
    expect(canonicalMediaUrl('HTTP://127.0.0.1:54331/a b.jpg', LOCAL)).toBeNull();
    expect(canonicalMediaUrl('HTTP://127.0.0.1:54331/a%20b.jpg', LOCAL)).toBe(`${LOCAL}/a%20b.jpg`);
  });
  it('refuses http on another port, another loopback host or with credentials, on a local stack', () => {
    for (const bad of [
      'http://127.0.0.1:54321/a.jpg',
      'http://localhost:54331/a.jpg',
      'http://127.0.0.2:54331/a.jpg',
      'http://[::1]:54331/a.jpg',
      'http://user:pw@127.0.0.1:54331/a.jpg',
      'http://127.0.0.1:54331@evil.example/a.jpg',
    ])
      expect(canonicalMediaUrl(bad, LOCAL), bad).toBeNull();
  });
  it('refuses every non-loopback http address, whatever the local origin claims', () => {
    const hosts = ['http://example.com', 'http://abcdefghijklmnopqrst.supabase.co', 'http://10.0.0.1:54331', 'http://192.168.0.10', 'http://0.0.0.0:54331'];
    for (const origin of [...hosts, LOCAL, 'https://abcdefghijklmnopqrst.supabase.co', 'not a url', '']) {
      for (const host of hosts) expect(canonicalMediaUrl(`${host}/a.jpg`, origin), `${host} with ${origin}`).toBeNull();
    }
  });
  it('lets nothing http through when the local origin is not itself a loopback http origin', () => {
    for (const origin of ['https://127.0.0.1:54331', 'http://example.com', 'http://user@127.0.0.1:54331', ' http://127.0.0.1:54331'])
      expect(canonicalMediaUrl('http://127.0.0.1:54331/a.jpg', origin), origin).toBeNull();
  });
});
