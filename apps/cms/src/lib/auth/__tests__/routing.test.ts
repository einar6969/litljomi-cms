import { describe, expect, it } from 'vitest';
import { isPublicPath, safeRedirectPath } from '../routing';

describe('safeRedirectPath (no open redirect)', () => {
  it.each(['/', '/t/acme', '/t/acme/news?x=1#top', '/t/acme/a-b_c.d~e', '/t/acme%0a'])('keeps the same-origin path %j', (path) => {
    expect(safeRedirectPath(path)).toBe(path);
  });

  it.each([
    null,
    undefined,
    '',
    't/acme',
    '//evil.example',
    '//evil.example/t/acme',
    '/\\evil.example',
    '\\\\evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    'https://evil.example/',
    'http://localhost:3100/t/acme',
    'javascript:alert(1)',
    '/t/acme\u0000',
    '/t/acme\u007f',
    '/t/acme ',
    '/ /evil.example',
  ])('falls back to / for %j', (value) => {
    expect(safeRedirectPath(value)).toBe('/');
  });
});

describe('isPublicPath', () => {
  it.each(['/login', '/auth/callback'])('%s is reachable without a session', (path) => {
    expect(isPublicPath(path)).toBe(true);
  });
  it.each(['/', '/t/acme', '/login/x', '/loginx', '/auth', '/auth/callback/x', '/auth/other'])('%s needs a session', (path) => {
    expect(isPublicPath(path)).toBe(false);
  });
});
