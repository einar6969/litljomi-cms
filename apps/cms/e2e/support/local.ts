// The only places the CMS's Playwright tests reach (Einar, 2026-11-02: they run outside the Bash
// sandbox, so they reach only loopback addresses and this repository): the local CMS
// (`next start` on `CMS_PORT` below), the local Supabase API and its Mailpit. Their ports are the
// stack slot's (CMS_STACK_SLOT, tools/stack/slot.ts): slot 1 is 3100, 54321 and 54324.
import { SLOT_VARIABLE, stackSlot, type StackSlot } from '../../../../tools/stack/slot.ts';

/** The stack slot this run uses. */
export const STACK: StackSlot = stackSlot();
/** The slot, passed on to every process the run starts. */
export const STACK_SLOT_ENV = { [SLOT_VARIABLE]: String(STACK.slot) } as const;
/** The port `next start` listens on (on 127.0.0.1), and the local Auth site URL's port (decision 37.4). */
export const CMS_PORT = STACK.ports.cms;
export const CMS_URL = STACK.cmsUrl;
export const SUPABASE_URL = STACK.apiUrl;
export const MAILPIT_URL = STACK.mailpitUrl;

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
