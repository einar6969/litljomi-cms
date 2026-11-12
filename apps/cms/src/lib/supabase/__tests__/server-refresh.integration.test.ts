// R7 against the local stack's Auth: the CMS server never refreshes a session. A request carrying a
// forged session cookie (a well-formed JWT past its `exp` and a junk refresh token) used to make the
// proxy's getUser refresh it from the CMS server (POST /auth/v1/token?grant_type=refresh_token), and
// that counts against Auth's per-address limit, shared with password sign-in (decision 72.4), for the
// server's address: one visitor could use it up for every editor (M5 finding 7). The browser
// refreshes instead, from the editor's own address (/auth/refresh, lib/supabase/proxy.ts).
//
// The real @supabase/ssr and auth-js, as the proxy runs them; every request they send goes through
// the global fetch, which the test watches.
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { env } from '../../../../../../tests/integration/src/env.ts';

const { updateSession } = await import('../proxy');

const CMS = 'http://localhost:3100';
const NOW_S = () => Math.floor(Date.now() / 1000);
// supabase-js's default storage key, which @supabase/ssr names the session cookie after.
const COOKIE = `sb-${new URL(env.apiUrl).hostname.split('.')[0]}-auth-token`;

const base64url = (value: string) => Buffer.from(value).toString('base64url');
const jwt = (claims: Record<string, unknown>) =>
  `${base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${base64url(JSON.stringify(claims))}.${base64url('not a signature')}`;

/**
 * A forged session cookie, as @supabase/ssr writes one: an access token that expires at `exp` (never
 * signed by Auth), a refresh token Auth has never issued, and the session's stored expiry.
 */
function forgedSession({ exp, expiresAt = exp }: { exp: number; expiresAt?: number }): string {
  const user = { id: randomUUID(), aud: 'authenticated', role: 'authenticated' };
  const session = {
    access_token: jwt({ sub: user.id, session_id: randomUUID(), role: 'authenticated', aal: 'aal1', exp }),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    refresh_token: 'forgedrefresh',
    user,
  };
  return `${COOKIE}=base64-${base64url(JSON.stringify(session))}`;
}

let fetchSpy: MockInstance<typeof fetch>;
const urlOf = (input: unknown) => new URL(input instanceof Request ? input.url : String(input));
/** The refresh requests sent from this process (the CMS server), to Auth or anywhere. */
const refreshes = () => fetchSpy.mock.calls.filter(([input]) => urlOf(input).searchParams.get('grant_type') === 'refresh_token');

beforeAll(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', env.apiUrl);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', env.publishableKey);
});
beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(() => {
  vi.unstubAllEnvs();
});

describe('R7: the CMS server never refreshes a session', () => {
  it('a page navigation with an expired session sends no refresh, and goes to /auth/refresh to refresh in the browser', async () => {
    const request = new NextRequest(`${CMS}/t/acme/news?q=1`, { headers: { cookie: forgedSession({ exp: NOW_S() - 60 }) } });
    const response = await updateSession(request);
    expect(refreshes()).toEqual([]);
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`${CMS}/auth/refresh?next=${encodeURIComponent('/t/acme/news?q=1')}`);
  });

  it('a server action with an expired session sends no refresh, and counts as signed out', async () => {
    const request = new NextRequest(`${CMS}/t/acme/news/1`, {
      method: 'POST',
      headers: { cookie: forgedSession({ exp: NOW_S() - 60 }), 'next-action': 'an-action-id' },
    });
    const response = await updateSession(request);
    expect(refreshes()).toEqual([]);
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`${CMS}/login`);
  });

  // The proxy reads the token's `exp`; auth-js refreshes by the session's stored expiry. Where they
  // disagree, the server's client refuses the refresh itself (lib/supabase/no-refresh-fetch.ts).
  it('a session whose stored expiry has passed, though its token\'s has not, sends no refresh either, and counts as signed out', async () => {
    const request = new NextRequest(`${CMS}/t/acme`, { headers: { cookie: forgedSession({ exp: NOW_S() + 3600, expiresAt: NOW_S() - 60 }) } });
    const response = await updateSession(request);
    expect(refreshes()).toEqual([]);
    expect(response.headers.get('location')).toBe(`${CMS}/login`);
  });
});
