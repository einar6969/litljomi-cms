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
const { createEditorClient } = await import('../server');
const { createBrowserEditorClient } = await import('../browser');

const URL_ = 'http://127.0.0.1:54321';
const PUBLISHABLE = 'sb_publishable_test_value';

type CookieOptions = {
  cookies: { getAll(): unknown; setAll(c: Array<{ name: string; value: string; options: object }>): void };
};
const serverOptions = () => vi.mocked(createServerClient).mock.calls[0]![2] as unknown as CookieOptions;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', URL_);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', PUBLISHABLE);
});
afterEach(() => {
  vi.unstubAllEnvs();
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
    cookies.setAll([{ name: 'sb', value: 'w', options: { path: '/' } }]);
    expect(cookieStore.set).toHaveBeenCalledWith('sb', 'w', { path: '/' });
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

describe('createBrowserEditorClient', () => {
  it('uses the publishable key and the api schema', () => {
    expect(createBrowserEditorClient()).toEqual({ fake: 'browser' });
    expect(createBrowserClient).toHaveBeenCalledExactlyOnceWith(URL_, PUBLISHABLE, { db: { schema: 'api' } });
  });
});
