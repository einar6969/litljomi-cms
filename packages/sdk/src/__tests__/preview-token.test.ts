import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PREVIEW_TOKEN_SKEW_SECONDS, PREVIEW_TOKEN_TTL_SECONDS, signPreviewToken, verifyPreviewToken, type PreviewClaims } from '../index.ts';

const NOW = 1_800_000_000;
const claims: PreviewClaims = { tenant: 'demo', entry_id: '0b5d4c1e-2f3a-4b5c-8d7e-9f0a1b2c3d4e', draft_version: 3, exp: NOW + PREVIEW_TOKEN_TTL_SECONDS };
const verify = (token: string, secrets = ['s1'], nowSeconds = NOW) => verifyPreviewToken({ token, secrets, nowSeconds });
/** A token over an arbitrary payload object, signed as the real format is. */
const forge = (payload: unknown, secret = 's1') => {
  const p = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${p}.${createHmac('sha256', secret).update(p, 'utf8').digest('base64url')}`;
};

describe('preview tokens (spec §7.5)', () => {
  it('carries exactly tenant, entry_id, draft_version and exp, signed with HMAC-SHA256', () => {
    const token = signPreviewToken(claims, 's1');
    const [payload, signature] = token.split('.') as [string, string];
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))).toEqual(claims);
    expect(signature).toBe(createHmac('sha256', 's1').update(payload).digest('base64url'));
    expect(token).toBe(forge(claims));
  });

  it('round trip verifies and returns the claims', () => {
    expect(verify(signPreviewToken(claims, 's1'))).toEqual(claims);
  });

  it('refuses a wrong secret, a tampered payload and a tampered signature', () => {
    const token = signPreviewToken(claims, 's1');
    const [payload, signature] = token.split('.') as [string, string];
    expect(verify(token, ['s2'])).toBeNull();
    const other = Buffer.from(JSON.stringify({ ...claims, tenant: 'labak' })).toString('base64url');
    expect(verify(`${other}.${signature}`)).toBeNull();
    expect(verify(`${payload}.${signature.slice(0, -2)}AA`)).toBeNull();
  });

  it('accepts either of two rotation secrets', () => {
    expect(verify(signPreviewToken(claims, 'new'), ['old', 'new'])).toEqual(claims);
    expect(verify(signPreviewToken(claims, 'old'), ['old', 'new'])).toEqual(claims);
  });

  it('expires at exp, and refuses an expiry beyond the 10-minute lifetime plus skew', () => {
    const token = signPreviewToken(claims, 's1');
    expect(verify(token, ['s1'], claims.exp - 1)).toEqual(claims);
    expect(verify(token, ['s1'], claims.exp)).toBeNull();
    expect(verify(token, ['s1'], claims.exp + 3600)).toBeNull();
    const far = { ...claims, exp: NOW + PREVIEW_TOKEN_TTL_SECONDS + PREVIEW_TOKEN_SKEW_SECONDS + 1 };
    expect(verify(signPreviewToken(far, 's1'))).toBeNull();
    const edge = { ...claims, exp: NOW + PREVIEW_TOKEN_TTL_SECONDS + PREVIEW_TOKEN_SKEW_SECONDS };
    expect(verify(signPreviewToken(edge, 's1'))).toEqual(edge);
  });

  it('refuses correctly signed payloads that are not exactly the claims', () => {
    for (const payload of [
      { ...claims, extra: 1 },
      { tenant: claims.tenant, entry_id: claims.entry_id, exp: claims.exp },
      { ...claims, tenant: 'Demo' },
      { ...claims, tenant: '../labak' },
      { ...claims, entry_id: 'not-a-uuid' },
      { ...claims, entry_id: claims.entry_id.toUpperCase() },
      { ...claims, draft_version: 0 },
      { ...claims, draft_version: 1.5 },
      { ...claims, draft_version: '3' },
      { ...claims, exp: String(claims.exp) },
      [claims],
      null,
    ]) {
      expect(verify(forge(payload))).toBeNull();
    }
  });

  it('refuses malformed tokens and secrets without throwing', () => {
    const token = signPreviewToken(claims, 's1');
    for (const t of ['', '.', 'a', 'a.b.c', `${token}.x`, `${token}=`, token.replace('.', '..'), 'x'.repeat(2000), `${token.split('.')[0]}.!!`]) {
      expect(verify(t)).toBeNull();
    }
    expect(verify(token, [])).toBeNull();
    expect(verify(token, [''])).toBeNull();
    expect(verifyPreviewToken({ token: 1 as unknown as string, secrets: ['s1'], nowSeconds: NOW })).toBeNull();
    expect(verifyPreviewToken({ token, secrets: 's1' as unknown as string[], nowSeconds: NOW })).toBeNull();
    expect(verifyPreviewToken({ token, secrets: ['s1'], nowSeconds: Number.NaN })).toBeNull();
  });

  it('refuses to sign malformed claims or with an empty secret', () => {
    expect(() => signPreviewToken(claims, '')).toThrow('empty secret');
    expect(() => signPreviewToken({ ...claims, draft_version: 0 }, 's1')).toThrow('malformed claims');
    expect(() => signPreviewToken({ ...claims, extra: 1 } as PreviewClaims, 's1')).toThrow('malformed claims');
  });
});
