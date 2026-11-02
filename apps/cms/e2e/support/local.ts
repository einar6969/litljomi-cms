// The only places the CMS's Playwright tests reach (Einar, 2026-11-02: they run outside the Bash
// sandbox, so they reach only loopback addresses and this repository): the local CMS
// (`next start -p 3100`), the local Supabase API (54321) and its Mailpit (54324).
/** The port `next start` listens on (on 127.0.0.1), and the local Auth site URL's port (decision 37.4). */
export const CMS_PORT = 3100;
export const CMS_URL = `http://localhost:${CMS_PORT}`;
export const SUPABASE_URL = 'http://127.0.0.1:54321';
export const MAILPIT_URL = 'http://127.0.0.1:54324';

/**
 * Turns off the network calls of the CLIs the run starts (the Supabase CLI's GitHub release check
 * and telemetry, Next.js telemetry). Set on every child process of the e2e run.
 */
export const NO_CLI_NETWORK_ENV = {
  SUPABASE_NO_UPDATE_NOTIFIER: '1',
  SUPABASE_TELEMETRY_DISABLED: '1',
  NEXT_TELEMETRY_DISABLED: '1',
} as const;

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
