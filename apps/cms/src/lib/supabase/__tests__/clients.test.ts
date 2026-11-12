import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cookieStore = {
  getAll: vi.fn(() => [{ name: 'sb', value: 'v' }]),
  set: vi.fn(),
};
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => cookieStore) }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({ fake: 'server' })),
  createBrowserClient: vi.fn(() => ({ fake: 'browser' })),
}));

const { createBrowserClient, createServerClient } = await import('@supabase/ssr');
const { createDetachedClient, createEditorClient } = await import('../server');
const { fetchWithoutRefresh } = await import('../no-refresh-fetch');
const { createBrowserEditorClient } = await import('../browser');
const { SESSION_MAX_AGE } = await import('../session-cookies');

const URL_ = 'http://127.0.0.1:54321';
const PUBLISHABLE = 'sb_publishable_test_value';

type CookieOptions = {
  cookies: { getAll(): unknown; setAll(c: Array<{ name: string; value: string; options: object }>): void };
};
const serverOptions = () => vi.mocked(createServerClient).mock.calls[0]![2] as unknown as CookieOptions;
const browserOptions = () => vi.mocked(createBrowserClient).mock.calls[0]![2] as unknown as CookieOptions;

/** A stand-in for the browser's `document` and `location`, recording what is written to the cookie. */
function stubBrowser(protocol: 'https:' | 'http:', cookie = '') {
  const written: string[] = [];
  vi.stubGlobal('location', { protocol });
  vi.stubGlobal('document', {
    get cookie() {
      return cookie;
    },
    set cookie(value: string) {
      written.push(value);
    },
  });
  return written;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', URL_);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', PUBLISHABLE);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('createEditorClient', () => {
  it('uses the publishable key, the api schema and the request cookies', async () => {
    expect(await createEditorClient()).toEqual({ fake: 'server' });
    expect(createServerClient).toHaveBeenCalledExactlyOnceWith(
      URL_,
      PUBLISHABLE,
      expect.objectContaining({ db: { schema: 'api' } }),
    );
    const { cookies } = serverOptions();
    expect(cookies.getAll()).toEqual([{ name: 'sb', value: 'v' }]);
  });
  // R7: the CMS server never sends a refresh; the browser refreshes from the editor's own address.
  it('gives the client the fetch that refuses refreshes', async () => {
    await createEditorClient();
    expect(createServerClient).toHaveBeenCalledWith(URL_, PUBLISHABLE, expect.objectContaining({ global: { fetch: fetchWithoutRefresh } }));
  });
  // @supabase/ssr writes 400 days whatever `cookieOptions` says, so the bound is applied in setAll.
  it('writes the session cookies secure, same-site lax and bounded', async () => {
    await createEditorClient();
    serverOptions().cookies.setAll([{ name: 'sb', value: 'w', options: { path: '/', sameSite: 'lax', httpOnly: false, maxAge: 400 * 24 * 60 * 60 } }]);
    expect(cookieStore.set).toHaveBeenCalledExactlyOnceWith('sb', 'w', { path: '/', sameSite: 'lax', httpOnly: false, secure: true, maxAge: SESSION_MAX_AGE });
  });
  it('writes them without secure when the CMS runs on local http, and removals stay removals', async () => {
    vi.stubEnv('CMS_PUBLIC_URL', 'http://localhost:3100');
    await createEditorClient();
    serverOptions().cookies.setAll([{ name: 'sb', value: '', options: { path: '/', maxAge: 0 } }]);
    expect(cookieStore.set).toHaveBeenCalledExactlyOnceWith('sb', '', { path: '/', sameSite: 'lax', secure: false, maxAge: 0 });
  });
  it('ignores the error a Server Component raises when it sets cookies', async () => {
    await createEditorClient();
    cookieStore.set.mockImplementationOnce(() => {
      throw new Error('Cookies can only be modified in a Server Action or Route Handler');
    });
    expect(() => serverOptions().cookies.setAll([{ name: 'sb', value: 'w', options: {} }])).not.toThrow();
  });
  it.each(['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'])('throws, naming the variable, when %s is not set', async (name) => {
    vi.stubEnv(name, '');
    await expect(createEditorClient()).rejects.toThrow(name);
    expect(createServerClient).not.toHaveBeenCalled();
  });
});

describe('createDetachedClient', () => {
  it('uses the publishable key and no cookies, and refuses refreshes as well', () => {
    createDetachedClient();
    expect(createServerClient).toHaveBeenCalledExactlyOnceWith(
      URL_,
      PUBLISHABLE,
      expect.objectContaining({ db: { schema: 'api' }, global: { fetch: fetchWithoutRefresh } }),
    );
    expect(serverOptions().cookies.getAll()).toEqual([]);
  });
});

describe('createBrowserEditorClient', () => {
  it('uses the publishable key and the api schema', () => {
    expect(createBrowserEditorClient()).toEqual({ fake: 'browser' });
    expect(createBrowserClient).toHaveBeenCalledExactlyOnceWith(URL_, PUBLISHABLE, expect.objectContaining({ db: { schema: 'api' } }));
  });
  it('reads the session from document.cookie', () => {
    stubBrowser('https:', 'sb=v');
    createBrowserEditorClient();
    expect(browserOptions().cookies.getAll()).toEqual([{ name: 'sb', value: 'v' }]);
  });
  // A token the browser client refreshes must not come back with the 400 days or without Secure.
  it('writes a refreshed session secure, same-site lax and bounded on https', () => {
    const written = stubBrowser('https:');
    createBrowserEditorClient();
    browserOptions().cookies.setAll([{ name: 'sb', value: 'w', options: { path: '/', sameSite: 'lax', httpOnly: false, maxAge: 400 * 24 * 60 * 60 } }]);
    expect(written).toEqual([`sb=w; Path=/; Max-Age=${SESSION_MAX_AGE}; SameSite=Lax; Secure`]);
  });
  it('writes without Secure on local http', () => {
    const written = stubBrowser('http:');
    createBrowserEditorClient();
    browserOptions().cookies.setAll([{ name: 'sb', value: 'w', options: { path: '/', maxAge: 400 * 24 * 60 * 60 } }]);
    expect(written).toEqual([`sb=w; Path=/; Max-Age=${SESSION_MAX_AGE}; SameSite=Lax`]);
  });
});
