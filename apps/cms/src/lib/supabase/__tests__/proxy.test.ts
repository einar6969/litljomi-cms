import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type CookieMethods = {
  getAll(): Array<{ name: string; value: string }>;
  setAll(c: Array<{ name: string; value: string; options: object }>, headers?: Record<string, string>): void;
};
const state = vi.hoisted(() => ({
  user: null as null | { id: string },
  accessToken: null as null | string,
  refresh: null as null | (() => void),
  cookies: null as null | CookieMethods,
  getSession: null as null | ReturnType<typeof vi.fn>,
}));
// The real cookie helpers (combineChunks and base64url), which session-expiry.ts reads the session with.
vi.mock('@supabase/ssr', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@supabase/ssr')>()),
  createServerClient: vi.fn((_url: string, _key: string, options: { cookies: CookieMethods }) => {
    state.cookies = options.cookies;
    state.getSession = vi.fn(async () => ({ data: { session: state.accessToken ? { access_token: state.accessToken } : null }, error: null }));
    return {
      auth: {
        getUser: vi.fn(async () => {
          state.refresh?.();
          return { data: { user: state.user }, error: state.user ? null : { status: 401 } };
        }),
        getSession: state.getSession,
      },
    };
  }),
}));

const { createServerClient } = await import('@supabase/ssr');
const { updateSession } = await import('../proxy');
const { SESSION_MAX_AGE } = await import('../session-cookies');
const { PASSWORD_STEP_COOKIE, encodePasswordStep } = await import('../../auth/password-step');
const { fetchWithoutRefresh } = await import('../no-refresh-fetch');

const ORIGIN = 'http://localhost:3100';
const request = (path: string, cookie = 'sb-access=old') => new NextRequest(`${ORIGIN}${path}`, { headers: { cookie } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test_value');
  state.user = null;
  state.accessToken = null;
  state.refresh = null;
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const LIBRARY_DEFAULTS = { path: '/', sameSite: 'lax', httpOnly: false, maxAge: 400 * 24 * 60 * 60 };

describe('updateSession', () => {
  it('uses the publishable key and the request cookies', async () => {
    state.user = { id: 'u' };
    await updateSession(request('/'));
    expect(createServerClient).toHaveBeenCalledWith('http://127.0.0.1:54321', 'sb_publishable_test_value', expect.objectContaining({ db: { schema: 'api' } }));
    expect(state.cookies!.getAll()).toEqual([{ name: 'sb-access', value: 'old' }]);
  });

  // R7: the CMS server never sends a refresh, so Auth's per-address limit never counts its address.
  it('gives the client the fetch that refuses refreshes', async () => {
    state.user = { id: 'u' };
    await updateSession(request('/'));
    expect(createServerClient).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({ global: { fetch: fetchWithoutRefresh } }));
  });

  it('lets a signed-in editor through, carrying refreshed session cookies and headers', async () => {
    state.user = { id: 'u' };
    state.refresh = () => state.cookies!.setAll([{ name: 'sb-access', value: 'new', options: { path: '/' } }], { 'cache-control': 'private, no-store' });
    const response = await updateSession(request('/t/acme'));
    expect(response.headers.get('location')).toBeNull();
    expect(response.cookies.get('sb-access')?.value).toBe('new');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('writes refreshed session cookies secure, same-site lax and bounded', async () => {
    state.user = { id: 'u' };
    state.refresh = () => state.cookies!.setAll([{ name: 'sb-access', value: 'new', options: LIBRARY_DEFAULTS }]);
    const cookie = (await updateSession(request('/t/acme'))).cookies.get('sb-access');
    expect(cookie).toMatchObject({ value: 'new', path: '/', sameSite: 'lax', secure: true, maxAge: SESSION_MAX_AGE });
    expect(cookie?.httpOnly).toBeFalsy();
  });

  it('keeps those flags on a redirect to /login', async () => {
    state.refresh = () => state.cookies!.setAll([{ name: 'sb-other', value: 'x', options: LIBRARY_DEFAULTS }]);
    const response = await updateSession(request('/t/acme'));
    expect(response.headers.get('location')).toBe(`${ORIGIN}/login`);
    expect(response.cookies.get('sb-other')).toMatchObject({ sameSite: 'lax', secure: true, maxAge: SESSION_MAX_AGE });
  });

  it('writes without secure when the CMS runs on local http', async () => {
    vi.stubEnv('CMS_PUBLIC_URL', ORIGIN);
    state.user = { id: 'u' };
    state.refresh = () => state.cookies!.setAll([{ name: 'sb-access', value: 'new', options: LIBRARY_DEFAULTS }]);
    expect((await updateSession(request('/t/acme'))).cookies.get('sb-access')?.secure).toBeFalsy();
  });

  it.each(['/', '/t/acme', '/t/acme/news'])('redirects %s to /login without a session', async (path) => {
    const response = await updateSession(request(path));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/login`);
  });

  // The browser re-sends a 307's POST with its action id to /login, where the sign-out is registered
  // (login/page.tsx), so an editor whose session expired can still sign out. Any other action finds
  // no action of its own there and does not run.
  it('sends a server action posted without a session on to /login as a 307', async () => {
    const post = new NextRequest(`${ORIGIN}/t/acme/news/1`, { method: 'POST', headers: { cookie: 'sb-access=old', 'next-action': 'an-action-id' } });
    const response = await updateSession(post);
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/login`);
  });

  it('keeps cookie changes (a cleared session) on the redirect', async () => {
    state.refresh = () => state.cookies!.setAll([{ name: 'sb-access', value: '', options: { path: '/', maxAge: 0 } }]);
    const response = await updateSession(request('/t/acme'));
    expect(response.headers.get('location')).toBe(`${ORIGIN}/login`);
    expect(response.cookies.get('sb-access')?.value).toBe('');
  });

  it.each(['/login', '/auth/confirm'])('lets %s through without a session', async (path) => {
    const response = await updateSession(request(path));
    expect(response.headers.get('location')).toBeNull();
  });

  // PW-03: after an invitation or reset link, the set-password page comes before any other page.
  describe('the set-password step', () => {
    const SESSION = '3f2b8c1e-5a4d-4e6f-9b0a-1c2d3e4f5a6b';
    const accessToken = (sessionId: string) => `h.${Buffer.from(JSON.stringify({ session_id: sessionId })).toString('base64url')}.s`;
    const step = encodePasswordStep({ sessionId: SESSION, next: '/t/acme/news' });
    const withStep = (path: string, value = step, method = 'GET') =>
      new NextRequest(`${ORIGIN}${path}`, { method, headers: { cookie: `sb-access=old; ${PASSWORD_STEP_COOKIE}=${encodeURIComponent(value)}` } });
    beforeEach(() => {
      state.user = { id: 'u' };
      state.accessToken = accessToken(SESSION);
    });

    it.each(['/', '/t/acme', '/t/acme/news/1', '/console', '/console/mfa', '/t/acme?x=1'])('sends %s to the set-password page while the step is the session\'s', async (path) => {
      const response = await updateSession(withStep(path));
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(`${ORIGIN}/auth/password`);
    });

    it('sends a server action posted from another page there too, so it does not run', async () => {
      const post = new NextRequest(`${ORIGIN}/t/acme/news/1`, {
        method: 'POST',
        headers: { cookie: `sb-access=old; ${PASSWORD_STEP_COOKIE}=${encodeURIComponent(step)}`, 'next-action': 'an-action-id' },
      });
      const response = await updateSession(post);
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(`${ORIGIN}/auth/password`);
    });

    it('keeps refreshed session cookies on that redirect', async () => {
      state.refresh = () => state.cookies!.setAll([{ name: 'sb-access', value: 'new', options: LIBRARY_DEFAULTS }]);
      const response = await updateSession(withStep('/t/acme'));
      expect(response.headers.get('location')).toBe(`${ORIGIN}/auth/password`);
      expect(response.cookies.get('sb-access')).toMatchObject({ value: 'new', sameSite: 'lax', maxAge: SESSION_MAX_AGE });
    });

    it.each(['/auth/password', '/login', '/login/forgot', '/auth/confirm'])('lets %s through', async (path) => {
      const response = await updateSession(withStep(path));
      expect(response.headers.get('location')).toBeNull();
      expect(response.cookies.get(PASSWORD_STEP_COOKIE)).toBeUndefined();
    });

    it.each([
      ['another session\'s, such as one before a password sign-in', encodePasswordStep({ sessionId: '9e8d7c6b-5a49-4382-a716-151413121110', next: '/' })],
      ['not one this code wrote', '{"sessionId":1}'],
    ])('removes a step that is %s, and serves the page', async (_case, value) => {
      const response = await updateSession(withStep('/t/acme', value));
      expect(response.headers.get('location')).toBeNull();
      expect(response.cookies.get(PASSWORD_STEP_COOKIE)).toMatchObject({ value: '', path: '/', maxAge: 0 });
    });

    it('reads no session when there is no step', async () => {
      const response = await updateSession(request('/t/acme'));
      expect(response.headers.get('location')).toBeNull();
      expect(state.getSession).not.toHaveBeenCalled();
    });

    it('sends a visitor without a session to /login, step or not, and leaves the step alone', async () => {
      state.user = null;
      const response = await updateSession(withStep('/auth/password'));
      expect(response.headers.get('location')).toBe(`${ORIGIN}/login`);
      expect(response.cookies.get(PASSWORD_STEP_COOKIE)).toBeUndefined();
    });
  });

  // R7: an expired session is refreshed in the browser, from the editor's own address, never here.
  describe('an expired session', () => {
    const SESSION_COOKIE = 'sb-127-auth-token';
    const base64url = (value: string) => Buffer.from(value).toString('base64url');
    const session = (exp: number) => {
      const accessToken = `h.${base64url(JSON.stringify({ exp, session_id: '3f2b8c1e-5a4d-4e6f-9b0a-1c2d3e4f5a6b' }))}.s`;
      return `${SESSION_COOKIE}=base64-${base64url(JSON.stringify({ access_token: accessToken, refresh_token: 'r', expires_at: exp, user: { id: 'u' } }))}`;
    };
    const nowS = () => Math.floor(Date.now() / 1000);
    const expired = () => session(nowS() - 60);
    const withCookie = (path: string, cookie: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
      new NextRequest(`${ORIGIN}${path}`, { method: init.method ?? 'GET', headers: { cookie, ...init.headers } });
    const refreshTo = (next: string) => `${ORIGIN}/auth/refresh?next=${encodeURIComponent(next)}`;

    it.each([
      ['/', '/'],
      ['/t/acme/news/1', '/t/acme/news/1'],
      ['/t/acme/news?q=frétt', '/t/acme/news?q=fr%C3%A9tt'],
      ['/console', '/console'],
      ['/auth/password', '/auth/password'],
      // The confirm page asks a visitor with a session before a link replaces it (M3-14), so it needs the session refreshed too.
      ['/auth/confirm?token_hash=abc&type=invite', '/auth/confirm?token_hash=abc&type=invite'],
    ])('sends a page navigation to %s to /auth/refresh, coming back to the same page', async (path, next) => {
      const response = await updateSession(withCookie(path, expired()));
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(refreshTo(next));
      expect(createServerClient).not.toHaveBeenCalled();
    });

    // A client-side navigation fetches the page with `_rsc`, a cache key of the router's; the full
    // load after the refresh must not carry it.
    it('drops the router\'s _rsc from the page it comes back to', async () => {
      const response = await updateSession(withCookie('/t/acme/news?q=1&_rsc=abc12', expired(), { headers: { rsc: '1' } }));
      expect(response.headers.get('location')).toBe(refreshTo('/t/acme/news?q=1'));
    });

    it('leaves the session cookies for the browser to refresh', async () => {
      const response = await updateSession(withCookie('/t/acme', expired()));
      expect(response.cookies.getAll()).toEqual([]);
    });

    it('keeps the set-password step for after the refresh', async () => {
      const cookie = `${expired()}; ${PASSWORD_STEP_COOKIE}=${encodeURIComponent(encodePasswordStep({ sessionId: '3f2b8c1e-5a4d-4e6f-9b0a-1c2d3e4f5a6b', next: '/' }))}`;
      const response = await updateSession(withCookie('/t/acme', cookie));
      expect(response.headers.get('location')).toBe(refreshTo('/t/acme'));
      expect(response.cookies.get(PASSWORD_STEP_COOKIE)).toBeUndefined();
    });

    it.each(['/login', '/login/forgot', '/auth/refresh?next=%2Ft%2Facme'])('lets a navigation to %s through as it is, with no refresh anywhere', async (path) => {
      const response = await updateSession(withCookie(path, expired()));
      expect(response.headers.get('location')).toBeNull();
      expect(response.cookies.getAll()).toEqual([]);
      expect(createServerClient).not.toHaveBeenCalled();
    });

    // Not a page navigation: the server cannot refresh, so the request counts as signed out. The
    // editor's own handling keeps the work (spec §4.4; e2e/session-expiry.spec.ts).
    it('sends a server action on to /login as a 307, as without a session', async () => {
      const response = await updateSession(withCookie('/t/acme/news/1', expired(), { method: 'POST', headers: { 'next-action': 'an-action-id' } }));
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(`${ORIGIN}/login`);
      expect(createServerClient).not.toHaveBeenCalled();
    });

    it.each(['/login', '/auth/confirm'])('lets a server action on %s through, where it counts as signed out', async (path) => {
      const response = await updateSession(withCookie(path, expired(), { method: 'POST', headers: { 'next-action': 'an-action-id' } }));
      expect(response.headers.get('location')).toBeNull();
      expect(createServerClient).not.toHaveBeenCalled();
    });

    it('checks a session that has not expired with Auth, as before', async () => {
      state.user = { id: 'u' };
      const response = await updateSession(withCookie('/t/acme', session(nowS() + 30)));
      expect(response.headers.get('location')).toBeNull();
      expect(createServerClient).toHaveBeenCalledOnce();
    });
  });
});
