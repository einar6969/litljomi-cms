// Pure routing rules of sign-in, shared by the proxy and the auth callback.

/** The paths reachable without a session: the sign-in page and the magic-link callback. */
const PUBLIC_PATHS = new Set(['/login', '/auth/callback']);

export const isPublicPath = (pathname: string): boolean => PUBLIC_PATHS.has(pathname);

// A same-origin path: one leading `/`, not followed by `/` (a protocol-relative URL), and only
// printable ASCII without a backslash (browsers read `\` as `/`, and the URL parser drops tabs
// and newlines, so `/\evil` or `/<tab>/evil` would become `//evil`).
const SAME_ORIGIN_PATH = /^\/(?![/\\])[\x21-\x5b\x5d-\x7e]*$/;
const BASE = 'http://cms.invalid';

/** `value` if it is a path on this origin, else `/`, so a redirect never leaves the CMS. */
export function safeRedirectPath(value: string | null | undefined): string {
  if (typeof value !== 'string' || !SAME_ORIGIN_PATH.test(value)) return '/';
  // Belt and braces: the resolved URL must still be on the base origin.
  return new URL(value, BASE).origin === BASE ? value : '/';
}
