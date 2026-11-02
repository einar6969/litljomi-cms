import { describe, expect, it } from 'vitest';
import { signWebhook, verifyWebhook } from '../index.ts';

const NOW = 1_800_000_000;
const body = '{"release":3}';
const check = (o: Partial<Parameters<typeof verifyWebhook>[0]>) =>
  verifyWebhook({ body, signature: signWebhook(body, 's1', NOW), timestamp: NOW, secrets: ['s1'], nowSeconds: NOW, ...o });

describe('webhook signing', () => {
  it('signs hex HMAC-SHA256 of "<timestamp>.<body>"', () => {
    expect(signWebhook(body, 's1', NOW)).toMatch(/^[0-9a-f]{64}$/);
    expect(signWebhook('b', 'k', 1)).toBe(signWebhook('b', 'k', 1));
    expect(signWebhook('b', 'k', 1)).not.toBe(signWebhook('b', 'k', 2));
  });
  it('round trip verifies', () => {
    expect(check({})).toBe(true);
  });
  it('rejects a wrong secret, a tampered body and a different timestamp', () => {
    expect(check({ secrets: ['other'] })).toBe(false);
    expect(check({ body: body + ' ' })).toBe(false);
    expect(check({ timestamp: NOW + 1 })).toBe(false);
  });
  it('tolerates 300 s and rejects 301 s, old or future', () => {
    const at = (t: number, now: number, tol?: number) =>
      verifyWebhook({ body, signature: signWebhook(body, 's1', t), timestamp: t, secrets: ['s1'], nowSeconds: now, toleranceSeconds: tol });
    expect(at(NOW - 300, NOW)).toBe(true);
    expect(at(NOW - 301, NOW)).toBe(false);
    expect(at(NOW + 301, NOW)).toBe(false);
    expect(at(NOW - 10, NOW, 5)).toBe(false);
  });
  it('accepts either of two rotation secrets', () => {
    const sig = signWebhook(body, 'new', NOW);
    expect(check({ signature: sig, secrets: ['old', 'new'] })).toBe(true);
    expect(check({ signature: signWebhook(body, 'old', NOW), secrets: ['old', 'new'] })).toBe(true);
    expect(check({ signature: sig, secrets: ['old'] })).toBe(false);
  });
  it('rejects malformed input without throwing', () => {
    for (const signature of ['', 'zz', 'abc', 'g'.repeat(64), signWebhook(body, 's1', NOW).toUpperCase().slice(0, 63)]) {
      expect(check({ signature })).toBe(false);
    }
    for (const timestamp of [NaN, Infinity, -1, 1.5]) expect(check({ timestamp })).toBe(false);
    expect(check({ nowSeconds: NaN })).toBe(false);
    expect(check({ secrets: [] })).toBe(false);
    expect(check({ secrets: [''], signature: signWebhook(body, '', NOW) })).toBe(false);
    expect(check({ signature: 5 as unknown as string })).toBe(false);
  });
});
