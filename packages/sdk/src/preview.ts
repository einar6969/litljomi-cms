import { MIN_PREVIEW_SECRET_LENGTH, isUsablePreviewSecret, verifyPreviewToken } from './preview-token.ts';

/**
 * Preview on the site (spec §7.5, plan M3-12). The editor's "Forskoða" sends the browser to the
 * site's preview route with a token from the CMS (`?token=…&path=…`). The route verifies the token
 * with the site's preview secret, enables Next.js draft mode, keeps the token in an HttpOnly cookie
 * for as long as it is valid, and redirects to the entry's path. In draft mode the SDK's client
 * reads from the CMS preview endpoint with that token (`createCmsClient`'s `preview` option).
 *
 * Nothing here depends on a Next.js version: the site passes its own `draftMode()` and `cookies()`.
 */

/** The cookie that carries the preview token while draft mode is on. */
export const PREVIEW_COOKIE = 'cms-preview';
/** The query parameter with the entry's path on the site (the module's `site.path`, spec §3.2). */
export const PREVIEW_PATH_PARAM = 'path';
/** The query parameter with the preview token. */
export const PREVIEW_TOKEN_PARAM = 'token';

const MAX_PATH_LENGTH = 2048;
const NO_STORE = { 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer' } as const;

/**
 * The secrets in a comma-separated list such as `CMS_PREVIEW_SECRETS` (two during rotation), each
 * trimmed. Throws, naming no secret, on an empty entry or one shorter than 32 characters
 * (`MIN_PREVIEW_SECRET_LENGTH`): a mistyped list is refused, not read as fewer secrets.
 */
export function parsePreviewSecrets(value: string): string[] {
  const list = value.split(',');
  return list.map((secret, i) => {
    const trimmed = secret.trim();
    if (trimmed === '') throw new Error(`preview secret list: entry ${i + 1} of ${list.length} is empty`);
    if (!isUsablePreviewSecret(trimmed)) {
      throw new Error(`preview secret list: entry ${i + 1} of ${list.length} is shorter than ${MIN_PREVIEW_SECRET_LENGTH} characters`);
    }
    return trimmed;
  });
}

/**
 * `path`, normalised, when it is a path on the site itself: it starts with one `/`, has no
 * backslash or control character, resolves to the same origin, and its normalised form does not
 * start with `//` either (`/.//evil.example` and `/%2e//evil.example` normalise to
 * `//evil.example`, which a browser reads as another host). Otherwise null, so the preview route
 * can never redirect to another site (the path is not part of the signed token). The check is on
 * the value returned, not only on the input.
 */
export function safePreviewPath(path: string | null): string | null {
  if (typeof path !== 'string' || path.length === 0 || path.length > MAX_PATH_LENGTH) return null;
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  // Backslashes are read as slashes by browsers ("/\evil.example"); control characters never belong.
  if (/[\\\u0000-\u001f\u007f]/.test(path)) return null;
  const base = 'http://site.invalid';
  let url: URL;
  try {
    url = new URL(path, base);
  } catch {
    return null;
  }
  if (url.origin !== base) return null;
  const normalised = `${url.pathname}${url.search}${url.hash}`;
  if (!normalised.startsWith('/') || normalised.startsWith('//')) return null;
  return normalised;
}

const answer = (status: number) => Response.json({ preview: false }, { status, headers: NO_STORE });

/**
 * Route handler (GET) for the site's preview route. 401 when the token is missing, malformed,
 * tampered, expired, signed with another secret, or for another tenant; 400 when the path is not
 * a path on this site; a plain 500 when `secrets()` throws or returns an empty entry or one shorter
 * than 32 characters. Draft mode
 * is enabled only after all of that has passed. Then 307 to the path, with the token in an
 * HttpOnly, SameSite=Lax cookie that expires with the token (Secure on https). Never cached.
 */
export function createPreviewHandler(o: {
  /** The site's tenant slug (`CMS_TENANT`): a token for another tenant is refused. */
  tenant: string;
  /** The site's preview secrets; parsePreviewSecrets reads `CMS_PREVIEW_SECRETS`. */
  secrets: () => string[];
  /** The site's `(await draftMode()).enable()`. */
  enableDraftMode: () => void | Promise<void>;
  now?: () => number;
}): (req: Request) => Promise<Response> {
  const now = o.now ?? Date.now;
  return async (req) => {
    const url = new URL(req.url);
    const token = url.searchParams.get(PREVIEW_TOKEN_PARAM) ?? '';
    let secrets: string[];
    try {
      secrets = o.secrets().map((s) => (typeof s === 'string' ? s.trim() : ''));
      if (secrets.length === 0 || !secrets.every(isUsablePreviewSecret)) throw new Error('preview secret list: empty or short entry');
    } catch {
      return answer(500);
    }
    const nowSeconds = Math.floor(now() / 1000);
    const claims = verifyPreviewToken({ token, secrets, nowSeconds });
    if (claims === null || claims.tenant !== o.tenant) return answer(401);
    const path = safePreviewPath(url.searchParams.get(PREVIEW_PATH_PARAM));
    if (path === null) return answer(400);

    await o.enableDraftMode();
    const cookie = [
      `${PREVIEW_COOKIE}=${token}`,
      'Path=/',
      `Max-Age=${Math.max(0, claims.exp - nowSeconds)}`,
      'HttpOnly',
      'SameSite=Lax',
      ...(url.protocol === 'https:' ? ['Secure'] : []),
    ].join('; ');
    // A relative Location: the site's own origin, whatever host the request reached it on.
    return new Response(null, { status: 307, headers: { location: path, 'set-cookie': cookie, ...NO_STORE } });
  };
}

/**
 * The preview token for the current request, or null. Draft mode is checked first, and the cookie
 * is read only when draft mode is on, so a normal visitor's page never reads cookies (which would
 * make it dynamic) and a preview cookie without draft mode is ignored. Pass the site's own
 * `draftMode` and `cookies` from `next/headers`.
 */
export async function readPreviewToken(o: {
  draftMode: () => Promise<{ isEnabled: boolean }>;
  cookies: () => Promise<{ get(name: string): { value: string } | undefined }>;
}): Promise<string | null> {
  if (!(await o.draftMode()).isEnabled) return null;
  const value = (await o.cookies()).get(PREVIEW_COOKIE)?.value;
  return value === undefined || value === '' ? null : value;
}

/** The CMS preview endpoint refused the token or the draft (spec §7.5; plan M3-11's codes). */
export class CmsPreviewError extends Error {
  constructor(
    readonly status: number,
    /** `invalid_token`, `not_found`, `draft_changed` (preview again for a new token), `draft_invalid`, or `error`. */
    readonly code: string,
  ) {
    super(`cms: preview responded ${status} ${code}`);
    this.name = 'CmsPreviewError';
  }
}
