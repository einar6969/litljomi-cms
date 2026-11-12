import { describe, expect, it } from 'vitest';
import { t } from '@/i18n/is';
import { codeFailureMessage, setPasswordFailureMessage } from '../outcome';

// Auth's answers to PUT /user { password } on the local stack (GoTrue v2.197.0; tests/integration
// auth-confirm.test.ts, PW-03), in supabase-js's error shape.
const error = (status: number, code: string, message = 'x') => ({ name: 'AuthApiError', status, code, message });

describe('setPasswordFailureMessage (PW-03)', () => {
  it.each([
    ['a password shorter than Auth\'s minimum of 6', error(422, 'weak_password'), t.password.tooShort],
    ['the password the account has now', error(422, 'same_password'), t.password.same],
    ['a link session more than a day old (secure_password_change)', error(400, 'reauthentication_needed'), t.password.stale],
    ['Auth\'s rate limit', error(429, 'over_request_rate_limit'), t.login.rateLimited],
    ['a 429 without a code', { status: 429 }, t.login.rateLimited],
    ['a session Auth no longer knows', error(403, 'session_not_found'), t.password.failed],
    ['an Auth error', error(500, 'unexpected_failure'), t.password.failed],
    ['a network failure', new TypeError('Failed to fetch'), t.password.failed],
    ['nothing useful', undefined, t.password.failed],
  ])('%s: %j', (_case, failure, message) => {
    expect(setPasswordFailureMessage(failure)).toBe(message);
  });

  it('reads the code, not the text, of what Auth says', () => {
    expect(setPasswordFailureMessage(error(422, 'weak_password', 'Password should be at least 6 characters.'))).toBe(t.password.tooShort);
    expect(setPasswordFailureMessage({ status: 422, message: 'weak_password' })).toBe(t.password.failed);
  });
});

// Auth's answers to the TOTP challenge and verify (POST /factors/{id}/challenge, /verify), in
// supabase-js's error shape. As the console's code step: one sentence for every refusal (a wrong or
// expired code included), Auth's text never shown; only its rate limit is said apart.
describe('codeFailureMessage (PW-03)', () => {
  it.each([
    ['a wrong or expired code', error(422, 'mfa_verification_failed'), t.password.codeRefused],
    ['a factor Auth does not know', error(404, 'mfa_factor_not_found'), t.password.codeRefused],
    ['Auth\'s rate limit', error(429, 'over_request_rate_limit'), t.login.rateLimited],
    ['a 429 without a code', { status: 429 }, t.login.rateLimited],
    ['an Auth error', error(500, 'unexpected_failure'), t.password.codeRefused],
    ['a network failure', new TypeError('Failed to fetch'), t.password.codeRefused],
    ['nothing useful', undefined, t.password.codeRefused],
  ])('%s: %j', (_case, failure, message) => {
    expect(codeFailureMessage(failure)).toBe(message);
  });
});
