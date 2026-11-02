import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({ fake: 'admin' })) }));

const { createClient } = await import('@supabase/supabase-js');
const { createAdminClient } = await import('../admin-client');

const URL_ = 'http://127.0.0.1:54321';
const SECRET = 'sb_secret_test_value';

beforeEach(() => {
  vi.mocked(createClient).mockClear();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', URL_);
  vi.stubEnv('SUPABASE_SECRET_KEY', SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('createAdminClient', () => {
  it('uses the secret key and the api schema, without a persisted session', () => {
    expect(createAdminClient()).toEqual({ fake: 'admin' });
    expect(createClient).toHaveBeenCalledExactlyOnceWith(URL_, SECRET, {
      db: { schema: 'api' },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  });
  it.each(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SECRET_KEY'])('throws, naming the variable, when %s is not set', (name) => {
    vi.stubEnv(name, '');
    expect(() => createAdminClient()).toThrow(name);
    expect(createClient).not.toHaveBeenCalled();
  });
  it('never puts the secret in an error message', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    expect(() => createAdminClient()).toThrow(expect.objectContaining({ message: expect.not.stringContaining(SECRET) }));
  });
});
