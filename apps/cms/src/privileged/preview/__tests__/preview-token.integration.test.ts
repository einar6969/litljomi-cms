// The preview token route against the local stack (spec §7.5, §8.5 Escalation "obtaining a preview
// token for another tenant's entry"; plan M3-10; A9 locally). Real sessions through the OTP path,
// the editor's JWT under RLS, and the preview secret read from Vault with the secret key.
//
// Each tenant gets one site with a preview URL and a preview secret, created idempotently and
// deactivated after the tests, so the delivery tests never notify them.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PREVIEW_TOKEN_TTL_SECONDS, verifyPreviewToken } from '@litljomi/cms-sdk';
import { anonClient, editorClient, retryRateLimited, secretClient } from '../../../../../../tests/integration/src/clients.ts';
import { env } from '../../../../../../tests/integration/src/env.ts';
import { PERSONAS, TENANT, type PersonaName } from '../../../../../../tests/integration/src/fixtures.ts';
import { closeAll, ownerQuery } from '../../../../../../tests/integration/src/sql.ts';
import type { SupabaseClient as AppClient } from '@/lib/supabase/types';
import { handlePreviewTokenRequest, mintPreviewToken, type MintDeps } from '../token';

const SITES = {
  demo: { baseUrl: 'http://127.0.0.1:3197', previewSecret: 'preview-token-test-demo-secret-0123456789' },
  labak: { baseUrl: 'http://127.0.0.1:3196', previewSecret: 'preview-token-test-labak-secret-0123456789' },
} as const;

// The app's clients default to the api schema; the code under test names it on every call anyway.
const asApp = (c: SupabaseClient) => c as unknown as AppClient;
const admin = () => asApp(createClient(env.apiUrl, env.secretKey, { auth: { persistSession: false, autoRefreshToken: false } }));
const deps = (editor: SupabaseClient, now = Date.now() / 1000): MintDeps => ({ editor: asApp(editor), admin: admin(), nowSeconds: () => now });

const siteIds: Record<keyof typeof SITES, string> = { demo: '', labak: '' };
const entries: Record<keyof typeof SITES, string> = { demo: '', labak: '' };

async function ensureSite(tenant: keyof typeof SITES): Promise<string> {
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

async function createEntry(persona: PersonaName, tenant: keyof typeof TENANT): Promise<string> {
  const c = await editorClient(persona);
  const { data, error } = await c.schema('api').rpc('create_entry', { p_tenant_id: TENANT[tenant], p_type: 'news' });
  if (error) throw new Error(`create_entry: ${error.message}`);
  return data as string;
}

/** A session of its own (not the cached persona's), so ending it affects no other test. */
async function freshSession(persona: PersonaName): Promise<{ client: SupabaseClient; accessToken: string }> {
  const link = await secretClient().auth.admin.generateLink({ type: 'magiclink', email: PERSONAS[persona].email });
  if (link.error) throw new Error(`generateLink: ${link.error.message}`);
  const client = anonClient();
  const verified = await retryRateLimited(() => client.auth.verifyOtp({ type: 'magiclink', token_hash: link.data.properties.hashed_token }));
  if (verified.error || !verified.data.session) throw new Error(`verifyOtp: ${verified.error?.message ?? 'no session'}`);
  return { client, accessToken: verified.data.session.access_token };
}

beforeAll(async () => {
  siteIds.demo = await ensureSite('demo');
  siteIds.labak = await ensureSite('labak');
  entries.demo = await createEntry('editor_demo', 'demo');
  entries.labak = await createEntry('editor_labak', 'labak');
});

afterAll(async () => {
  await ownerQuery('update cms.sites set active = false where id = any($1::uuid[])', [[siteIds.demo, siteIds.labak].filter(Boolean)]);
  await closeAll();
});

describe('preview tokens: who can obtain one (§7.5, §8.5 Escalation)', () => {
  it('an editor of the tenant gets a token for its entry, signed with its site\'s Vault secret', async () => {
    const now = Math.floor(Date.now() / 1000);
    const r = await mintPreviewToken(deps(await editorClient('editor_demo'), now), { entryId: entries.demo, siteId: siteIds.demo });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [row] = await ownerQuery<{ draft_version: number }>('select version as draft_version from cms.drafts where entry_id = $1', [entries.demo]);
    expect(verifyPreviewToken({ token: r.token, secrets: [SITES.demo.previewSecret], nowSeconds: now })).toEqual({
      tenant: 'demo',
      entry_id: entries.demo,
      draft_version: row!.draft_version,
      exp: now + PREVIEW_TOKEN_TTL_SECONDS,
    });
    expect(verifyPreviewToken({ token: r.token, secrets: [SITES.labak.previewSecret], nowSeconds: now })).toBeNull();
    expect(r.url.startsWith(`${SITES.demo.baseUrl}/api/cms/preview?token=`)).toBe(true);
    // Expiry: valid until exp, refused from then on.
    expect(verifyPreviewToken({ token: r.token, secrets: [SITES.demo.previewSecret], nowSeconds: r.expiresAt - 1 })).not.toBeNull();
    expect(verifyPreviewToken({ token: r.token, secrets: [SITES.demo.previewSecret], nowSeconds: r.expiresAt })).toBeNull();
  });

  it('the token names the current draft version', async () => {
    await ownerQuery('update cms.drafts set version = version + 1 where entry_id = $1', [entries.labak]);
    const [row] = await ownerQuery<{ version: number }>('select version from cms.drafts where entry_id = $1', [entries.labak]);
    const r = await mintPreviewToken(deps(await editorClient('editor_labak')), { entryId: entries.labak });
    expect(r.ok && verifyPreviewToken({ token: r.token, secrets: [SITES.labak.previewSecret], nowSeconds: Date.now() / 1000 })?.draft_version).toBe(row!.version);
  });

  it('an editor of tenant B cannot obtain a token for tenant A\'s entry, in either direction', async () => {
    expect(await mintPreviewToken(deps(await editorClient('editor_demo')), { entryId: entries.labak })).toEqual({ ok: false, failure: 'not_found' });
    expect(await mintPreviewToken(deps(await editorClient('editor_labak')), { entryId: entries.demo })).toEqual({ ok: false, failure: 'not_found' });
    // Naming the other tenant's site does not help: the site is chosen among the entry's tenant's.
    expect(await mintPreviewToken(deps(await editorClient('editor_demo')), { entryId: entries.demo, siteId: siteIds.labak })).toEqual({
      ok: false,
      failure: 'not_found',
    });
  });

  it.each(['outsider', 'revoked'] as const)('%s (no membership) cannot obtain a token', async (persona) => {
    for (const entryId of [entries.demo, entries.labak]) {
      expect(await mintPreviewToken(deps(await editorClient(persona)), { entryId })).toEqual({ ok: false, failure: 'not_found' });
    }
  });

  it('no session cannot obtain a token', async () => {
    expect(await mintPreviewToken(deps(anonClient()), { entryId: entries.demo })).toEqual({ ok: false, failure: 'auth' });
  });

  it('an ended session cannot obtain a token', async () => {
    const { client, accessToken } = await freshSession('editor_demo');
    expect((await mintPreviewToken(deps(client), { entryId: entries.demo, siteId: siteIds.demo })).ok).toBe(true);
    const out = await secretClient().auth.admin.signOut(accessToken, 'local');
    expect(out.error).toBeNull();
    expect(await mintPreviewToken(deps(client), { entryId: entries.demo, siteId: siteIds.demo })).toEqual({ ok: false, failure: 'auth' });
  });

  it('a tenant with no preview site gives preview_unavailable', async () => {
    await ownerQuery('update cms.sites set active = false where id = $1', [siteIds.labak]);
    try {
      expect(await mintPreviewToken(deps(await editorClient('editor_labak')), { entryId: entries.labak })).toEqual({
        ok: false,
        failure: 'preview_unavailable',
      });
    } finally {
      await ownerQuery('update cms.sites set active = true where id = $1', [siteIds.labak]);
    }
  });

  it('over HTTP: 200 never cached for the editor, 404 across tenants, and no secret in any response', async () => {
    // The demo tenant also has the seeded demo site's preview (M3-12), so the site is named.
    const post = (entryId: string, siteId?: string) =>
      new Request('http://cms.local/api/preview-token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entryId, siteId }) });
    const ok = await handlePreviewTokenRequest(post(entries.demo, siteIds.demo), async () => deps(await editorClient('editor_demo')));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('private, no-store');
    const okText = await ok.text();
    const cross = await handlePreviewTokenRequest(post(entries.labak), async () => deps(await editorClient('editor_demo')));
    expect([cross.status, await cross.json()]).toEqual([404, { error: 'not_found' }]);
    for (const s of Object.values(SITES)) expect(okText).not.toContain(s.previewSecret);
  });
});
