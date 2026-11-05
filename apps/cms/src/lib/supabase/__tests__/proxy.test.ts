import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type CookieMethods = {
  getAll(): Array<{ name: string; value: string }>;
  setAll(c: Array<{ name: string; value: string; options: object }>, headers?: Record<string, string>): void;
};
const state = vi.hoisted(() => ({ user: null as null | { id: string }, refresh: null as null | (() => void), cookies: null as null | CookieMethods }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn((_url: string, _key: string, options: { cookies: CookieMethods }) => {
    state.cookies = options.cookies;
    return {
      auth: {
        getUser: vi.fn(async () => {
          state.refresh?.();
          return { data: { user: state.user }, error: state.user ? null : { status: 401 } };
        }),
      },
    };
  }),
}));

const { createServerClient } = await import('@supabase/ssr');
const { updateSession } = await import('../proxy');
const { SESSION_MAX_AGE } = await import('../session-cookies');

const ORIGIN = 'http://localhost:3100';
const request = (path: string, cookie = 'sb-access=old') => new NextRequest(`${ORIGIN}${path}`, { headers: { cookie } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test_value');
  state.user = null;
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
});
