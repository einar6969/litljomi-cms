import { createChunks, stringToBase64URL } from '@supabase/ssr';
import { describe, expect, it } from 'vitest';
import { sessionCookieName, sessionHasExpired } from '../session-expiry';

const URL_ = 'http://127.0.0.1:54321';
const NOW = 1_800_000_000_000;
const NAME = 'sb-127-auth-token';

const base64url = (value: string) => Buffer.from(value).toString('base64url');
const token = (claims: Record<string, unknown>) => `${base64url('{"alg":"HS256"}')}.${base64url(JSON.stringify(claims))}.sig`;
const session = (accessToken: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ access_token: accessToken, refresh_token: 'r', expires_at: 1, user: { id: 'u' }, ...extra });
/** The session as @supabase/ssr writes it: `base64-` and base64url, in chunks when it is long. */
const cookies = (value: string, name = NAME) => createChunks(name, `base64-${stringToBase64URL(value)}`);

describe('sessionCookieName', () => {
  it.each([
    ['http://127.0.0.1:54321', 'sb-127-auth-token'],
    ['https://abcdefghijklmnop.supabase.co', 'sb-abcdefghijklmnop-auth-token'],
  ])('is supabase-js\'s storage key for %s', (url, name) => {
    expect(sessionCookieName(url)).toBe(name);
  });
});

describe('sessionHasExpired (R7)', () => {
  it('is true for a session whose access token\'s exp has passed', async () => {
    expect(await sessionHasExpired(cookies(session(token({ exp: NOW / 1000 - 1 }))), URL_, NOW)).toBe(true);
  });

  it('is true at the second the token expires', async () => {
    expect(await sessionHasExpired(cookies(session(token({ exp: NOW / 1000 }))), URL_, NOW)).toBe(true);
  });

  // auth-js refreshes within 90 s of expiry; the server's client refuses that (no-refresh-fetch.ts)
  // and keeps the session while its token is still good.
  it('is false for a token that has not expired, however near', async () => {
    expect(await sessionHasExpired(cookies(session(token({ exp: NOW / 1000 + 1 }))), URL_, NOW)).toBe(false);
  });

  it('reads a session written in several chunks', async () => {
    const long = session(token({ exp: NOW / 1000 - 1 }), { user: { id: 'u', padding: 'x'.repeat(8000) } });
    const chunks = cookies(long);
    expect(chunks.length).toBeGreaterThan(1);
    expect(await sessionHasExpired(chunks, URL_, NOW)).toBe(true);
  });

  it('reads a session written as plain JSON', async () => {
    expect(await sessionHasExpired([{ name: NAME, value: session(token({ exp: NOW / 1000 - 1 })) }], URL_, NOW)).toBe(true);
  });

  it.each([
    ['no cookies', []],
    ['another project\'s session', cookies(session(token({ exp: 1 })), 'sb-other-auth-token')],
    ['a cookie that is not JSON', [{ name: NAME, value: 'base64-bm90IGpzb24' }]],
    ['a session without an access token', cookies(JSON.stringify({ refresh_token: 'r' }))],
    ['an access token that is not a JWT', cookies(session('not-a-jwt'))],
    ['a token without exp', cookies(session(token({ sub: 'u' })))],
    ['a token whose exp is not a number', cookies(session(token({ exp: '1' })))],
  ])('is false for %s, which goes on as today (Auth checks it)', async (_case, given) => {
    expect(await sessionHasExpired(given, URL_, NOW)).toBe(false);
  });
});
