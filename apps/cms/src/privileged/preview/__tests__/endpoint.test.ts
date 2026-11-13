import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signPreviewToken, type Bundle, type BundleEntry } from '@litljomi/cms-sdk';
import type { SupabaseClient } from '@/lib/supabase/types';
import { PREVIEW_MEDIA_TTL_SECONDS, handlePreviewRequest, readPreview, type PreviewBundle, type PreviewDeps } from '../endpoint';

// The preview endpoint's logic with fake clients (spec §7.5, plan M3-11). Tokens, RLS-free reads,
// Vault and Storage signing on the local stack are in preview-endpoint.integration.test.ts.

const NOW = 1_800_000_000;
const TENANT = '00000000-0000-4000-8000-00000000a001';
const ENTRY = '0b5d4c1e-2f3a-4b5c-8d7e-9f0a1b2c3d4e';
const OTHER = '1c6e5d2f-3a4b-4c5d-9e8f-0a1b2c3d4e5f';
const ASSET = '2d7f6e3a-4b5c-4d6e-8f9a-1b2c3d4e5f6a';
// Test values only, each 32 characters or more (MIN_PREVIEW_SECRET_LENGTH).
const SECRET = 'labak-preview-secret-0123456789abcdef';
const SECOND = 'labak-second-preview-secret-0123456789';
const ORIGINAL = `${TENANT}/${ASSET}/mynd.jpg`;

const news = (title: string) => ({
  title,
  date: '2026-10-15',
  excerpt: 'Inngangur.',
  image: { _ref: ASSET, _kind: 'asset', alt: 'Brauð' },
});

const record = (id: string, title: string): BundleEntry => ({
  id,
  revisionId: `rev-${id}`,
  contentHash: `hash-${id}`,
  slug: `s-${id.slice(0, 4)}`,
  title,
  sortAt: '2026-10-15T00:00:00.000Z',
  firstPublishedAt: '2026-10-01T00:00:00.000Z',
  lastPublishedAt: '2026-10-02T00:00:00.000Z',
  schemaVersion: 1,
  data: { title },
});

type State = {
  tenantId: string | null;
  sites: unknown[];
  draft: Record<string, unknown> | null;
  release: Record<string, unknown> | null;
  bundle: unknown;
  calls: string[];
  signed: { paths: string[]; ttl: number }[];
};
let state: State;

function deps(o: Partial<PreviewDeps> = {}): PreviewDeps {
  const admin = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.calls.push(fn);
      if (fn === 'worker_preview_tenant') return { data: args.p_slug === 'labak' ? state.tenantId : null, error: null };
      if (fn === 'worker_preview_sites') return { data: state.sites, error: null };
      if (fn === 'worker_preview_draft') return { data: args.p_entry_id === ENTRY && args.p_tenant_id === TENANT ? state.draft : null, error: null };
      if (fn === 'worker_previous_release') return { data: state.release, error: null };
      throw new Error(`unexpected rpc ${fn}`);
    },
  } as unknown as SupabaseClient;
  return {
    admin,
    nowSeconds: () => NOW,
    storage: {
      download: async (bucket, path) => {
        state.calls.push(`download:${bucket}/${path}`);
        return new TextEncoder().encode(JSON.stringify(state.bundle));
      },
    },
    signMedia: async (paths, ttl) => {
      state.signed.push({ paths, ttl });
      return new Map(paths.map((p) => [p, `https://project.supabase.co/storage/v1/object/sign/media-private/${p}?token=t`]));
    },
    ...o,
  };
}

const token = (claims: Partial<{ tenant: string; entry_id: string; draft_version: number; exp: number }> = {}, secret = SECRET) =>
  signPreviewToken({ tenant: 'labak', entry_id: ENTRY, draft_version: 4, exp: NOW + 600, ...claims }, secret);

beforeEach(() => {
  const bundle: Bundle = { format: 1, tenant: 'labak', release: 7, generatedAt: '2026-10-02T00:00:00.000Z', entries: { news: [record(ENTRY, 'Birt'), record(OTHER, 'Önnur')] } };
  state = {
    tenantId: TENANT,
    sites: [{ id: 's1', preview_url: 'https://labak.example/api/cms/preview', preview_secret: SECRET }],
    draft: {
      entry: { id: ENTRY, type: 'news', slug: 'frett', archived: false, first_published_at: '2026-10-01T00:00:00+00:00', last_published_at: '2026-10-02T00:00:00+00:00' },
      draft: { data: news('Drög'), version: 4, schema_version: 1 },
      assets: [
        { id: ASSET, filename: 'mynd.jpg', mime: 'image/jpeg', width: 8, height: 6, focal_x: null, focal_y: null, default_alt: null, original_path: ORIGINAL, archived: false, caption: 'Kanilsnúðar á bakka', credit: 'Anna Önnudóttir' },
      ],
    },
    release: { id: 'r7', number: 7, bundle_path: 'labak/releases/7.json' },
    bundle,
    calls: [],
    signed: [],
  };
});

describe('readPreview', () => {
  it('overlays the draft on the delivered release, with the draft\'s media signed', async () => {
    const r = await readPreview(deps(), { tenant: 'labak', token: token() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const b: PreviewBundle = r.bundle;
    expect(b).toMatchObject({ format: 1, tenant: 'labak', release: 7, preview: { entryId: ENTRY, draftVersion: 4, expiresAt: NOW + 600 } });
    expect(b.entries.news!.map((e) => e.id)).toEqual([ENTRY, OTHER]);
    expect(b.entries.news![1]).toEqual(record(OTHER, 'Önnur'));
    expect(b.entries.news![0]).toMatchObject({
      id: ENTRY,
      revisionId: 'draft:4',
      slug: 'frett',
      title: 'Drög',
      sortAt: '2026-10-15T00:00:00.000Z',
      firstPublishedAt: '2026-10-01T00:00:00.000Z',
      lastPublishedAt: new Date(NOW * 1000).toISOString(),
      schemaVersion: 1,
    });
    expect((b.entries.news![0]!.data.image as { url: string }).url).toBe(
      `https://project.supabase.co/storage/v1/object/sign/media-private/${ORIGINAL}?token=t`,
    );
    // Media library L3: preview projects like a release, so the file's caption and credit come too.
    expect(b.entries.news![0]!.data.image).toMatchObject({ caption: 'Kanilsnúðar á bakka', credit: 'Anna Önnudóttir' });
    expect(state.signed).toEqual([{ paths: [ORIGINAL], ttl: PREVIEW_MEDIA_TTL_SECONDS }]);
    expect(state.calls).toEqual([
      'worker_preview_tenant',
      'worker_preview_sites',
      'worker_preview_draft',
      'worker_previous_release',
      'download:delivery/labak/releases/7.json',
    ]);
  });

  // Enhancement A4: on a local stack the signed URLs are http on the stack's own loopback address.
  describe('on a local stack', () => {
    const LOCAL = 'http://127.0.0.1:54331';
    const signHttp = (origin: string) => async (paths: string[]) =>
      new Map(paths.map((p) => [p, `${origin}/storage/v1/object/sign/media-private/${p}?token=t`]));
    const imageOf = (r: Awaited<ReturnType<typeof readPreview>>) => (r.ok ? (r.bundle.entries.news![0]!.data.image as { url: string } | null) : 'refused');

    it("delivers the draft's media at the stack's own http address", async () => {
      const r = await readPreview(deps({ stackUrl: LOCAL, signMedia: signHttp(LOCAL) }), { tenant: 'labak', token: token() });
      expect(imageOf(r)).toMatchObject({ url: `${LOCAL}/storage/v1/object/sign/media-private/${ORIGINAL}?token=t` });
    });
    it('delivers no http media without a local stack address, or when that address is not loopback', async () => {
      expect(imageOf(await readPreview(deps({ signMedia: signHttp(LOCAL) }), { tenant: 'labak', token: token() }))).toBeNull();
      const hosted = 'http://abcdefghijklmnopqrst.supabase.co';
      expect(imageOf(await readPreview(deps({ stackUrl: hosted, signMedia: signHttp(hosted) }), { tenant: 'labak', token: token() }))).toBeNull();
      expect(imageOf(await readPreview(deps({ stackUrl: LOCAL, signMedia: signHttp('http://127.0.0.1:54321') }), { tenant: 'labak', token: token() }))).toBeNull();
    });
  });

  it('before the first release the preview holds the draft only, as release 0', async () => {
    state.release = { id: null, number: null, bundle_path: null };
    const r = await readPreview(deps(), { tenant: 'labak', token: token() });
    expect(r.ok && [r.bundle.release, Object.values(r.bundle.entries).flat().map((e) => e.id)]).toEqual([0, [ENTRY]]);
  });

  it('reads nothing about the draft before the token is verified', async () => {
    expect(await readPreview(deps(), { tenant: 'labak', token: token({}, 'another-preview-secret-0123456789abcdef') })).toEqual({ ok: false, failure: 'invalid_token' });
    expect(state.calls).toEqual(['worker_preview_tenant', 'worker_preview_sites']);
  });

  it.each([
    ['another tenant\'s claim', () => token({ tenant: 'demo' })],
    ['an expired token', () => token({ exp: NOW })],
    ['garbage', () => 'x.y'],
  ])('refuses %s', async (_name, t) => {
    expect(await readPreview(deps(), { tenant: 'labak', token: t() })).toEqual({ ok: false, failure: 'invalid_token' });
  });

  it('refuses a tenant that cannot preview: unknown, or no preview site', async () => {
    expect(await readPreview(deps(), { tenant: 'demo', token: token({ tenant: 'demo' }) })).toEqual({ ok: false, failure: 'invalid_token' });
    state.sites = [];
    expect(await readPreview(deps(), { tenant: 'labak', token: token() })).toEqual({ ok: false, failure: 'invalid_token' });
    expect(await readPreview(deps(), { tenant: '../labak', token: token() })).toEqual({ ok: false, failure: 'invalid_token' });
  });

  it('accepts a token signed with any of the tenant\'s preview secrets', async () => {
    state.sites.push({ id: 's2', preview_url: 'https://labak-2.example/api/cms/preview', preview_secret: SECOND });
    expect((await readPreview(deps(), { tenant: 'labak', token: token({}, SECOND) })).ok).toBe(true);
  });

  it('not_found for an entry that is gone or archived; draft_changed for another draft version', async () => {
    (state.draft!.entry as Record<string, unknown>).archived = true;
    expect(await readPreview(deps(), { tenant: 'labak', token: token() })).toEqual({ ok: false, failure: 'not_found' });
    expect(await readPreview(deps(), { tenant: 'labak', token: token({ entry_id: OTHER }) })).toEqual({ ok: false, failure: 'not_found' });
    (state.draft!.entry as Record<string, unknown>).archived = false;
    expect(await readPreview(deps(), { tenant: 'labak', token: token({ draft_version: 3 }) })).toEqual({ ok: false, failure: 'draft_changed' });
  });

  it('draft_invalid when the draft cannot be projected, with issue codes and paths only', async () => {
    (state.draft!.draft as Record<string, unknown>).data = { ...news('Drög'), title: '' };
    const r = await readPreview(deps(), { tenant: 'labak', token: token() });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.failure).toBe('draft_invalid');
    expect(r.details?.code).toBe('projection_failed');
    for (const issue of r.details?.issues as Record<string, unknown>[]) expect(Object.keys(issue).sort()).toEqual(['code', 'path']);
  });

  it('draft_invalid for a draft written by a newer schema than the deployed type', async () => {
    (state.draft!.draft as Record<string, unknown>).schema_version = 9;
    expect(await readPreview(deps(), { tenant: 'labak', token: token() })).toMatchObject({ ok: false, failure: 'draft_invalid', details: { code: 'upcast_failed' } });
  });

  it('signs no archived asset and none whose stored path is not its own; such images resolve to null', async () => {
    const asset = (state.draft!.assets as Record<string, unknown>[])[0]!;
    asset.original_path = `${TENANT}/${OTHER}/mynd.jpg`;
    const r = await readPreview(deps(), { tenant: 'labak', token: token() });
    expect(state.signed).toEqual([]);
    expect(r.ok && r.bundle.entries.news![0]!.data.image).toBeNull();
    asset.original_path = ORIGINAL;
    asset.archived = true;
    await readPreview(deps(), { tenant: 'labak', token: token() });
    expect(state.signed).toEqual([]);
  });

  // Security review B6: a token that cannot be valid is refused before any RPC.
  it.each([
    ['garbage', () => 'x.y'],
    ['a malformed payload', () => `${Buffer.from('{"tenant":"labak"}').toString('base64url')}.c2ln`],
    ['an expired token', () => token({ exp: NOW })],
    ['an expiry beyond the lifetime', () => token({ exp: NOW + 3600 })],
    ['another tenant\'s claim', () => token({ tenant: 'demo' })],
  ])('refuses %s before any read', async (_name, t) => {
    expect(await readPreview(deps(), { tenant: 'labak', token: t() })).toEqual({ ok: false, failure: 'invalid_token' });
    expect(state.calls).toEqual([]);
  });

  // Security review B5: a site's secret shorter than 32 characters verifies nothing.
  it('never verifies a token against a preview secret shorter than 32 characters', async () => {
    const short = 'x'.repeat(31);
    state.sites = [{ id: 's1', preview_url: 'https://labak.example/api/cms/preview', preview_secret: short }];
    const p = Buffer.from(JSON.stringify({ tenant: 'labak', entry_id: ENTRY, draft_version: 4, exp: NOW + 600 })).toString('base64url');
    const forged = `${p}.${createHmac('sha256', short).update(p).digest('base64url')}`;
    expect(await readPreview(deps(), { tenant: 'labak', token: forged })).toEqual({ ok: false, failure: 'invalid_token' });
    expect(state.calls).not.toContain('worker_preview_draft');
  });

  // Security review B3: a signed media URL never outlives the token it was issued for.
  it('signs the media for no longer than the token has left', async () => {
    await readPreview(deps(), { tenant: 'labak', token: token({ exp: NOW + 120 }) });
    expect(state.signed).toEqual([{ paths: [ORIGINAL], ttl: 120 }]);
    state.signed = [];
    await readPreview(deps(), { tenant: 'labak', token: token({ exp: NOW + 1 }) });
    expect(state.signed).toEqual([{ paths: [ORIGINAL], ttl: 1 }]);
    state.signed = [];
    await readPreview(deps({ mediaTtlSeconds: 60 }), { tenant: 'labak', token: token({ exp: NOW + 600 }) });
    expect(state.signed).toEqual([{ paths: [ORIGINAL], ttl: 60 }]);
    // A fractional clock (Date.now() / 1000) gives whole seconds, rounded down.
    state.signed = [];
    await readPreview(deps({ nowSeconds: () => NOW + 0.4 }), { tenant: 'labak', token: token({ exp: NOW + 120 }) });
    expect(state.signed).toEqual([{ paths: [ORIGINAL], ttl: 119 }]);
  });

  it('throws when the delivered bundle is another tenant\'s or release\'s', async () => {
    state.bundle = { ...(state.bundle as Bundle), release: 6 };
    await expect(readPreview(deps(), { tenant: 'labak', token: token() })).rejects.toThrow(/is not release 7/);
  });
});

describe('handlePreviewRequest', () => {
  const get = (authorization: string | null, d = deps()) =>
    handlePreviewRequest(
      new Request('https://cms.example/api/preview/labak', { headers: authorization === null ? {} : { authorization } }),
      'labak',
      async () => d,
    );

  it('200 with the preview bundle, never cached', async () => {
    const res = await get(`Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(((await res.json()) as PreviewBundle).preview.entryId).toBe(ENTRY);
  });

  it.each([null, '', 'Basic abc', `bearer ${'x'}`, 'Bearer a b', `Bearer ${'?'.repeat(4)}`])(
    '401 without a bearer token (%j), before any read',
    async (authorization) => {
      const res = await get(authorization);
      expect([res.status, await res.json()]).toEqual([401, { error: 'invalid_token' }]);
      expect(res.headers.get('cache-control')).toBe('private, no-store');
      expect(res.headers.get('www-authenticate')).toBe('Bearer');
      expect(state.calls).toEqual([]);
    },
  );

  it('404, 409 and 422 for a valid token, never cached', async () => {
    const check = async (status: number, error: string, t: string) => {
      const res = await get(`Bearer ${t}`);
      expect(res.status).toBe(status);
      expect(((await res.json()) as { error: string }).error).toBe(error);
      expect(res.headers.get('cache-control')).toBe('private, no-store');
    };
    await check(404, 'not_found', token({ entry_id: OTHER }));
    await check(409, 'draft_changed', token({ draft_version: 5 }));
    (state.draft!.draft as Record<string, unknown>).data = {};
    await check(422, 'draft_invalid', token());
  });

  it('500 with no detail when a read fails; the log names no secret or token', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = token();
    const res = await get(`Bearer ${t}`, deps({ storage: { download: async () => Promise.reject(new Error('storage down')) } }));
    expect([res.status, await res.json()]).toEqual([500, { error: 'error' }]);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain(t);
    error.mockRestore();
  });
});
