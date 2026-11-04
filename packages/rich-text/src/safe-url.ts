// Checks for URLs that come from outside the document (resolver or context output). Anything that
// fails is treated as unresolved by the callers, so a faulty or hostile lookup cannot put a
// `javascript:`, `data:` or protocol-relative URL into delivered content.

// Control characters, space and DEL. Browsers strip tabs and newlines from URLs, so "/\t/evil.com"
// would otherwise become "//evil.com".
const UNSAFE_CHARS = /[\u0000- \u007f]/;

const BASE = 'http://site.invalid';

/**
 * A path on the same site: starts with a single `/`, not `//` or `/\`, no whitespace or control
 * characters, and still a path on the same site once dot segments are resolved: `/.//evil.com` and
 * `/%2e//evil.com` resolve to the path `//evil.com`, which a site that re-emits the resolved path
 * would turn into a protocol-relative URL.
 */
export function isRootRelativePath(s: string): boolean {
  if (!s.startsWith('/') || s[1] === '/' || s[1] === '\\' || UNSAFE_CHARS.test(s)) return false;
  let url: URL;
  try {
    url = new URL(s, BASE);
  } catch {
    return false;
  }
  return url.origin === BASE && !url.pathname.startsWith('//');
}

/**
 * The canonical form (`new URL(s).href`) of an absolute `https:` URL with a host, no credentials
 * (user or password) and no whitespace or control characters; null for anything else. Callers
 * deliver the canonical form, never the input: `https:m.test/a` parses to the host `m.test` here,
 * but a browser would resolve it against the page as a relative path (Task 15 security r1).
 */
export function canonicalHttpsUrl(s: string): string | null {
  if (UNSAFE_CHARS.test(s)) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname === '' || u.username !== '' || u.password !== '') return null;
  return u.href;
}

/** An absolute `https:` URL with a host, no credentials, no whitespace or control characters. */
export function isHttpsUrl(s: string): boolean {
  return canonicalHttpsUrl(s) !== null;
}
