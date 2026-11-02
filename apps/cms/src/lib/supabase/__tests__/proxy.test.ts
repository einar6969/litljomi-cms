import { beforeEach, describe, expect, it, vi } from 'vitest';
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

const ORIGIN = 'http://localhost:3100';
const request = (path: string, cookie = 'sb-access=old') => new NextRequest(`${ORIGIN}${path}`, { headers: { cookie } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test_value');
  state.user = null;
  state.refresh = null;
});

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
