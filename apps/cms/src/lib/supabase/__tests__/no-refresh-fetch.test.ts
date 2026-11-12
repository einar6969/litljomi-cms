import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithoutRefresh } from '../no-refresh-fetch';

const AUTH = 'http://127.0.0.1:54321/auth/v1';
const passedOn = new Response('{}', { status: 200 });
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn(async () => passedOn);
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchWithoutRefresh (R7)', () => {
  it.each([
    ['a string', `${AUTH}/token?grant_type=refresh_token`],
    ['a URL', new URL(`${AUTH}/token?grant_type=refresh_token`)],
    ['a Request', new Request(`${AUTH}/token?grant_type=refresh_token`, { method: 'POST' })],
  ])('refuses a refresh given as %s, without calling Auth', async (_case, input) => {
    const response = await fetchWithoutRefresh(input, { method: 'POST', body: '{"refresh_token":"r"}' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
  });

  // As GoTrue v2.197.0 answers a refresh token it does not know, to a client that sends
  // X-Supabase-Api-Version 2024-01-01 (auth-js does): auth-js reads the code from the body and treats
  // it as a final refusal, not a network failure to retry.
  it('answers as Auth does for an unknown refresh token', async () => {
    const response = await fetchWithoutRefresh(`${AUTH}/token?grant_type=refresh_token`, { method: 'POST' });
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('x-supabase-api-version')).toBe('2024-01-01');
    expect(response.headers.get('x-sb-error-code')).toBe('refresh_token_not_found');
    expect(await response.json()).toEqual({ code: 'refresh_token_not_found', message: 'Invalid Refresh Token: Refresh Token Not Found' });
  });

  it('makes auth-js treat the session as gone: a final error, not one to retry', async () => {
    const { isAuthRetryableFetchError } = await import('@supabase/supabase-js');
    const { createClient } = await import('@supabase/supabase-js');
    const client = createClient('http://127.0.0.1:54321', 'sb_publishable_test_value', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchWithoutRefresh },
    });
    const { data, error } = await client.auth.refreshSession({ refresh_token: 'r' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(data.session).toBeNull();
    expect(error).toMatchObject({ status: 400, code: 'refresh_token_not_found' });
    expect(isAuthRetryableFetchError(error)).toBe(false);
  });

  it.each([
    ['the user', `${AUTH}/user`, undefined],
    ['a password sign-in', `${AUTH}/token?grant_type=password`, { method: 'POST' }],
    ['a sign-out', `${AUTH}/logout?scope=local`, { method: 'POST' }],
    ['the Data API', 'http://127.0.0.1:54321/rest/v1/rpc/my_tenants', { method: 'POST' }],
  ])('passes %s on to fetch unchanged', async (_case, input, init) => {
    expect(await fetchWithoutRefresh(input, init)).toBe(passedOn);
    expect(fetchSpy).toHaveBeenCalledExactlyOnceWith(input, init);
  });
});
