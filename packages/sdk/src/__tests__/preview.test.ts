import { describe, expect, it, vi } from 'vitest';
import {
  CmsPreviewError,
  PREVIEW_COOKIE,
  createCmsClient,
  createPreviewHandler,
  parsePreviewSecrets,
  readPreviewToken,
  safePreviewPath,
  signPreviewToken,
  type Bundle,
  type PreviewClaims,
} from '../index.ts';

const NOW = 1_800_000_000;
const ENTRY = '0b1c2d3e-4f50-4617-8899-aabbccddeeff';
const claims = (o: Partial<PreviewClaims> = {}): PreviewClaims => ({ tenant: 'demo', entry_id: ENTRY, draft_version: 3, exp: NOW + 600, ...o });
const token = (o: Partial<PreviewClaims> = {}, secret = 'preview-1') => signPreviewToken(claims(o), secret);

function setup(o: { secrets?: () => string[] } = {}) {
  const enableDraftMode = vi.fn();
  const handler = createPreviewHandler({ tenant: 'demo', secrets: o.secrets ?? (() => ['preview-1', 'preview-2']), enableDraftMode, now: () => NOW * 1000 });
  const get = (query: Record<string, string>, origin = 'https://site.example') =>
    handler(new Request(`${origin}/api/cms/preview?${new URLSearchParams(query).toString()}`));
  return { enableDraftMode, get };
}

describe('createPreviewHandler', () => {
  it('a valid token enables draft mode, sets the token cookie until its expiry and redirects to the path', async () => {
    const { enableDraftMode, get } = setup();
    const t = token();
    const res = await get({ token: t, path: '/events/x' });
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('/events/x');
    expect(enableDraftMode).toHaveBeenCalledTimes(1);
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie.split('; ')).toEqual([`${PREVIEW_COOKIE}=${t}`, 'Path=/', 'Max-Age=600', 'HttpOnly', 'SameSite=Lax', 'Secure']);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });
  it('accepts the second secret during rotation, and leaves Secure off on plain http', async () => {
    const { get } = setup();
    const res = await get({ token: token({}, 'preview-2'), path: '/' }, 'http://localhost:3101');
    expect(res.status).toBe(307);
    expect(res.headers.get('set-cookie')).not.toMatch(/Secure/);
  });
  it('draft mode only after a valid token: missing, tampered, wrong secret, expired, other tenant all give 401', async () => {
    const { enableDraftMode, get } = setup();
    const t = token();
    const tampered = `${t.slice(0, -2)}${t.endsWith('AA') ? 'BB' : 'AA'}`;
    const cases: Array<Record<string, string>> = [
      {},
      { token: '' },
      { token: 'not-a-token' },
      { token: tampered },
      { token: token({}, 'another-site-secret') },
      { token: token({ exp: NOW }) },
      { token: token({ exp: NOW + 3600 }) },
      { token: token({ tenant: 'labak' }) },
    ];
    for (const query of cases) {
      const res = await get({ ...query, path: '/events/x' });
      expect(res.status, JSON.stringify(query)).toBe(401);
      expect(res.headers.get('set-cookie')).toBeNull();
      expect(res.headers.get('cache-control')).toBe('private, no-store');
    }
    expect(enableDraftMode).not.toHaveBeenCalled();
  });
  it('refuses a path that is not on the site with 400, before draft mode', async () => {
    const { enableDraftMode, get } = setup();
    for (const path of ['', 'events/x', '//evil.example/x', '/\\evil.example', 'https://evil.example/', '/a\nb', 'javascript:alert(1)']) {
      expect((await get({ token: token(), path })).status, path).toBe(400);
    }
    expect((await get({ token: token() })).status).toBe(400);
    expect(enableDraftMode).not.toHaveBeenCalled();
  });
  it('a broken secret list gives a plain 500 and no draft mode', async () => {
    for (const secrets of [() => [], () => ['a', ' '], () => { throw new Error('CMS_PREVIEW_SECRETS is not set'); }]) {
      const { enableDraftMode, get } = setup({ secrets });
      const res = await get({ token: token(), path: '/' });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ preview: false });
      expect(enableDraftMode).not.toHaveBeenCalled();
    }
  });
  it('trims the secrets', async () => {
    const { get } = setup({ secrets: () => [' preview-1 '] });
    expect((await get({ token: token(), path: '/' })).status).toBe(307);
  });
});

describe('safePreviewPath and parsePreviewSecrets', () => {
  it('keeps a path with its query and hash, normalised', () => {
    expect(safePreviewPath('/events/x?y=1#z')).toBe('/events/x?y=1#z');
    expect(safePreviewPath('/a/../b')).toBe('/b');
    expect(safePreviewPath(null)).toBeNull();
    expect(safePreviewPath('/' + 'a'.repeat(3000))).toBeNull();
  });
  it('parses a comma-separated list and refuses an empty entry', () => {
    expect(parsePreviewSecrets(' a , b ')).toEqual(['a', 'b']);
    expect(() => parsePreviewSecrets('a,')).toThrow(/entry 2 of 2/);
    expect(() => parsePreviewSecrets('')).toThrow(/empty/);
  });
});

describe('readPreviewToken', () => {
  it('reads the cookie only in draft mode', async () => {
    const cookies = vi.fn(async () => ({ get: (name: string) => (name === PREVIEW_COOKIE ? { value: 'tok' } : undefined) }));
    expect(await readPreviewToken({ draftMode: async () => ({ isEnabled: false }), cookies })).toBeNull();
    expect(cookies).not.toHaveBeenCalled();
    expect(await readPreviewToken({ draftMode: async () => ({ isEnabled: true }), cookies })).toBe('tok');
    expect(await readPreviewToken({ draftMode: async () => ({ isEnabled: true }), cookies: async () => ({ get: () => undefined }) })).toBeNull();
  });
});

describe('createCmsClient in draft mode', () => {
  const published: Bundle = { format: 1, tenant: 'demo', release: 4, generatedAt: 'x', entries: { event: [] } };
  const previewed = { ...published, entries: { event: [{ id: ENTRY }] }, preview: { entryId: ENTRY, draftVersion: 3, expiresAt: NOW + 600 } };
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
  function client(tokenValue: string | null, previewResponse: () => Response = () => json(previewed)) {
    const fetch = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.startsWith('https://cms.example/')) return previewResponse();
      return u.endsWith('current.json') ? json({ format: 1, tenant: 'demo', release: 4, bundle: 'releases/4.json', generatedAt: 'x' }) : json(published);
    });
    const c = createCmsClient({
      deliveryBaseUrl: 'https://cdn.example/delivery',
      tenant: 'demo',
      fetch: fetch as unknown as typeof globalThis.fetch,
      preview: { cmsBaseUrl: 'https://cms.example/', token: () => tokenValue },
    });
    return { c, fetch };
  }
  it('without a token reads the published release', async () => {
    const { c, fetch } = client(null);
    expect(await c.getBundle()).toEqual(published);
    expect(fetch.mock.calls.every(([u]) => !String(u).startsWith('https://cms.example'))).toBe(true);
  });
  it('with a token reads the preview endpoint with a Bearer header, no-store, and never the delivery bucket', async () => {
    const { c, fetch } = client('tok');
    expect((await c.getEntries('event')).map((e) => e.id)).toEqual([ENTRY]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('https://cms.example/api/preview/demo', { headers: { authorization: 'Bearer tok' }, cache: 'no-store' });
  });
  it('accepts release 0 (nothing delivered yet)', async () => {
    const { c } = client('tok', () => json({ ...previewed, release: 0 }));
    expect((await c.getBundle()).release).toBe(0);
  });
  it('a refusal throws CmsPreviewError with the endpoint code', async () => {
    const { c } = client('tok', () => json({ error: 'draft_changed' }, 409));
    const error = await c.getBundle().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CmsPreviewError);
    expect(error).toMatchObject({ status: 409, code: 'draft_changed' });
    const { c: plain } = client('tok', () => new Response('<html>', { status: 502 }));
    await expect(plain.getBundle()).rejects.toMatchObject({ status: 502, code: 'error' });
  });
  it('refuses a preview of another tenant or format', async () => {
    await expect(client('tok', () => json({ ...previewed, tenant: 'labak' })).c.getBundle()).rejects.toThrow(/tenant/);
    await expect(client('tok', () => json({ ...previewed, format: 2 })).c.getBundle()).rejects.toThrow(/format/);
    await expect(client('tok', () => json({ ...previewed, release: -1 })).c.getBundle()).rejects.toThrow(/release/);
  });
});
