import { t } from '@/i18n/is';

/**
 * The message a refused or failed password update shows on the set-password page (PW-03). Auth's
 * own minimum of 6 is the only rule (spec §4.4), so its refusals are said plainly: too short, the
 * same as the account's current password, a link session more than a day old (`secure_password_change`
 * then wants a reauthentication the page does not offer), or its rate limit. Anything else, network
 * errors included, gets one message. Only the status and code of `failure` are read, never its text.
 */
export function setPasswordFailureMessage(failure: unknown): string {
  const { status, code } = statusAndCode(failure);
  if (code === 'weak_password') return t.password.tooShort;
  if (code === 'same_password') return t.password.same;
  if (code === 'reauthentication_needed') return t.password.stale;
  if (isRateLimit(status, code)) return t.login.rateLimited;
  return t.password.failed;
}

/**
 * The message a refused or failed TOTP code shows on the set-password page, for an account with a
 * verified factor (PW-03). As the console's code step: one sentence for every refusal, a wrong or
 * expired code and a failure alike; only Auth's rate limit is said apart. Only the status and code
 * of `failure` are read, never its text.
 */
export function codeFailureMessage(failure: unknown): string {
  const { status, code } = statusAndCode(failure);
  return isRateLimit(status, code) ? t.login.rateLimited : t.password.codeRefused;
}

function statusAndCode(failure: unknown): { status?: unknown; code?: unknown } {
  return typeof failure === 'object' && failure !== null ? (failure as { status?: unknown; code?: unknown }) : {};
}

const isRateLimit = (status: unknown, code: unknown) => status === 429 || code === 'over_request_rate_limit';
