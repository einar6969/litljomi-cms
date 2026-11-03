// The demo site's preview route (spec §7.5; plan M3-12): draft mode only after a valid token of
// this site's tenant, then a redirect to the entry's path with the token in a cookie.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PREVIEW_COOKIE, signPreviewToken } from '@litljomi/cms-sdk';

const enable = vi.fn();
vi.mock('next/headers', () => ({ draftMode: async () => ({ enable, isEnabled: false }), cookies: async () => ({ get: () => undefined }) }));

const SECRET = 'p'.repeat(32);
const ENTRY = '0b1c2d3e-4f50-4617-8899-aabbccddeeff';
const token = (tenant = 'demo', secret = SECRET) =>
  signPreviewToken({ tenant, entry_id: ENTRY, draft_version: 2, exp: Math.floor(Date.now() / 1000) + 600 }, secret);
const get = async (query: string) => {
  const { GET } = await import('../route');
  return GET(new Request(`https://demo.test/api/cms/preview?${query}`));
};

beforeEach(() => {
  vi.stubEnv('CMS_TENANT', 'demo');
  vi.stubEnv('CMS_PREVIEW_SECRETS', ` ${'o'.repeat(32)} , ${SECRET} `);
  enable.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/cms/preview', () => {
  it('enables draft mode and redirects to the path with the token cookie', async () => {
    const t = token();
    const res = await get(`token=${t}&path=${encodeURIComponent('/events/x')}`);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('/events/x');
    expect(res.headers.get('set-cookie')).toContain(`${PREVIEW_COOKIE}=${t};`);
    expect(enable).toHaveBeenCalledTimes(1);
  });
  it('refuses another tenant’s token and a token of another secret, without draft mode', async () => {
    expect((await get(`token=${token('labak')}&path=/`)).status).toBe(401);
    expect((await get(`token=${token('demo', 'q'.repeat(32))}&path=/`)).status).toBe(401);
    expect(enable).not.toHaveBeenCalled();
  });
  it('a missing CMS_PREVIEW_SECRETS gives a plain 500', async () => {
    vi.stubEnv('CMS_PREVIEW_SECRETS', '');
    expect((await get(`token=${token()}&path=/`)).status).toBe(500);
    expect(enable).not.toHaveBeenCalled();
  });
});
