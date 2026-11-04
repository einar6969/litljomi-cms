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
/**
 * The shortest preview secret accepted anywhere (security review B5): signing refuses a shorter
 * one, verification never uses one, and a site's secret list with one is broken.
 */
export const MIN_PREVIEW_SECRET_LENGTH = 32;
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

/** True for a string usable as a preview secret: at least {@link MIN_PREVIEW_SECRET_LENGTH} characters. */
export const isUsablePreviewSecret = (secret: unknown): secret is string =>
  typeof secret === 'string' && secret.length >= MIN_PREVIEW_SECRET_LENGTH;

/**
 * A token for the claims, signed with the site's preview secret. Throws on malformed claims, an
 * empty secret, or one shorter than {@link MIN_PREVIEW_SECRET_LENGTH}.
 */
export function signPreviewToken(claims: PreviewClaims, secret: string): string {
  if (!isPreviewClaims(claims)) throw new Error('preview token: malformed claims');
  if (typeof secret !== 'string' || secret === '') throw new Error('preview token: empty secret');
  if (!isUsablePreviewSecret(secret)) throw new Error(`preview token: secret shorter than ${MIN_PREVIEW_SECRET_LENGTH} characters`);
  const { tenant, entry_id, draft_version, exp } = claims;
  const payload = Buffer.from(JSON.stringify({ tenant, entry_id, draft_version, exp }), 'utf8').toString('base64url');
  return `${payload}.${sign(payload, secret).toString('base64url')}`;
}

type TokenParts = { payload: string; signature: string; claims: PreviewClaims };

/**
 * The token's two parts and its claims when it has the token's form, the claims have their shape,
 * and it is in its lifetime at `nowSeconds`: not expired, and expiring no later than the token
 * lifetime (plus clock skew) from now. The signature is not checked. Null otherwise.
 */
function parseToken(token: unknown, nowSeconds: unknown): TokenParts | null {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return null;
  if (typeof nowSeconds !== 'number' || !Number.isFinite(nowSeconds)) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts as [string, string];
  if (!B64URL_RE.test(payload) || !B64URL_RE.test(signature)) return null;
  const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (!isPreviewClaims(claims)) return null;
  if (claims.exp <= nowSeconds) return null;
  if (claims.exp > nowSeconds + PREVIEW_TOKEN_TTL_SECONDS + PREVIEW_TOKEN_SKEW_SECONDS) return null;
  return { payload, signature, claims };
}

/**
 * The claims of `token` when it has the token's form and shape and is in its lifetime at
 * `nowSeconds`, **without checking the signature**; otherwise null, never throwing. Only a
 * pre-check: the preview endpoint uses it to refuse a malformed or expired token, or one naming
 * another tenant, before it reads anything (security review B6). It never authorizes anything;
 * {@link verifyPreviewToken} does.
 */
export function readUnverifiedPreviewClaims(o: { token: string; nowSeconds: number }): PreviewClaims | null {
  try {
    return parseToken(o.token, o.nowSeconds)?.claims ?? null;
  } catch {
    return null;
  }
}

/**
 * The claims when `token` is signed by one of `secrets` (two are live during rotation), is not
 * expired at `nowSeconds`, and expires no later than the token lifetime (plus clock skew) from
 * now; otherwise null. Malformed input returns null and never throws. A secret shorter than
 * {@link MIN_PREVIEW_SECRET_LENGTH} is never used. Every usable secret is checked, with
 * constant-time comparison.
 */
export function verifyPreviewToken(o: { token: string; secrets: string[]; nowSeconds: number }): PreviewClaims | null {
  try {
    if (!Array.isArray(o.secrets)) return null;
    const parsed = parseToken(o.token, o.nowSeconds);
    if (parsed === null) return null;
    const given = Buffer.from(parsed.signature, 'base64url');
    // Canonical base64url only: a signature that does not round-trip is refused.
    if (given.toString('base64url') !== parsed.signature) return null;
    let ok = false;
    for (const secret of o.secrets) {
      if (!isUsablePreviewSecret(secret)) continue;
      const expected = sign(parsed.payload, secret);
      if (expected.length === given.length && timingSafeEqual(expected, given)) ok = true;
    }
    return ok ? parsed.claims : null;
  } catch {
    return null;
  }
}
