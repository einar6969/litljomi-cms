import { describe, expect, it } from 'vitest';
import { isPublicPath, refreshesExpiredSession, safeRedirectPath } from '../routing';

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
    // Dot segments that resolve to a protocol-relative path (security review B2).
    '/.//evil.example',
    '/%2e//evil.example',
    '/%2E//evil.example',
    '/a/..//evil.example',
    '/././/evil.example/t/acme',
  ])('falls back to / for %j', (value) => {
    expect(safeRedirectPath(value)).toBe('/');
  });
});

describe('isPublicPath', () => {
  // /auth/refresh: where the browser refreshes an expired session (R7).
  it.each(['/login', '/login/forgot', '/auth/confirm', '/auth/refresh'])('%s is reachable without a session', (path) => {
    expect(isPublicPath(path)).toBe(true);
  });
  // The set-password page (PW-03) needs the session the link made.
  it.each(['/', '/t/acme', '/login/x', '/login/forgot/x', '/loginx', '/auth', '/auth/confirm/x', '/auth/callback', '/auth/other', '/auth/password', '/auth/refresh/x'])('%s needs a session', (path) => {
    expect(isPublicPath(path)).toBe(false);
  });
});

// R7: a page navigation with an expired session goes to /auth/refresh first, except to the pages that
// use no session; /login is where a failed refresh ends, so it cannot loop.
describe('refreshesExpiredSession', () => {
  it.each(['/', '/t/acme', '/console', '/auth/password', '/auth/confirm'])('%s: refreshed first', (path) => {
    expect(refreshesExpiredSession(path)).toBe(true);
  });
  it.each(['/login', '/login/forgot', '/auth/refresh'])('%s: not', (path) => {
    expect(refreshesExpiredSession(path)).toBe(false);
  });
});
