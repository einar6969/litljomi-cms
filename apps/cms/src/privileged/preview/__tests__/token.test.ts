import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PREVIEW_TOKEN_TTL_SECONDS, verifyPreviewToken } from '@litljomi/cms-sdk';
import type { SupabaseClient } from '@/lib/supabase/types';
import { handlePreviewTokenRequest, mintPreviewToken, type MintDeps } from '../token';

// The token route's logic with fake clients (spec §7.5, plan M3-10). The real session, RLS and
// Vault are exercised by preview-token.integration.test.ts on the local stack.

const NOW = 1_800_000_000;
const ENTRY = '0b5d4c1e-2f3a-4b5c-8d7e-9f0a1b2c3d4e';
const TENANT = '00000000-0000-4000-8000-00000000a002';
const SITE = '00000000-0000-4000-8000-00000000c001';
const SITE2 = '00000000-0000-4000-8000-00000000c002';
// Test values only, each 32 characters or more (MIN_PREVIEW_SECRET_LENGTH).
const SECRET = 'preview-secret-of-the-site-0123456789';
const A_SECRET = 'a-secret-of-the-first-site-0123456789';
const B_SECRET = 'b-secret-of-the-second-site-0123456789';

type Row = Record<string, unknown> | null;
type State = {
  user: unknown;
  userError: unknown;
  entry: { data: Row; error: { code: string } | null; status?: number };
  tenant: { data: Row; error: { code: string } | null; status?: number };
  sites: { data: unknown[] | null; error: { code: string } | null };
  calls: string[];
};
let state: State;

function fakes(): MintDeps {
  const query = (table: string) => {
    const filters: [string, unknown][] = [];
    const q = {
      select: () => q,
      eq: (col: string, v: unknown) => {
        filters.push([col, v]);
        return q;
      },
      maybeSingle: async () => {
        state.calls.push(`${table}:${filters.map(([c, v]) => `${c}=${String(v)}`).join(',')}`);
        return table === 'entry_list' ? state.entry : state.tenant;
      },
    };
    return q;
  };
  const editor = {
    auth: { getUser: async () => ({ data: { user: state.user }, error: state.userError }) },
    schema: (s: string) => {
      expect(s).toBe('api');
      return { from: query };
    },
  } as unknown as SupabaseClient;
  const admin = {
    schema: (s: string) => {
      expect(s).toBe('api');
      return {
        rpc: async (fn: string, args: Record<string, unknown>) => {
          state.calls.push(`${fn}:${String(args.p_tenant_id)}`);
          return state.sites;
        },
      };
    },
  } as unknown as SupabaseClient;
  return { editor, admin, nowSeconds: () => NOW + 0.7 };
}

beforeEach(() => {
  state = {
    user: { id: 'u1' },
    userError: null,
    entry: { data: { id: ENTRY, tenant_id: TENANT, type: 'event', slug: 'tonleikar', sort_at: null, draft_version: 4 }, error: null },
    tenant: { data: { id: TENANT, slug: 'demo', status: 'active' }, error: null },
    sites: { data: [{ id: SITE, preview_url: 'https://demo.example/api/cms/preview', preview_secret: SECRET }], error: null },
    calls: [],
  };
});
afterEach(() => vi.restoreAllMocks());

describe('mintPreviewToken', () => {
  it('mints {tenant, entry_id, draft_version, exp} with the site secret, valid 10 minutes', async () => {
    const r = await mintPreviewToken(fakes(), { entryId: ENTRY });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.expiresAt).toBe(NOW + PREVIEW_TOKEN_TTL_SECONDS);
    expect(verifyPreviewToken({ token: r.token, secrets: [SECRET], nowSeconds: NOW })).toEqual({
      tenant: 'demo',
      entry_id: ENTRY,
      draft_version: 4,
      exp: NOW + 600,
    });
    expect(verifyPreviewToken({ token: r.token, secrets: ['other'], nowSeconds: NOW })).toBeNull();
    const url = new URL(r.url);
    expect(url.origin + url.pathname).toBe('https://demo.example/api/cms/preview');
    expect(url.searchParams.get('token')).toBe(r.token);
  });

  it("adds the entry's path from the module's site.path (M3-12)", async () => {
    const r = await mintPreviewToken(fakes(), { entryId: ENTRY });
    expect(r.ok && new URL(r.url).searchParams.get('path')).toBe('/events/tonleikar');
  });

  it.each([
    ['a type without site pages', { type: 'site-info', slug: null }],
    ['an event without a slug yet', { type: 'event', slug: null }],
    ['a type the module does not know', { type: 'nope', slug: 'x' }],
    ['an inherited property name as the type', { type: 'constructor', slug: 'x' }],
  ])("sends the editor to the site's home page for %s", async (_name, change) => {
    state.entry.data = { ...state.entry.data, ...change };
    const r = await mintPreviewToken(fakes(), { entryId: ENTRY });
    expect(r.ok && new URL(r.url).searchParams.get('path')).toBe('/');
  });

  it('reads the entry and its tenant with the editor client before reading any secret', async () => {
    await mintPreviewToken(fakes(), { entryId: ENTRY });
    expect(state.calls).toEqual([`entry_list:id=${ENTRY}`, `my_tenants:id=${TENANT}`, `worker_preview_sites:${TENANT}`]);
  });

  it.each([
    ['no user', () => (state.user = null)],
    ['an Auth error (expired or revoked session)', () => ((state.user = null), (state.userError = { status: 403, code: 'session_not_found' }))],
    ['a JWT PostgREST refuses', () => (state.entry = { data: null, error: { code: 'PGRST303' }, status: 401 })],
  ])('is auth for %s, and reads no secret', async (_name, arrange) => {
    arrange();
    expect(await mintPreviewToken(fakes(), { entryId: ENTRY })).toEqual({ ok: false, failure: 'auth' });
    expect(state.calls.some((c) => c.startsWith('worker_preview_sites'))).toBe(false);
  });

  it.each([
    ['an entry RLS hides (another tenant, or none)', () => (state.entry = { data: null, error: null })],
    ['a tenant the editor is not a member of', () => (state.tenant = { data: null, error: null })],
    ['a suspended tenant', () => (state.tenant = { data: { id: TENANT, slug: 'demo', status: 'suspended' }, error: null })],
  ])('is not_found for %s, and reads no secret', async (_name, arrange) => {
    arrange();
    expect(await mintPreviewToken(fakes(), { entryId: ENTRY })).toEqual({ ok: false, failure: 'not_found' });
    expect(state.calls.some((c) => c.startsWith('worker_preview_sites'))).toBe(false);
  });

  it('chooses the site: the only one, the named one, or refuses', async () => {
    state.sites.data = [];
    expect(await mintPreviewToken(fakes(), { entryId: ENTRY })).toEqual({ ok: false, failure: 'preview_unavailable' });
    const two = [
      { id: SITE, preview_url: 'https://a.example/p', preview_secret: A_SECRET },
      { id: SITE2, preview_url: 'https://b.example/p', preview_secret: B_SECRET },
    ];
    state.sites.data = two;
    expect(await mintPreviewToken(fakes(), { entryId: ENTRY })).toEqual({ ok: false, failure: 'site_required' });
    const r = await mintPreviewToken(fakes(), { entryId: ENTRY, siteId: SITE2 });
    expect(r.ok && new URL(r.url).host).toBe('b.example');
    expect(r.ok && verifyPreviewToken({ token: r.token, secrets: [B_SECRET], nowSeconds: NOW })).toBeTruthy();
    expect(await mintPreviewToken(fakes(), { entryId: ENTRY, siteId: '00000000-0000-4000-8000-00000000c009' })).toEqual({ ok: false, failure: 'not_found' });
  });

  it('refuses a preview URL that is not http(s)', async () => {
    for (const preview_url of ['javascript:alert(1)', 'not a url', 'ftp://x.example/p']) {
      state.sites.data = [{ id: SITE, preview_url, preview_secret: SECRET }];
      expect(await mintPreviewToken(fakes(), { entryId: ENTRY })).toEqual({ ok: false, failure: 'preview_unavailable' });
    }
  });

  // Security review B4: the token travels in the preview URL's query, so never over plain http
  // to anything but the editor's own machine.
  it('refuses a plain-http preview URL outside loopback, and mints for https or loopback http', async () => {
    for (const preview_url of [
      'http://demo.example/api/cms/preview',
      'http://localhost.evil.example/p',
      'http://127.0.0.1.evil.example/p',
      'http://10.0.0.1/p',
      'http://0.0.0.0/p',
      'http://[::ffff:7f00:1]/p',
    ]) {
      state.sites.data = [{ id: SITE, preview_url, preview_secret: SECRET }];
      expect(await mintPreviewToken(fakes(), { entryId: ENTRY }), preview_url).toEqual({ ok: false, failure: 'preview_unavailable' });
    }
    for (const preview_url of [
      'https://demo.example/api/cms/preview',
      'http://localhost:3101/api/cms/preview',
      'http://127.0.0.1:3197/p',
      'http://127.1.2.3/p',
      'http://[::1]:3101/p',
    ]) {
      state.sites.data = [{ id: SITE, preview_url, preview_secret: SECRET }];
      expect((await mintPreviewToken(fakes(), { entryId: ENTRY })).ok, preview_url).toBe(true);
    }
  });

  // Security review B5: a secret shorter than 32 characters never signs a token.
  it('refuses a site whose preview secret is shorter than 32 characters', async () => {
    for (const preview_secret of ['x'.repeat(31), 'short', '']) {
      state.sites.data = [{ id: SITE, preview_url: 'https://demo.example/p', preview_secret }];
      expect(await mintPreviewToken(fakes(), { entryId: ENTRY })).toEqual({ ok: false, failure: 'preview_unavailable' });
      expect(await mintPreviewToken(fakes(), { entryId: ENTRY, siteId: SITE })).toEqual({ ok: false, failure: 'preview_unavailable' });
    }
    state.sites.data = [{ id: SITE, preview_url: 'https://demo.example/p', preview_secret: 'x'.repeat(32) }];
    expect((await mintPreviewToken(fakes(), { entryId: ENTRY })).ok).toBe(true);
  });

  it('throws on a database error, with the code only', async () => {
    state.sites = { data: null, error: { code: '42501' } };
    await expect(mintPreviewToken(fakes(), { entryId: ENTRY })).rejects.toThrow('worker_preview_sites: 42501');
    state.entry = { data: null, error: { code: '57014' }, status: 500 };
    await expect(mintPreviewToken(fakes(), { entryId: ENTRY })).rejects.toThrow('entry_list: 57014');
  });
});

describe('handlePreviewTokenRequest', () => {
  const URL_ = 'http://cms.local/api/preview-token';
  const post = (body: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
    new Request(URL_, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const send = (req: Request) => handlePreviewTokenRequest(req, async () => fakes());

  it('answers 200 with the token, its expiry and the URL, never cached', async () => {
    const res = await send(post({ entryId: ENTRY }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const body = (await res.json()) as { token: string; expiresAt: number; url: string };
    expect(Object.keys(body).sort()).toEqual(['expiresAt', 'token', 'url']);
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  it.each([
    ['a body that is not JSON', post('{')],
    ['no entryId', post({})],
    ['an entryId that is not a UUID', post({ entryId: 'x' })],
    ['an extra field', post({ entryId: ENTRY, tenant: 'labak' })],
    ['a form body', post(`entryId=${ENTRY}`, { 'content-type': 'application/x-www-form-urlencoded' })],
    ['no content type', new Request(URL_, { method: 'POST', body: JSON.stringify({ entryId: ENTRY }) })],
  ])('answers 400 for %s', async (_name, req) => {
    const res = await send(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad_request' });
  });

  it('answers 403 for another origin and accepts its own', async () => {
    expect((await send(post({ entryId: ENTRY }, { 'content-type': 'application/json', origin: 'https://evil.example' }))).status).toBe(403);
    expect((await send(post({ entryId: ENTRY }, { 'content-type': 'application/json', origin: 'http://cms.local' }))).status).toBe(200);
  });

  it('maps failures to 401, 404 and 409 with the code only, never cached', async () => {
    state.user = null;
    let res = await send(post({ entryId: ENTRY }));
    expect([res.status, await res.json(), res.headers.get('cache-control')]).toEqual([401, { error: 'auth' }, 'private, no-store']);
    state.user = { id: 'u1' };
    state.entry = { data: null, error: null };
    res = await send(post({ entryId: ENTRY }));
    expect([res.status, await res.json()]).toEqual([404, { error: 'not_found' }]);
    state.entry = { data: { id: ENTRY, tenant_id: TENANT, draft_version: 1 }, error: null };
    state.sites.data = [];
    res = await send(post({ entryId: ENTRY }));
    expect([res.status, await res.json()]).toEqual([409, { error: 'preview_unavailable' }]);
  });

  it('answers 500 on a database error and logs no secret', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    state.sites = { data: null, error: { code: 'XX000' } };
    const res = await send(post({ entryId: ENTRY }));
    expect([res.status, await res.json()]).toEqual([500, { error: 'error' }]);
    expect(JSON.stringify(log.mock.calls)).not.toContain(SECRET);
  });

  it('creates no clients for a refused request', async () => {
    const deps = vi.fn(async () => fakes());
    await handlePreviewTokenRequest(post('{'), deps);
    await handlePreviewTokenRequest(post({ entryId: ENTRY }, { 'content-type': 'application/json', origin: 'https://evil.example' }), deps);
    expect(deps).not.toHaveBeenCalled();
  });
});
