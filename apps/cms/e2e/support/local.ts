// The only places the CMS's Playwright tests reach (Einar, 2026-11-02: they run outside the Bash
// sandbox, so they reach only loopback addresses and this repository): the local CMS
// (`next start -p 3100`), the local Supabase API (54321) and its Mailpit (54324).
export const CMS_URL = 'http://localhost:3100';
export const SUPABASE_URL = 'http://127.0.0.1:54321';
export const MAILPIT_URL = 'http://127.0.0.1:54324';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** True for an http(s) URL on a loopback host; anything else, including a malformed URL, is false. */
export function isLoopbackUrl(url: string | URL): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && LOOPBACK_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

/** Throws unless `url` is on a loopback host; returns it as a URL. */
export function requireLoopback(url: string): URL {
  if (!isLoopbackUrl(url)) throw new Error(`refusing a non-loopback URL: ${url}`);
  return new URL(url);
}
