import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Preview tokens (spec §7.5). The CMS's privileged token route mints one for an editor who can read
 * the entry: HMAC-SHA256 with the site's preview secret over `{tenant, entry_id, draft_version,
 * exp}`, valid 10 minutes. The site and the CMS preview endpoint verify it.
 *
 * Format: `<payload>.<signature>`, both base64url without padding. The payload is the UTF-8 JSON of
 * the claims; the signature is the HMAC of the payload's base64url text. Verification works on the
 * bytes received, so key order does not matter, but the key set is exact.
 */
export type PreviewClaims = {
  /** The tenant's slug, as the SDK's `tenant` and the preview endpoint's path name it. */
  tenant: string;
  entry_id: string;
  /** The draft version the editor previewed. */
  draft_version: number;
  /** Expiry, in Unix seconds. */
  exp: number;
};

export const PREVIEW_TOKEN_TTL_SECONDS = 600;
/** Clock skew allowed between the minting CMS and a verifier, on the expiry's upper bound only. */
export const PREVIEW_TOKEN_SKEW_SECONDS = 60;
/** Far above any real token (the claims are a slug, a UUID and two integers). */
const MAX_TOKEN_LENGTH = 1024;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const KEYS = ['draft_version', 'entry_id', 'exp', 'tenant'];

const sign = (payload: string, secret: string): Buffer => createHmac('sha256', secret).update(payload, 'utf8').digest();

/** True when the claims have the token's shape: a slug, a lowercase UUID, and positive integers. */
export function isPreviewClaims(c: unknown): c is PreviewClaims {
  if (typeof c !== 'object' || c === null || Array.isArray(c)) return false;
  const keys = Object.keys(c).sort();
  if (keys.length !== KEYS.length || keys.some((k, i) => k !== KEYS[i])) return false;
  const o = c as Record<string, unknown>;
  return (
    typeof o.tenant === 'string' && o.tenant.length <= 63 && SLUG_RE.test(o.tenant) &&
    typeof o.entry_id === 'string' && UUID_RE.test(o.entry_id) &&
    Number.isSafeInteger(o.draft_version) && (o.draft_version as number) >= 1 &&
    Number.isSafeInteger(o.exp) && (o.exp as number) > 0
  );
}

/** A token for the claims, signed with the site's preview secret. Throws on malformed claims or an empty secret. */
export function signPreviewToken(claims: PreviewClaims, secret: string): string {
  if (!isPreviewClaims(claims)) throw new Error('preview token: malformed claims');
  if (typeof secret !== 'string' || secret === '') throw new Error('preview token: empty secret');
  const { tenant, entry_id, draft_version, exp } = claims;
  const payload = Buffer.from(JSON.stringify({ tenant, entry_id, draft_version, exp }), 'utf8').toString('base64url');
  return `${payload}.${sign(payload, secret).toString('base64url')}`;
}

/**
 * The claims when `token` is signed by one of `secrets` (two are live during rotation), is not
 * expired at `nowSeconds`, and expires no later than the token lifetime (plus clock skew) from
 * now; otherwise null. Malformed input returns null and never throws. Every secret is checked, with
 * constant-time comparison.
 */
export function verifyPreviewToken(o: { token: string; secrets: string[]; nowSeconds: number }): PreviewClaims | null {
  try {
    if (typeof o.token !== 'string' || o.token.length > MAX_TOKEN_LENGTH || !Array.isArray(o.secrets)) return null;
    if (!Number.isFinite(o.nowSeconds)) return null;
    const parts = o.token.split('.');
    if (parts.length !== 2) return null;
    const [payload, signature] = parts as [string, string];
    if (!B64URL_RE.test(payload) || !B64URL_RE.test(signature)) return null;
    const given = Buffer.from(signature, 'base64url');
    // Canonical base64url only: a signature that does not round-trip is refused.
    if (given.toString('base64url') !== signature) return null;
    let ok = false;
    for (const secret of o.secrets) {
      if (typeof secret !== 'string' || secret === '') continue;
      const expected = sign(payload, secret);
      if (expected.length === given.length && timingSafeEqual(expected, given)) ok = true;
    }
    if (!ok) return null;
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!isPreviewClaims(claims)) return null;
    if (claims.exp <= o.nowSeconds) return null;
    if (claims.exp > o.nowSeconds + PREVIEW_TOKEN_TTL_SECONDS + PREVIEW_TOKEN_SKEW_SECONDS) return null;
    return claims;
  } catch {
    return null;
  }
}
