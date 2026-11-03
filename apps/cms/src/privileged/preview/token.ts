import 'server-only';
import { z } from 'zod';
import { canonicalUuid } from '@litljomi/rich-text';
import { PREVIEW_TOKEN_TTL_SECONDS, signPreviewToken } from '@litljomi/cms-sdk';
// Not '@/lib/tenant': that module loads the editor's cookie-bound client (next/headers).
import { isActive } from '@/lib/tenant-status';
import type { SupabaseClient } from '@/lib/supabase/types';

/**
 * The preview token route's logic (spec §7.5, plan M3-10). The editor's session is verified with
 * Supabase Auth, and the entry is read with the editor's own JWT, so whether the editor may read it
 * is the database's decision (RLS). Only then is the site's preview secret read, with the secret
 * key through the service_role-only `api.worker_preview_sites`, and the token minted: HMAC over
 * `{tenant, entry_id, draft_version, exp}`, valid 10 minutes. Token minting is the authorization
 * check for preview (§7.5): the preview endpoint trusts what a valid token names.
 *
 * The secret never leaves this module; the response carries only the token, its expiry and the
 * site's preview URL with the token.
 */

export type MintDeps = {
  /** The editor's client: the publishable key and the editor's session. */
  editor: SupabaseClient;
  /** The secret-key client (`createAdminClient`). */
  admin: SupabaseClient;
  /** The current time in Unix seconds. */
  nowSeconds: () => number;
};

export type MintInput = { entryId: string; siteId?: string };

export type MintFailure =
  /** No signed-in editor, or Auth refused the session (expired, revoked, malformed). */
  | 'auth'
  /** The entry is not readable by the editor (another tenant's, or no such entry), or its tenant is not active. */
  | 'not_found'
  /** The tenant has no site that can preview (a preview URL and a preview secret). */
  | 'preview_unavailable'
  /** The tenant has more than one site that can preview and none was named. */
  | 'site_required';

export type MintResult =
  | { ok: true; token: string; expiresAt: number; url: string }
  | { ok: false; failure: MintFailure };

type PreviewSite = { id: string; preview_url: string; preview_secret: string };

const fail = (failure: MintFailure): MintResult => ({ ok: false, failure });

const PREVIEW_URL_PROTOCOLS = new Set(['https:', 'http:']);

export async function mintPreviewToken(deps: MintDeps, input: MintInput): Promise<MintResult> {
  let user: unknown;
  try {
    const { data, error } = await deps.editor.auth.getUser();
    user = error ? null : data.user;
  } catch {
    user = null;
  }
  if (!user) return fail('auth');

  // Read with the editor's JWT: RLS hides another tenant's entry and a non-member's tenant.
  const api = deps.editor.schema('api');
  const entry = await api.from('entry_list').select('id, tenant_id, draft_version').eq('id', input.entryId).maybeSingle();
  if (entry.error) {
    if (entry.status === 401) return fail('auth');
    throw new Error(`entry_list: ${entry.error.code}`);
  }
  if (!entry.data) return fail('not_found');
  const { tenant_id: tenantId, draft_version: draftVersion } = entry.data as { tenant_id: string; draft_version: number };
  const tenant = await api.from('my_tenants').select('id, slug, status').eq('id', tenantId).maybeSingle();
  if (tenant.error) {
    if (tenant.status === 401) return fail('auth');
    throw new Error(`my_tenants: ${tenant.error.code}`);
  }
  if (!tenant.data || !isActive(tenant.data)) return fail('not_found');
  const slug = (tenant.data as { slug: string }).slug;

  // Only now the secret, for the entry's own tenant.
  const sites = await deps.admin.schema('api').rpc('worker_preview_sites', { p_tenant_id: tenantId });
  if (sites.error) throw new Error(`worker_preview_sites: ${sites.error.code}`);
  const all = (sites.data ?? []) as PreviewSite[];
  let site: PreviewSite | undefined;
  if (input.siteId !== undefined) {
    site = all.find((s) => s.id === input.siteId);
    if (!site) return fail('not_found');
  } else {
    if (all.length === 0) return fail('preview_unavailable');
    if (all.length > 1) return fail('site_required');
    site = all[0];
  }
  if (!site) return fail('preview_unavailable');

  let url: URL;
  try {
    url = new URL(site.preview_url);
  } catch {
    return fail('preview_unavailable');
  }
  if (!PREVIEW_URL_PROTOCOLS.has(url.protocol)) return fail('preview_unavailable');

  const exp = Math.floor(deps.nowSeconds()) + PREVIEW_TOKEN_TTL_SECONDS;
  const token = signPreviewToken({ tenant: slug, entry_id: input.entryId, draft_version: draftVersion, exp }, site.preview_secret);
  url.searchParams.set('token', token);
  return { ok: true, token, expiresAt: exp, url: url.toString() };
}

// ---------------------------------------------------------------------------------------------
// HTTP

const body = z.strictObject({ entryId: canonicalUuid, siteId: canonicalUuid.optional() });

const STATUS: Record<MintFailure, number> = { auth: 401, not_found: 404, preview_unavailable: 409, site_required: 409 };

/** Never cached (§7.5, §13.2): the token is the editor's and short-lived. */
const NO_STORE = { 'cache-control': 'private, no-store' };

const json = (status: number, value: unknown) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...NO_STORE } });

/**
 * POST /api/preview-token with `{ entryId, siteId? }` as JSON. 200 `{ token, expiresAt, url }`;
 * 400 for another body; 401 without a valid session; 403 for a cross-origin request; 404 when the
 * editor cannot read the entry or names a site that is not one of its tenant's preview sites; 409
 * when the tenant has no preview site, or several and none named. The body of a failure is
 * `{ error: <code> }` only.
 *
 * Cross-site requests: the session cookies are SameSite=Lax, so a cross-site POST carries none; a
 * request with an `Origin` other than the route's own is refused as well, and only a JSON body is
 * accepted (a form cannot send one without a CORS preflight).
 */
export async function handlePreviewTokenRequest(req: Request, deps: () => Promise<MintDeps>): Promise<Response> {
  const origin = req.headers.get('origin');
  if (origin !== null && origin !== new URL(req.url).origin) return json(403, { error: 'forbidden' });
  const contentType = req.headers.get('content-type') ?? '';
  if (!/^application\/json(\s*;|$)/i.test(contentType)) return json(400, { error: 'bad_request' });
  let input: unknown;
  try {
    input = await req.json();
  } catch {
    return json(400, { error: 'bad_request' });
  }
  const parsed = body.safeParse(input);
  if (!parsed.success) return json(400, { error: 'bad_request' });
  try {
    const result = await mintPreviewToken(await deps(), parsed.data);
    if (!result.ok) return json(STATUS[result.failure], { error: result.failure });
    return json(200, { token: result.token, expiresAt: result.expiresAt, url: result.url });
  } catch (error) {
    // The error carries codes only, never a secret or the token.
    console.error('[cms-preview] preview token failed', error instanceof Error ? error.message : 'unknown error');
    return json(500, { error: 'error' });
  }
}
