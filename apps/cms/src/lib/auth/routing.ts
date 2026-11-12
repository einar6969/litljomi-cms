// Pure routing rules of sign-in, shared by the proxy and the links' confirm action.

/** The page where the browser refreshes an expired session and goes back (R7; app/auth/refresh). */
export const REFRESH_PATH = '/auth/refresh';

/** The pages that use no session: the sign-in page, its "Gleymt lykilorð?" form and the refresh page. */
const SESSIONLESS_PAGES = new Set(['/login', '/login/forgot', REFRESH_PATH]);

/**
 * The paths reachable without a session: the pages that use none, and the links' confirm page.
 */
const PUBLIC_PATHS = new Set([...SESSIONLESS_PAGES, '/auth/confirm']);

export const isPublicPath = (pathname: string): boolean => PUBLIC_PATHS.has(pathname);

/**
 * Whether a page navigation to `pathname` with an expired session goes to the refresh page first
 * (R7): every page that uses the session, the confirm page included (it asks a signed-in visitor
 * before a link replaces the session, M3-14). Not the pages that use none: a failed refresh ends on
 * /login, so this never loops.
 */
export const refreshesExpiredSession = (pathname: string): boolean => !SESSIONLESS_PAGES.has(pathname);

// A same-origin path: one leading `/`, not followed by `/` (a protocol-relative URL), and only
// printable ASCII without a backslash (browsers read `\` as `/`, and the URL parser drops tabs
// and newlines, so `/\evil` or `/<tab>/evil` would become `//evil`).
const SAME_ORIGIN_PATH = /^\/(?![/\\])[\x21-\x5b\x5d-\x7e]*$/;
const BASE = 'http://cms.invalid';

/**
 * `value` if it is a path on this origin, else `/`, so a redirect never leaves the CMS. Dot
 * segments are resolved before the check as well: `/.//evil.example` or `/%2e//evil.example`
 * resolves to the path `//evil.example`, which anything that re-emits the resolved path would turn
 * into a protocol-relative URL, so it is refused.
 */
export function safeRedirectPath(value: string | null | undefined): string {
  if (typeof value !== 'string' || !SAME_ORIGIN_PATH.test(value)) return '/';
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return '/';
  }
  // The resolved URL must still be on the base origin, with a path that is not protocol-relative.
  return url.origin === BASE && !url.pathname.startsWith('//') ? value : '/';
}
