import { t } from '@/i18n/is';

/**
 * The message a failed password sign-in shows (spec §4.4). Auth's rate limit (429,
 * `over_request_rate_limit`) gets its own, so the editor knows to wait. Every other failure, a wrong
 * password, an unknown address, malformed input, an Auth or network error, gets the same neutral
 * one, so the answer never shows whether an account exists. `failure` is Auth's error or whatever
 * the call threw; only its status and code are read, never its text.
 */
export function signInFailureMessage(failure: unknown): string {
  return isRateLimit(failure) ? t.login.rateLimited : t.login.failed;
}

function isRateLimit(failure: unknown): boolean {
  if (typeof failure !== 'object' || failure === null) return false;
  const { status, code } = failure as { status?: unknown; code?: unknown };
  return status === 429 || code === 'over_request_rate_limit';
}
