// The preview endpoint against the local stack (spec §7.5, §13.2 "preview cannot be obtained across
// tenants and is never cached"; plan M3-11). Editors publish and save drafts over the Data API with
// their own sessions; tokens come from the real token route logic (M3-10) with the site's Vault
// secret; the endpoint runs with the secret key, as in production.
//
// Each tenant gets one site with a preview URL and a preview secret, created idempotently and
// deactivated after the tests. Releases are built on labak, so every bundle also holds whatever
// labak content earlier tests published; assertions are about the entries this file creates and
// about the rest of the bundle being exactly the release's.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Bundle, BundleEntry } from '@litljomi/cms-sdk';
import { editorClient, secretClient } from '../../../../../../tests/integration/src/clients.ts';
import { env } from '../../../../../../tests/integration/src/env.ts';
import { TENANT } from '../../../../../../tests/integration/src/fixtures.ts';
import { closeAll, ownerQuery } from '../../../../../../tests/integration/src/sql.ts';
import type { SupabaseClient as AppClient } from '@/lib/supabase/types';
import { buildRelease } from '../../worker/build-release';
import { processRequestById } from '../../worker/process-request';
import { prepareLabak } from '../../worker/__tests__/labak-setup';
import { TEST_JPEG, TEST_JPEG_METADATA } from '../../worker/__tests__/test-image';
import { handlePreviewRequest, type PreviewBundle, type PreviewDeps } from '../endpoint';
import { mintPreviewToken } from '../token';

const SITES = {
  demo: { baseUrl: 'http://127.0.0.1:3194', previewSecret: 'preview-endpoint-test-demo-secret' },
  labak: { baseUrl: 'http://127.0.0.1:3195', previewSecret: 'preview-endpoint-test-labak-secret' },
} as const;
type Tenant = keyof typeof SITES;

// Local Storage URLs are http on the stack's own loopback address, which the projection delivers on
// a local stack only (enhancement A4): the endpoint is given the stack's URL, as the route gives it
// NEXT_PUBLIC_SUPABASE_URL, and the signed URLs are delivered and fetched as Storage made them.

const asApp = (c: unknown) => c as AppClient;
// As createAdminClient: the api schema by default, which the worker's rpc calls rely on.
const admin = () =>
  asApp(createClient(env.apiUrl, env.secretKey, { db: { schema: 'api' }, auth: { persistSession: false, autoRefreshToken: false } }));

/** The endpoint's dependencies, with the real signer and the local stack's URL. */
function deps(o: { now?: number; mediaTtlSeconds?: number } = {}): PreviewDeps {
  const db = admin();
  return {
    admin: db,
    nowSeconds: () => o.now ?? Date.now() / 1000,
    stackUrl: env.apiUrl,
    ...(o.mediaTtlSeconds === undefined ? {} : { mediaTtlSeconds: o.mediaTtlSeconds }),
    signMedia: async (paths, expiresIn) => {
      const { data, error } = await db.storage.from('media-private').createSignedUrls(paths, expiresIn);
      if (error) throw error;
      return new Map((data ?? []).flatMap((s) => (!s.error && s.path && s.signedUrl ? [[s.path, s.signedUrl] as const] : [])));
    },
  };
}

const siteIds: Record<Tenant, string> = { demo: '', labak: '' };
let editor: SupabaseClient;

async function ensureSite(tenant: Tenant): Promise<string> {
  const { baseUrl, previewSecret } = SITES[tenant];
  const existing = await ownerQuery<{ id: string }>('select id from cms.sites where tenant_id = $1 and base_url = $2', [TENANT[tenant], baseUrl]);
  const api = secretClient().schema('api');
  let id = existing[0]?.id;
  if (!id) {
    const { data, error } = await api.rpc('admin_create_site', {
      p_tenant_id: TENANT[tenant],
      p_base_url: baseUrl,
      p_revalidate_url: `${baseUrl}/api/cms/revalidate`,
      p_preview_url: `${baseUrl}/api/cms/preview`,
      p_webhook_secret: `${previewSecret}-webhook`,
      p_preview_secret: previewSecret,
    });
    if (error) throw new Error(`admin_create_site: ${error.message}`);
    id = data as string;
  } else {
    const { error } = await api.rpc('admin_set_preview_secret', { p_site_id: id, p_preview_secret: previewSecret });
    if (error) throw new Error(`admin_set_preview_secret: ${error.message}`);
  }
  await ownerQuery('update cms.sites set active = true where id = $1', [id]);
  return id;
}

const rpc = async <T>(c: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await c.schema('api').rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.code} ${error.message}`);
  return data as T;
};

/** A labak asset registered by editor_labak, with its original in media-private. */
async function labakAsset(): Promise<string> {
  const id = randomUUID();
  const path = `${TENANT.labak}/${id}/mynd.jpg`;
  const { error } = await editor.storage.from('media-private').upload(path, TEST_JPEG, { contentType: 'image/jpeg' });
  if (error) throw error;
  await rpc(editor, 'register_asset', { p_asset_id: id, p_tenant_id: TENANT.labak, p_original_path: path, p_filename: 'mynd.jpg', ...TEST_JPEG_METADATA });
  return id;
}

const news = (imageId: string, title: string) => ({
  title,
  date: '2026-10-15',
  excerpt: 'Inngangur.',
  image: { _ref: imageId, _kind: 'asset', alt: 'Brauð' },
  body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Meginmál.' }] }] },
});

const draftVersion = async (entryId: string) =>
  (await ownerQuery<{ version: number }>('select version from cms.drafts where entry_id = $1', [entryId]))[0]!.version;

/** Saves the entry's draft as editor_labak; returns the new draft version. */
async function saveDraft(c: SupabaseClient, entryId: string, data: Record<string, unknown>): Promise<number> {
  return rpc<number>(c, 'save_draft', {
    p_entry_id: entryId,
    p_expected_version: await draftVersion(entryId),
    p_data: data,
    p_schema_version: 1,
    p_title: null,
    p_sort_at: null,
  });
}

async function newEntry(c: SupabaseClient, tenant: Tenant, data: Record<string, unknown>): Promise<string> {
  const id = await rpc<string>(c, 'create_entry', { p_tenant_id: TENANT[tenant], p_type: 'news', p_slug: `m311-${randomUUID().slice(0, 8)}` });
  await saveDraft(c, id, data);
  return id;
}

async function publish(entryId: string): Promise<void> {
  const requestId = await rpc<string>(editor, 'request_publish', { p_entry_id: entryId, p_expected_draft_version: await draftVersion(entryId) });
  expect((await processRequestById(requestId)).status).toBe('committed');
}

async function delivered(): Promise<Bundle & { release: number }> {
  const result = await buildRelease(TENANT.labak);
  expect(result.status, JSON.stringify(result)).toBe('delivered');
  return result.bundle!;
}

/** A token for the entry from the token route's logic, as its editor. */
async function token(c: SupabaseClient, tenant: Tenant, entryId: string): Promise<string> {
  const r = await mintPreviewToken({ editor: asApp(c), admin: admin(), nowSeconds: () => Date.now() / 1000 }, { entryId, siteId: siteIds[tenant] });
  if (!r.ok) throw new Error(`mint: ${r.failure}`);
  return r.token;
}

const get = (tenant: string, bearer: string | null, d: PreviewDeps = deps()) =>
  handlePreviewRequest(
    new Request(`http://cms.local/api/preview/${tenant}`, { headers: bearer === null ? {} : { authorization: `Bearer ${bearer}` } }),
    tenant,
    async () => d,
  );

const entriesOf = (b: Bundle): BundleEntry[] => Object.values(b.entries).flat();

beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', env.apiUrl);
  vi.stubEnv('SUPABASE_SECRET_KEY', env.secretKey);
  editor = await editorClient('editor_labak');
  await prepareLabak();
  siteIds.demo = await ensureSite('demo');
  siteIds.labak = await ensureSite('labak');
});

afterAll(async () => {
  await ownerQuery('update cms.sites set active = false where id = any($1::uuid[])', [[siteIds.demo, siteIds.labak].filter(Boolean)]);
  vi.unstubAllEnvs();
  await closeAll();
});

describe('preview endpoint: the overlay (§7.5)', () => {
  let a = '';
  let b = '';
  let release: Bundle;

  beforeAll(async () => {
    a = await newEntry(editor, 'labak', news(await labakAsset(), 'A birt'));
    b = await newEntry(editor, 'labak', news(await labakAsset(), 'B birt'));
    await publish(a);
    await publish(b);
    release = await delivered();
  });

  it('the draft replaces its published record in place; every other entry is the release\'s record unchanged', async () => {
    const image = await labakAsset();
    const version = await saveDraft(editor, a, news(image, 'A drög'));
    const res = await get('labak', await token(editor, 'labak', a));
    expect(res.status).toBe(200);
    const body = (await res.json()) as PreviewBundle;

    expect(body).toMatchObject({ format: 1, tenant: 'labak', release: release.release, preview: { entryId: a, draftVersion: version } });
    // The same types, the same entries in the same order; only A's record differs.
    expect(Object.keys(body.entries).sort()).toEqual(Object.keys(release.entries).sort());
    for (const [type, list] of Object.entries(release.entries)) {
      expect(body.entries[type]!.map((e) => e.id)).toEqual(list.map((e) => e.id));
      for (const [i, e] of list.entries()) if (e.id !== a) expect(body.entries[type]![i]).toEqual(e);
    }
    const published = entriesOf(release).find((e) => e.id === a)!;
    const previewed = entriesOf(body).find((e) => e.id === a)!;
    expect(published.title).toBe('A birt');
    expect(previewed).toMatchObject({ id: a, revisionId: `draft:${version}`, title: 'A drög', slug: published.slug, schemaVersion: 1 });
    expect(previewed.data.title).toBe('A drög');
    expect(previewed.firstPublishedAt).toBe(published.firstPublishedAt);
    expect(previewed.contentHash).not.toBe(published.contentHash);
    // The draft's image is a signed URL of the private original, not a public one.
    const url = (previewed.data.image as { url: string } | null)?.url ?? '';
    expect(url).toContain(`/storage/v1/object/sign/media-private/${TENANT.labak}/${image}/mynd.jpg?token=`);
  });

  it('a draft that was never published is added to its type', async () => {
    const c = await newEntry(editor, 'labak', news(await labakAsset(), 'C nýtt'));
    const res = await get('labak', await token(editor, 'labak', c));
    expect(res.status).toBe(200);
    const body = (await res.json()) as PreviewBundle;
    expect(body.entries.news!.at(-1)).toMatchObject({ id: c, title: 'C nýtt', firstPublishedAt: body.generatedAt, lastPublishedAt: body.generatedAt });
    expect(entriesOf(body)).toHaveLength(entriesOf(release).length + 1);
  });

  it('the response is never cached and carries no secret', async () => {
    const res = await get('labak', await token(editor, 'labak', b));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const text = await res.text();
    for (const s of Object.values(SITES)) expect(text).not.toContain(s.previewSecret);
    expect(text).not.toContain(env.secretKey);
  });

  it('signed media URLs expire', async () => {
    const image = await labakAsset();
    await saveDraft(editor, b, news(image, 'B drög'));
    const res = await get('labak', await token(editor, 'labak', b), deps({ mediaTtlSeconds: 2 }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as PreviewBundle;
    const url = (entriesOf(body).find((e) => e.id === b)!.data.image as { url: string }).url;
    expect(url.startsWith(`${env.apiUrl.replace(/\/+$/, '')}/storage/v1/object/sign/media-private/`)).toBe(true);
    // The token Storage signed says when it expires: exactly the TTL after it was signed.
    const claims = JSON.parse(Buffer.from(new URL(url).searchParams.get('token')!.split('.')[1]!, 'base64url').toString()) as { iat: number; exp: number };
    expect(claims.exp - claims.iat).toBe(2);
    expect((await fetch(url, { cache: 'no-store' })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 3_500));
    const after = await fetch(url, { cache: 'no-store' });
    expect(after.status).not.toBe(200);
    expect(after.status).toBeGreaterThanOrEqual(400);
  });

  it('a draft saved after the token was minted is refused (409): the token names one draft version', async () => {
    const t = await token(editor, 'labak', b);
    await saveDraft(editor, b, news(await labakAsset(), 'B drög 2'));
    const res = await get('labak', t);
    expect([res.status, await res.json()]).toEqual([409, { error: 'draft_changed' }]);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });
});

describe('preview endpoint: refused tokens (§7.5, §13.2)', () => {
  let labakEntry = '';
  let demoEntry = '';
  let demoEditor: SupabaseClient;

  beforeAll(async () => {
    demoEditor = await editorClient('editor_demo');
    labakEntry = await newEntry(editor, 'labak', news(await labakAsset(), 'Labak drög'));
    demoEntry = await rpc<string>(demoEditor, 'create_entry', { p_tenant_id: TENANT.demo, p_type: 'news' });
  });

  const refused = async (res: Response) => {
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect([res.status, await res.json()]).toEqual([401, { error: 'invalid_token' }]);
  };

  it('a token for tenant A is refused on tenant B\'s path, in either direction', async () => {
    await refused(await get('demo', await token(editor, 'labak', labakEntry)));
    await refused(await get('labak', await token(demoEditor, 'demo', demoEntry)));
    // The same tokens on their own tenant's path are accepted.
    expect((await get('labak', await token(editor, 'labak', labakEntry))).status).toBe(200);
  });

  it('a tampered token is refused: another entry in the payload, or a changed signature', async () => {
    const t = await token(editor, 'labak', labakEntry);
    const [payload, signature] = t.split('.') as [string, string];
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<string, unknown>;
    const other = Buffer.from(JSON.stringify({ ...claims, entry_id: demoEntry, tenant: 'demo' })).toString('base64url');
    await refused(await get('demo', `${other}.${signature}`));
    const later = Buffer.from(JSON.stringify({ ...claims, exp: (claims.exp as number) + 3600 })).toString('base64url');
    await refused(await get('labak', `${later}.${signature}`));
    const flipped = signature.startsWith('A') ? `B${signature.slice(1)}` : `A${signature.slice(1)}`;
    await refused(await get('labak', `${payload}.${flipped}`));
  });

  it('an expired token is refused', async () => {
    const t = await token(editor, 'labak', labakEntry);
    const { exp } = JSON.parse(Buffer.from(t.split('.')[0]!, 'base64url').toString()) as { exp: number };
    expect((await get('labak', t, deps({ now: exp - 1 }))).status).toBe(200);
    await refused(await get('labak', t, deps({ now: exp })));
  });

  it('no token, a malformed one, an unknown tenant and a tenant without a preview site are refused alike', async () => {
    const t = await token(editor, 'labak', labakEntry);
    await refused(await get('labak', null));
    await refused(await get('labak', 'not-a-token'));
    await refused(await get('enginn', t));
    await refused(await get('../labak', t));
    await ownerQuery('update cms.sites set active = false where id = $1', [siteIds.labak]);
    try {
      await refused(await get('labak', t));
    } finally {
      await ownerQuery('update cms.sites set active = true where id = $1', [siteIds.labak]);
    }
  });

  it('an archived entry is not found, though its token is valid', async () => {
    const id = await newEntry(editor, 'labak', news(await labakAsset(), 'Í geymslu'));
    const t = await token(editor, 'labak', id);
    await rpc(editor, 'archive_entry', { p_entry_id: id });
    const res = await get('labak', t);
    expect([res.status, await res.json()]).toEqual([404, { error: 'not_found' }]);
  });
});
