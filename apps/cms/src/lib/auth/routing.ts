// Pure routing rules of sign-in, shared by the proxy and the magic link's confirm action.

/** The paths reachable without a session: the sign-in page and the magic link's confirm page. */
const PUBLIC_PATHS = new Set(['/login', '/auth/confirm']);

export const isPublicPath = (pathname: string): boolean => PUBLIC_PATHS.has(pathname);

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
