import { describe, expect, it } from 'vitest';
import { t } from '@/i18n/is';
import { signInFailureMessage } from '../outcome';

const KNOWN = 'editor@example.test';

// The errors as @supabase/auth-js 2.118 hands them to `signInWithPassword`'s caller: AuthApiError
// for an answer from Auth (status and error code), AuthRetryableFetchError for a request that never
// got one (status 0) or a gateway error, AuthInvalidCredentialsError for input it refuses itself.
const apiError = (status: number, code: string, message: string) => ({ name: 'AuthApiError', status, code, message });

describe('signInFailureMessage', () => {
  it.each([
    ['a wrong password on a real account', apiError(400, 'invalid_credentials', 'Invalid login credentials')],
    ['an unknown address', apiError(400, 'invalid_credentials', 'Invalid login credentials')],
    ['malformed input refused by Auth', apiError(400, 'validation_failed', 'Unsupported or invalid email address')],
    ['malformed input refused by the client', { name: 'AuthInvalidCredentialsError', status: 400, message: 'You must provide either an email or phone number and a password' }],
    ['an unconfirmed address', apiError(400, 'email_not_confirmed', 'Email not confirmed')],
    ['a refusal by the sign-in hook', apiError(403, 'unexpected_failure', 'Sign-in method not allowed')],
    ['an Auth server error', apiError(500, 'unexpected_failure', `failed for ${KNOWN}`)],
    ['a network failure', { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' }],
    ['a gateway error', { name: 'AuthRetryableFetchError', status: 503, message: 'Service Unavailable' }],
    ['a thrown TypeError', new TypeError('Failed to fetch')],
    ['an answer without a session', { name: 'AuthInvalidTokenResponseError', status: 500, message: 'Auth session or user missing' }],
    ['a thrown string', 'boom'],
    ['nothing at all', undefined],
    ['null', null],
  ])('gives the one neutral message for %s', (_case, failure) => {
    expect(signInFailureMessage(failure)).toBe(t.login.failed);
  });

  it.each([
    ['429 over_request_rate_limit', apiError(429, 'over_request_rate_limit', 'Request rate limit reached')],
    ['any other 429', apiError(429, 'too_many_requests', 'Too many requests')],
    ['the rate-limit code without a status', { code: 'over_request_rate_limit' }],
  ])('gives the rate-limit message for %s', (_case, failure) => {
    expect(signInFailureMessage(failure)).toBe(t.login.rateLimited);
  });

  it('keeps the two messages apart, and neither names the address', () => {
    expect(t.login.rateLimited).not.toBe(t.login.failed);
    expect(signInFailureMessage(apiError(400, 'invalid_credentials', `no user ${KNOWN}`))).not.toContain(KNOWN);
  });

  it('does not read a status or code it was not given as a number or a string', () => {
    expect(signInFailureMessage({ status: '429' })).toBe(t.login.failed);
    expect(signInFailureMessage({ code: ['over_request_rate_limit'] })).toBe(t.login.failed);
  });
});
