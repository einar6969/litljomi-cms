import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => store }));

const { clearPasswordStep, readPasswordStep, writePasswordStep } = await import('../step');
const { PASSWORD_STEP_COOKIE } = await import('@/lib/auth/password-step');
const { SESSION_MAX_AGE } = await import('@/lib/supabase/session-cookies');

const SESSION = '3f2b8c1e-5a4d-4e6f-9b0a-1c2d3e4f5a6b';
const token = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the set-password step\'s cookie (PW-03)', () => {
  it('is written for the session of the link\'s token: HTTP-only, same-site lax, every path, as long as a session cookie', async () => {
    await expect(writePasswordStep(token({ session_id: SESSION }), '/t/acme')).resolves.toBe(true);
    expect(store.set).toHaveBeenCalledExactlyOnceWith(PASSWORD_STEP_COOKIE, JSON.stringify({ sessionId: SESSION, next: '/t/acme' }), {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE,
    });
  });

  it('is not written for a token that names no session', async () => {
    await expect(writePasswordStep(token({ sub: 'u' }), '/')).resolves.toBe(false);
    expect(store.set).not.toHaveBeenCalled();
  });

  it('is read only for its own session', async () => {
    store.get.mockReturnValue({ name: PASSWORD_STEP_COOKIE, value: JSON.stringify({ sessionId: SESSION, next: '/x' }) });
    await expect(readPasswordStep(token({ session_id: SESSION }))).resolves.toEqual({ sessionId: SESSION, next: '/x' });
    await expect(readPasswordStep(token({ session_id: '9e8d7c6b-5a49-4382-a716-151413121110' }))).resolves.toBeNull();
    await expect(readPasswordStep(undefined)).resolves.toBeNull();
    expect(store.get).toHaveBeenCalledWith(PASSWORD_STEP_COOKIE);
  });

  it('is removed with the same flags', async () => {
    await clearPasswordStep();
    expect(store.set).toHaveBeenCalledExactlyOnceWith(PASSWORD_STEP_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
  });
});
