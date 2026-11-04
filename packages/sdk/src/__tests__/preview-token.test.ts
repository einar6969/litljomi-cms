import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MIN_PREVIEW_SECRET_LENGTH,
  PREVIEW_TOKEN_SKEW_SECONDS,
  PREVIEW_TOKEN_TTL_SECONDS,
  readUnverifiedPreviewClaims,
  signPreviewToken,
  verifyPreviewToken,
  type PreviewClaims,
} from '../index.ts';

const NOW = 1_800_000_000;
// Test values only, each 32 characters or more (MIN_PREVIEW_SECRET_LENGTH).
const S1 = 'preview-secret-one-0123456789abcdef';
const S2 = 'preview-secret-two-0123456789abcdef';
const NEW = 'preview-secret-new-0123456789abcdef';
const OLD = 'preview-secret-old-0123456789abcdef';
const claims: PreviewClaims = { tenant: 'demo', entry_id: '0b5d4c1e-2f3a-4b5c-8d7e-9f0a1b2c3d4e', draft_version: 3, exp: NOW + PREVIEW_TOKEN_TTL_SECONDS };
const verify = (token: string, secrets = [S1], nowSeconds = NOW) => verifyPreviewToken({ token, secrets, nowSeconds });
/** A token over an arbitrary payload object, signed as the real format is. */
const forge = (payload: unknown, secret = S1) => {
  const p = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${p}.${createHmac('sha256', secret).update(p, 'utf8').digest('base64url')}`;
};

describe('preview tokens (spec §7.5)', () => {
  it('carries exactly tenant, entry_id, draft_version and exp, signed with HMAC-SHA256', () => {
    const token = signPreviewToken(claims, S1);
    const [payload, signature] = token.split('.') as [string, string];
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))).toEqual(claims);
    expect(signature).toBe(createHmac('sha256', S1).update(payload).digest('base64url'));
    expect(token).toBe(forge(claims));
  });

  it('round trip verifies and returns the claims', () => {
    expect(verify(signPreviewToken(claims, S1))).toEqual(claims);
  });

  it('refuses a wrong secret, a tampered payload and a tampered signature', () => {
    const token = signPreviewToken(claims, S1);
    const [payload, signature] = token.split('.') as [string, string];
    expect(verify(token, [S2])).toBeNull();
    const other = Buffer.from(JSON.stringify({ ...claims, tenant: 'labak' })).toString('base64url');
    expect(verify(`${other}.${signature}`)).toBeNull();
    expect(verify(`${payload}.${signature.slice(0, -2)}AA`)).toBeNull();
  });

  it('accepts either of two rotation secrets', () => {
    expect(verify(signPreviewToken(claims, NEW), [OLD, NEW])).toEqual(claims);
    expect(verify(signPreviewToken(claims, OLD), [OLD, NEW])).toEqual(claims);
  });

  it('expires at exp, and refuses an expiry beyond the 10-minute lifetime plus skew', () => {
    const token = signPreviewToken(claims, S1);
    expect(verify(token, [S1], claims.exp - 1)).toEqual(claims);
    expect(verify(token, [S1], claims.exp)).toBeNull();
    expect(verify(token, [S1], claims.exp + 3600)).toBeNull();
    const far = { ...claims, exp: NOW + PREVIEW_TOKEN_TTL_SECONDS + PREVIEW_TOKEN_SKEW_SECONDS + 1 };
    expect(verify(signPreviewToken(far, S1))).toBeNull();
    const edge = { ...claims, exp: NOW + PREVIEW_TOKEN_TTL_SECONDS + PREVIEW_TOKEN_SKEW_SECONDS };
    expect(verify(signPreviewToken(edge, S1))).toEqual(edge);
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
    const token = signPreviewToken(claims, S1);
    for (const t of ['', '.', 'a', 'a.b.c', `${token}.x`, `${token}=`, token.replace('.', '..'), 'x'.repeat(2000), `${token.split('.')[0]}.!!`]) {
      expect(verify(t)).toBeNull();
    }
    expect(verify(token, [])).toBeNull();
    expect(verify(token, [''])).toBeNull();
    expect(verifyPreviewToken({ token: 1 as unknown as string, secrets: [S1], nowSeconds: NOW })).toBeNull();
    expect(verifyPreviewToken({ token, secrets: S1 as unknown as string[], nowSeconds: NOW })).toBeNull();
    expect(verifyPreviewToken({ token, secrets: [S1], nowSeconds: Number.NaN })).toBeNull();
  });

  it('refuses to sign malformed claims or with an empty secret', () => {
    expect(() => signPreviewToken(claims, '')).toThrow('empty secret');
    expect(() => signPreviewToken({ ...claims, draft_version: 0 }, S1)).toThrow('malformed claims');
    expect(() => signPreviewToken({ ...claims, extra: 1 } as PreviewClaims, S1)).toThrow('malformed claims');
  });

  // Security review B5: a preview secret has at least 32 characters, everywhere it is used.
  it('refuses to sign with, and never verifies against, a secret shorter than 32 characters', () => {
    expect(MIN_PREVIEW_SECRET_LENGTH).toBe(32);
    const short = 'x'.repeat(MIN_PREVIEW_SECRET_LENGTH - 1);
    const exact = 'x'.repeat(MIN_PREVIEW_SECRET_LENGTH);
    expect(() => signPreviewToken(claims, short)).toThrow('secret shorter than 32 characters');
    expect(verify(signPreviewToken(claims, exact), [exact])).toEqual(claims);
    // A token signed with a short secret (as an older site could hold) is refused, even listed.
    expect(verify(forge(claims, short), [short])).toBeNull();
    expect(verify(forge(claims, short), [short, S1])).toBeNull();
    expect(verify(forge(claims, 's1'), ['s1'])).toBeNull();
  });
});

// Security review B6: the endpoint checks the token's shape and expiry before it reads anything.
describe('readUnverifiedPreviewClaims', () => {
  const read = (token: unknown, nowSeconds = NOW) => readUnverifiedPreviewClaims({ token: token as string, nowSeconds });
  it('returns the claims of a well-formed token in its lifetime, whatever the signature', () => {
    expect(read(signPreviewToken(claims, S1))).toEqual(claims);
    expect(read(forge(claims, 'any-other-key'))).toEqual(claims);
  });
  it('null for an expired token, an expiry too far ahead, malformed claims or a malformed token, without throwing', () => {
    expect(read(signPreviewToken(claims, S1), claims.exp)).toBeNull();
    expect(read(forge({ ...claims, exp: NOW + PREVIEW_TOKEN_TTL_SECONDS + PREVIEW_TOKEN_SKEW_SECONDS + 1 }))).toBeNull();
    for (const payload of [{ ...claims, extra: 1 }, { ...claims, tenant: '../labak' }, { ...claims, draft_version: 0 }, null, [claims]]) {
      expect(read(forge(payload))).toBeNull();
    }
    const token = signPreviewToken(claims, S1);
    for (const t of ['', '.', 'a', 'a.b.c', `${token}.x`, 'x'.repeat(2000), `${token.split('.')[0]}.!!`, `!!.${token.split('.')[1]}`, 1, null]) {
      expect(read(t)).toBeNull();
    }
    expect(read(token, Number.NaN)).toBeNull();
  });
});
