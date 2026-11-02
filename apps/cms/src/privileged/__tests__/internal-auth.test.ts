import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Wrap timingSafeEqual so the tests can show the comparison goes through it.
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const { timingSafeEqual } = await import('node:crypto');
const { verifyCronSecret, verifyInternalSecret } = await import('../internal-auth');

const INTERNAL = 'internal-secret-0123456789';
const CRON = 'cron-secret-0123456789';

const internalRequest = (value?: string) =>
  new Request('http://localhost/api/internal/worker', {
    method: 'POST',
    headers: value === undefined ? {} : { 'x-cms-internal-secret': value },
  });
const cronRequest = (authorization?: string) =>
  new Request('http://localhost/api/cron/sweep', { headers: authorization === undefined ? {} : { authorization } });

beforeEach(() => {
  vi.stubEnv('CMS_INTERNAL_SECRET', INTERNAL);
  vi.stubEnv('CRON_SECRET', CRON);
  vi.mocked(timingSafeEqual).mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('verifyInternalSecret', () => {
  it('accepts the configured secret, compared with timingSafeEqual', () => {
    expect(verifyInternalSecret(internalRequest(INTERNAL))).toBe(true);
    expect(timingSafeEqual).toHaveBeenCalledTimes(1);
  });
  it('rejects a wrong secret of the same length, compared with timingSafeEqual', () => {
    const wrong = INTERNAL.slice(0, -1) + 'x';
    expect(verifyInternalSecret(internalRequest(wrong))).toBe(false);
    expect(timingSafeEqual).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['shorter', INTERNAL.slice(0, -1)],
    ['longer', INTERNAL + 'x'],
    ['empty', ''],
  ])('returns false without throwing for a %s secret', (_label, value) => {
    expect(() => verifyInternalSecret(internalRequest(value))).not.toThrow();
    expect(verifyInternalSecret(internalRequest(value))).toBe(false);
  });
  it('rejects a request without the header', () => {
    expect(verifyInternalSecret(internalRequest())).toBe(false);
  });
  it('rejects the secret sent in another header', () => {
    const req = new Request('http://localhost/', { headers: { authorization: `Bearer ${INTERNAL}` } });
    expect(verifyInternalSecret(req)).toBe(false);
  });
  it.each([['unset', undefined], ['empty', '']])('rejects everything when CMS_INTERNAL_SECRET is %s', (_label, value) => {
    vi.stubEnv('CMS_INTERNAL_SECRET', value);
    expect(verifyInternalSecret(internalRequest(''))).toBe(false);
    expect(verifyInternalSecret(internalRequest('undefined'))).toBe(false);
    expect(verifyInternalSecret(internalRequest())).toBe(false);
  });
  it('does not accept the cron secret', () => {
    expect(verifyInternalSecret(internalRequest(CRON))).toBe(false);
  });
});

describe('verifyCronSecret', () => {
  it('accepts Authorization: Bearer <CRON_SECRET>, compared with timingSafeEqual', () => {
    expect(verifyCronSecret(cronRequest(`Bearer ${CRON}`))).toBe(true);
    expect(timingSafeEqual).toHaveBeenCalledTimes(1);
  });
  it('rejects a wrong secret of the same length', () => {
    expect(verifyCronSecret(cronRequest(`Bearer ${CRON.slice(0, -1)}x`))).toBe(false);
  });
  it.each([
    ['the bare secret', CRON],
    ['another scheme', `Basic ${CRON}`],
    ['a shorter secret', `Bearer ${CRON.slice(0, -1)}`],
    ['a longer secret', `Bearer ${CRON}x`],
    ['an empty bearer', 'Bearer '],
  ])('returns false without throwing for %s', (_label, value) => {
    expect(() => verifyCronSecret(cronRequest(value))).not.toThrow();
    expect(verifyCronSecret(cronRequest(value))).toBe(false);
  });
  it('rejects a request without Authorization', () => {
    expect(verifyCronSecret(cronRequest())).toBe(false);
  });
  it.each([['unset', undefined], ['empty', '']])('rejects everything when CRON_SECRET is %s', (_label, value) => {
    vi.stubEnv('CRON_SECRET', value);
    expect(verifyCronSecret(cronRequest('Bearer '))).toBe(false);
    expect(verifyCronSecret(cronRequest('Bearer undefined'))).toBe(false);
    expect(verifyCronSecret(cronRequest())).toBe(false);
  });
  it('does not accept the internal secret', () => {
    expect(verifyCronSecret(cronRequest(`Bearer ${INTERNAL}`))).toBe(false);
  });
});
