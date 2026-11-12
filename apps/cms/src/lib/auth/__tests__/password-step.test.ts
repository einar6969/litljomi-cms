import { describe, expect, it } from 'vitest';
import { PASSWORD_STEP_COOKIE, SET_PASSWORD_PATH, encodePasswordStep, passwordStepOf, sessionIdOf } from '../password-step';

const SESSION = '3f2b8c1e-5a4d-4e6f-9b0a-1c2d3e4f5a6b';
const OTHER = '9e8d7c6b-5a49-4382-a716-151413121110';
/** A token of Auth's shape: header, payload and signature, base64url (the signature is not checked here). */
const token = (payload: object) => `eyJhbGciOiJFUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.c2ln`;

describe('the set-password step (PW-03)', () => {
  it('has its own path and an httpOnly cookie name of its own', () => {
    expect(SET_PASSWORD_PATH).toBe('/auth/password');
    expect(PASSWORD_STEP_COOKIE).toBe('cms-set-password');
  });

  describe('sessionIdOf', () => {
    it('reads the session id from an access token', () => {
      expect(sessionIdOf(token({ sub: 'u', session_id: SESSION, email: 'jón@dæmi.is' }))).toBe(SESSION);
    });

    it.each([
      ['no token', undefined],
      ['an empty token', ''],
      ['one part', 'eyJ'],
      ['a payload that is not JSON', 'a.bm90IGpzb24.c'],
      ['a payload that is not an object', `a.${Buffer.from('"x"').toString('base64url')}.c`],
      ['no session id', token({ sub: 'u' })],
      ['a session id that is not a UUID', token({ session_id: 'not-a-uuid' })],
      ['a session id that is not a string', token({ session_id: 7 })],
    ])('gives null for %s', (_case, value) => {
      expect(sessionIdOf(value)).toBeNull();
    });
  });

  describe('passwordStepOf', () => {
    const raw = encodePasswordStep({ sessionId: SESSION, next: '/t/acme' });

    it('gives the step stored for the session of the access token', () => {
      expect(passwordStepOf(raw, token({ session_id: SESSION }))).toEqual({ sessionId: SESSION, next: '/t/acme' });
    });

    it('gives null for another session, such as one a later password sign-in made', () => {
      expect(passwordStepOf(raw, token({ session_id: OTHER }))).toBeNull();
    });

    it.each([
      ['no cookie', undefined, token({ session_id: SESSION })],
      ['an empty cookie', '', token({ session_id: SESSION })],
      ['a cookie that is not JSON', '{', token({ session_id: SESSION })],
      ['a cookie without a session id', JSON.stringify({ next: '/' }), token({ session_id: SESSION })],
      ['a cookie without a next path', JSON.stringify({ sessionId: SESSION }), token({ session_id: SESSION })],
      ['no access token', raw, undefined],
      ['an access token without a session id', raw, token({ sub: 'u' })],
    ])('gives null for %s', (_case, cookie, accessToken) => {
      expect(passwordStepOf(cookie, accessToken)).toBeNull();
    });
  });
});
