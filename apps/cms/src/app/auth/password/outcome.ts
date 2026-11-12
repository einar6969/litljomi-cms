import { t } from '@/i18n/is';

/**
 * The message a refused or failed password update shows on the set-password page (PW-03). Auth's
 * own minimum of 6 is the only rule (spec §4.4), so its refusals are said plainly: too short, the
 * same as the account's current password, a link session more than a day old (`secure_password_change`
 * then wants a reauthentication the page does not offer), or its rate limit. Anything else, network
 * errors included, gets one message. Only the status and code of `failure` are read, never its text.
 */
export function setPasswordFailureMessage(failure: unknown): string {
  const { status, code } = typeof failure === 'object' && failure !== null ? (failure as { status?: unknown; code?: unknown }) : {};
  if (code === 'weak_password') return t.password.tooShort;
  if (code === 'same_password') return t.password.same;
  if (code === 'reauthentication_needed') return t.password.stale;
  if (status === 429 || code === 'over_request_rate_limit') return t.login.rateLimited;
  return t.password.failed;
}
