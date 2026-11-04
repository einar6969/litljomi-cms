import 'server-only';
import {
  ProjectionError,
  UpcastError,
  entryContentHash,
  projectEntry,
  type ContentType,
} from '@litljomi/cms-schema';
import { readUnverifiedPreviewClaims, verifyPreviewToken, type Bundle, type BundleEntry } from '@litljomi/cms-sdk';
import { getModule } from '@/modules/registry';
import type { SupabaseClient } from '@/lib/supabase/types';
import { supabaseReleaseStorage, type ReleaseStorage } from '../worker/build-release';
import { buildProjectionContext, type ContextAsset, type ContextEntry } from '../worker/projection-context';
import { callRpc } from '../worker/rpc';
import { MEDIA_PRIVATE, privateMediaPath } from '../worker/storage-paths';

/**
 * The preview endpoint (spec §7.5, §13.2; plan M3-11): `GET /api/preview/{tenant}` with a preview
 * token from the token route (M3-10) as `Authorization: Bearer <token>`. In draft mode the site's
 * SDK fetches its content here (M3-12).
 *
 * The token's shape, expiry and tenant claim are checked before any RPC; then the token is
 * verified with the preview secrets of the path's tenant's sites: a token of
 * another tenant is signed with another secret and is refused, and so is one whose `tenant` claim
 * is not the path's. Nothing about a draft is read before that. Token minting is the
 * authorization check for preview (§7.5): the endpoint returns what a valid token names and nothing
 * else.
 *
 * The response is the tenant's latest delivered release (the published content, as public as it
 * is in the delivery bucket) with the token's entry overlaid: its draft, at exactly the token's
 * draft version, upcast and projected like a release (§7.1, §7.2), replacing the entry's published
 * record or added to its type. The other entries are the release's records unchanged. The draft's
 * media are short-lived signed URLs of the private originals, since they may not be public yet,
 * valid no longer than the token.
 * Never cached (`private, no-store`).
 */

/** How long the signed media URLs of a preview stay valid at most: never past the token's `exp`. */
export const PREVIEW_MEDIA_TTL_SECONDS = 600;

/** A bundle (format 1) with one entry overlaid by its draft. `release` is 0 when nothing is delivered yet. */
export type PreviewBundle = Bundle & {
  preview: { entryId: string; draftVersion: number; expiresAt: number };
};

export type PreviewDeps = {
  /** The secret-key client (`createAdminClient`). */
  admin: SupabaseClient;
  /** The current time in Unix seconds. */
  nowSeconds: () => number;
  /** Reads the delivered bundle; defaults to the admin client's Storage API. */
  storage?: Pick<ReleaseStorage, 'download'>;
  /**
   * Signed URLs for `media-private` paths, valid `expiresIn` seconds; a path that cannot be signed
   * is left out. Defaults to the admin client's `createSignedUrls`.
   */
  signMedia?: (paths: string[], expiresIn: number) => Promise<Map<string, string>>;
  mediaTtlSeconds?: number;
};

export type PreviewFailure =
  /** No token, or a token that is malformed, tampered, expired, of another tenant, or for a tenant that cannot preview. */
  | 'invalid_token'
  /** The token's entry is not in the tenant, or is archived. */
  | 'not_found'
  /** The draft has a newer version than the token's: the editor previews again for a new token. */
  | 'draft_changed'
  /** The draft cannot be projected (an unknown type, a schema it cannot be upcast from, or data the type refuses). */
  | 'draft_invalid';

export type PreviewResult =
  | { ok: true; bundle: PreviewBundle }
  | { ok: false; failure: PreviewFailure; details?: Record<string, unknown> };

type PreviewSite = { id: string; preview_url: string; preview_secret: string };
type DraftAsset = Omit<ContextAsset, 'public_path'> & { original_path: string; archived: boolean };
type DraftRead = {
  entry: { id: string; type: string; slug: string | null; archived: boolean; first_published_at: string | null; last_published_at: string | null };
  draft: { data: unknown; version: number; schema_version: number };
  assets: DraftAsset[];
};
type ReleaseRow = { id: string | null; number: number | null; bundle_path: string | null };

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DELIVERY = 'delivery';

const fail = (failure: PreviewFailure, details?: Record<string, unknown>): PreviewResult =>
  details === undefined ? { ok: false, failure } : { ok: false, failure, details };

export async function readPreview(deps: PreviewDeps, input: { tenant: string; token: string }): Promise<PreviewResult> {
  const db = deps.admin;
  const slug = input.tenant;
  if (!SLUG_RE.test(slug) || slug.length > 63) return fail('invalid_token');

  // 0. Before any RPC: the token must have its shape, be in its lifetime and name the path's
  // tenant. Not an authorization (the signature is not checked yet), only a refusal of what can
  // never be valid, so a malformed or expired token costs no database read (security review B6).
  const now = deps.nowSeconds();
  const unverified = readUnverifiedPreviewClaims({ token: input.token, nowSeconds: now });
  if (unverified === null || unverified.tenant !== slug) return fail('invalid_token');

  // 1. The token, verified with the path's tenant's preview secrets before anything else is read.
  const tenantId = await callRpc<string | null>(db, 'worker_preview_tenant', { p_slug: slug });
  if (tenantId === null) return fail('invalid_token');
  const sites = ((await callRpc<PreviewSite[] | null>(db, 'worker_preview_sites', { p_tenant_id: tenantId })) ?? []) as PreviewSite[];
  // verifyPreviewToken never uses a secret shorter than 32 characters (security review B5).
  const secrets = sites.map((s) => s.preview_secret);
  const claims = secrets.length === 0 ? null : verifyPreviewToken({ token: input.token, secrets, nowSeconds: now });
  if (claims === null || claims.tenant !== slug) return fail('invalid_token');

  // 2. Exactly the token's entry and draft version, in this tenant.
  const read = await callRpc<DraftRead | null>(db, 'worker_preview_draft', { p_tenant_id: tenantId, p_entry_id: claims.entry_id });
  if (read === null || read.entry.archived) return fail('not_found');
  if (read.draft.version !== claims.draft_version) return fail('draft_changed');

  const module = getModule(slug);
  const type = module?.types.find((t) => t.name === read.entry.type);
  if (!module || !type) return fail('draft_invalid', { code: 'unknown_type' });
  const upcast = upcastDraft(type, read.draft);
  if ('error' in upcast) return fail('draft_invalid', upcast.error);

  // 3. The published content: the latest delivered release's bundle.
  const bundle = await deliveredBundle(deps, tenantId, slug);

  // 4. The draft's media: signed URLs of the originals (not archived, valid paths only).
  const usable = read.assets.filter((a) => !a.archived && validOriginal(tenantId, a));
  // Never longer than the token has left (security review B3), in whole seconds, rounded down:
  // claims.exp > now, so at least 1 s.
  const ttl = Math.max(1, Math.min(deps.mediaTtlSeconds ?? PREVIEW_MEDIA_TTL_SECONDS, Math.floor(claims.exp - now)));
  const sign = deps.signMedia ?? signWith(db);
  const signed = usable.length === 0 ? new Map<string, string>() : await sign(usable.map((a) => a.original_path), ttl);
  const contextAssets: ContextAsset[] = usable
    .filter((a) => signed.has(a.original_path))
    .map(({ original_path, archived: _archived, ...a }) => ({ ...a, public_path: original_path }));

  // 5. Project the draft like a release: references resolve to the release's entries and the draft itself.
  const { title, sortAt } = type.queryColumns(upcast.data);
  const draftSummary: ContextEntry = { id: read.entry.id, type: read.entry.type, slug: read.entry.slug, title, sortAt: isoOrNull(sortAt) };
  const released = Object.entries(bundle?.entries ?? {}).flatMap(([t, list]) =>
    list.filter((e) => e.id !== read.entry.id).map((e): ContextEntry => ({ id: e.id, type: t, slug: e.slug, title: e.title, sortAt: e.sortAt })),
  );
  const ctx = buildProjectionContext({
    module,
    entries: [...released, draftSummary],
    assets: contextAssets,
    mediaUrl: (path) => signed.get(path) ?? '',
  });
  let data: Record<string, unknown>;
  try {
    data = projectEntry(type, upcast.data, ctx);
  } catch (error) {
    return fail('draft_invalid', projectionError(error));
  }

  const generatedAt = new Date(now * 1000).toISOString();
  const record = {
    id: read.entry.id,
    // A draft has no revision; this names the draft version the preview shows.
    revisionId: `draft:${read.draft.version}`,
    slug: read.entry.slug,
    title,
    sortAt: draftSummary.sortAt,
    // As if published now: the entry keeps its first publication, if it has one.
    firstPublishedAt: read.entry.first_published_at === null ? generatedAt : new Date(read.entry.first_published_at).toISOString(),
    lastPublishedAt: generatedAt,
    schemaVersion: type.version,
    data,
  };
  const { id, revisionId, ...rest } = record;
  const overlaid: BundleEntry = { id, revisionId, contentHash: entryContentHash(record), ...rest };

  // 6. The overlay: the draft replaces its published record in place, or is added to its type.
  const entries: Record<string, BundleEntry[]> = {};
  for (const [t, list] of Object.entries(bundle?.entries ?? {})) entries[t] = [...list];
  const list = (entries[read.entry.type] ??= []);
  const at = list.findIndex((e) => e.id === overlaid.id);
  if (at === -1) list.push(overlaid);
  else list[at] = overlaid;

  return {
    ok: true,
    bundle: {
      format: 1,
      tenant: slug,
      release: bundle?.release ?? 0,
      generatedAt,
      entries,
      preview: { entryId: overlaid.id, draftVersion: read.draft.version, expiresAt: claims.exp },
    },
  };
}

/** The tenant's latest delivered bundle, checked to be that release's and tenant's; null before the first release. */
async function deliveredBundle(deps: PreviewDeps, tenantId: string, slug: string): Promise<Bundle | null> {
  const release = await callRpc<ReleaseRow | null>(deps.admin, 'worker_previous_release', { p_tenant_id: tenantId });
  if (release?.id == null) return null;
  if (!release.bundle_path) throw new Error(`delivered release ${String(release.number)} has no bundle path`);
  const storage = deps.storage ?? supabaseReleaseStorage(deps.admin);
  const bundle = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await storage.download(DELIVERY, release.bundle_path))) as Bundle;
  if (bundle?.format !== 1 || bundle.tenant !== slug || bundle.release !== release.number) {
    throw new Error(`bundle ${release.bundle_path} is not release ${String(release.number)} of the tenant`);
  }
  return bundle;
}

/** The original's stored path is the one its tenant, id and filename give (as the release build checks). */
function validOriginal(tenantId: string, a: DraftAsset): boolean {
  try {
    return a.original_path === privateMediaPath(tenantId, a.id, a.filename);
  } catch {
    return false;
  }
}

/** Signed URLs through the admin client's Storage API (service_role reads media-private). */
const signWith =
  (db: SupabaseClient) =>
  async (paths: string[], expiresIn: number): Promise<Map<string, string>> => {
    const { data, error } = await db.storage.from(MEDIA_PRIVATE).createSignedUrls(paths, expiresIn);
    if (error) throw error;
    const out = new Map<string, string>();
    for (const s of data ?? []) if (!s.error && s.path && s.signedUrl) out.set(s.path, s.signedUrl);
    return out;
  };

/** The draft's data at its type's current version (§5.3), in memory; the stored draft is not changed. */
function upcastDraft(type: ContentType, draft: DraftRead['draft']): { data: unknown } | { error: Record<string, unknown> } {
  try {
    return { data: type.upcast(draft.data, draft.schema_version) };
  } catch (error) {
    return {
      error: {
        code: 'upcast_failed',
        reason: error instanceof UpcastError ? error.code : 'unexpected',
        draftSchemaVersion: draft.schema_version,
        currentSchemaVersion: type.version,
      },
    };
  }
}

function projectionError(error: unknown): Record<string, unknown> {
  if (error instanceof ProjectionError) {
    return {
      code: 'projection_failed',
      issues: error.issues.slice(0, 20).map((i) => ({ code: i.code, path: i.path.map((p) => (typeof p === 'symbol' ? String(p) : p)) })),
    };
  }
  if (error instanceof RangeError) return { code: 'too_deep' };
  return { code: 'projection_error' };
}

function isoOrNull(s: string | null): string | null {
  if (s === null) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ---------------------------------------------------------------------------------------------
// HTTP

const STATUS: Record<PreviewFailure, number> = { invalid_token: 401, not_found: 404, draft_changed: 409, draft_invalid: 422 };

/** Never cached (§7.5, §13.2): the response holds a draft and is scoped by a short-lived token. */
const NO_STORE = { 'cache-control': 'private, no-store' };

const json = (status: number, value: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...NO_STORE, ...extra } });

const BEARER = /^Bearer ([A-Za-z0-9_.-]+)$/;

/**
 * GET /api/preview/{tenant} with `Authorization: Bearer <token>`. 200 with the {@link PreviewBundle};
 * 401 `invalid_token` for a missing, malformed, tampered or expired token, a token of another
 * tenant, or a tenant that cannot preview (one answer for all, so the endpoint tells nothing about
 * which tenants exist); 404 when the entry is gone or archived; 409 `draft_changed`; 422
 * `draft_invalid` with the issue codes and paths; 500 otherwise. Every response is
 * `cache-control: private, no-store`. The token is never read from the URL, which servers and
 * proxies log.
 */
export async function handlePreviewRequest(req: Request, tenant: string, deps: () => Promise<PreviewDeps>): Promise<Response> {
  const token = BEARER.exec(req.headers.get('authorization') ?? '')?.[1];
  if (token === undefined) return json(401, { error: 'invalid_token' }, { 'www-authenticate': 'Bearer' });
  try {
    const result = await readPreview(await deps(), { tenant, token });
    if (!result.ok) {
      const extra: Record<string, string> = result.failure === 'invalid_token' ? { 'www-authenticate': 'Bearer' } : {};
      return json(STATUS[result.failure], { error: result.failure, ...(result.details ? { details: result.details } : {}) }, extra);
    }
    return json(200, result.bundle);
  } catch (error) {
    // Codes only, never a secret or the token.
    console.error('[cms-preview] preview failed', error instanceof Error ? error.message : 'unknown error');
    return json(500, { error: 'error' });
  }
}
