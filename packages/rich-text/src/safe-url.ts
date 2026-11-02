// Checks for URLs that come from outside the document (resolver or context output). Anything that
// fails is treated as unresolved by the callers, so a faulty or hostile lookup cannot put a
// `javascript:`, `data:` or protocol-relative URL into delivered content.

// Control characters, space and DEL. Browsers strip tabs and newlines from URLs, so "/\t/evil.com"
// would otherwise become "//evil.com".
const UNSAFE_CHARS = /[\u0000- \u007f]/;

/** A path on the same site: starts with a single `/`, not `//` or `/\`, no whitespace or control characters. */
export function isRootRelativePath(s: string): boolean {
  return s.startsWith('/') && s[1] !== '/' && s[1] !== '\\' && !UNSAFE_CHARS.test(s);
}

/** An absolute `https:` URL with a host, no whitespace or control characters. */
export function isHttpsUrl(s: string): boolean {
  if (UNSAFE_CHARS.test(s)) return false;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && u.hostname !== '';
  } catch {
    return false;
  }
}
