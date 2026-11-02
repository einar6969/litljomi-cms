import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// redirect() ends a server action by throwing; the fake throws a recognisable error instead.
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  }),
}));
const auth = vi.hoisted(() => ({ verifyOtp: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createEditorClient: vi.fn(async () => ({ auth })) }));

const { createEditorClient } = await import('@/lib/supabase/server');
const { confirmSignIn } = await import('../actions');

// The shapes local Supabase Auth (GoTrue v2.197.0) puts in `{{ .TokenHash }}`: a SHA-224 hex
// digest, prefixed `pkce_` when the link was requested by the PKCE client (observed 2026-11-02).
const HASH = '16b012167d533434e7798fb52bd2c600ea40eac016b347f9d5dd10f3';
const PKCE_HASH = `pkce_${HASH}`;
const FAILED = 'REDIRECT /login?error=link';

const form = (fields: Record<string, string | Blob | undefined>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) data.set(key, value);
  return data;
};

let errors: ReturnType<typeof vi.spyOn>;
let logs: ReturnType<typeof vi.spyOn>;
let warns: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  auth.verifyOtp.mockResolvedValue({ data: { session: {}, user: {} }, error: null });
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  logs = vi.spyOn(console, 'log').mockImplementation(() => {});
  warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** Everything written to the console during the test, as one string. */
const consoleText = () => JSON.stringify([errors.mock.calls, logs.mock.calls, warns.mock.calls]);

describe('confirmSignIn', () => {
  it.each([
    ['email', HASH],
    ['email', PKCE_HASH],
    ['invite', HASH],
    ['invite', PKCE_HASH],
  ])('verifies a %s link (%s) with the editor client and goes to /', async (type, token_hash) => {
    await expect(confirmSignIn(form({ token_hash, type }))).rejects.toThrow('REDIRECT /');
    expect(createEditorClient).toHaveBeenCalledOnce();
    expect(auth.verifyOtp).toHaveBeenCalledExactlyOnceWith({ token_hash, type });
  });

  it('goes to a same-origin `next` path after signing in', async () => {
    await expect(confirmSignIn(form({ token_hash: HASH, type: 'email', next: '/t/acme?x=1' }))).rejects.toThrow('REDIRECT /t/acme?x=1');
  });

  it.each(['//evil.example', '/\\evil.example', 'https://evil.example/', '/\t/evil.example', 'javascript:alert(1)', 't/acme', ''])(
    'never leaves the origin: next=%j goes to /',
    async (next) => {
      await expect(confirmSignIn(form({ token_hash: HASH, type: 'email', next }))).rejects.toThrow(/^REDIRECT \/$/);
      expect(auth.verifyOtp).toHaveBeenCalledOnce();
    },
  );

  it.each(['magiclink', 'signup', 'recovery', 'email_change', 'sms', 'phone_change', 'EMAIL', ' email', '', undefined])(
    'refuses the type %j without calling Auth',
    async (type) => {
      await expect(confirmSignIn(form({ token_hash: HASH, type }))).rejects.toThrow(FAILED);
      expect(createEditorClient).not.toHaveBeenCalled();
      expect(auth.verifyOtp).not.toHaveBeenCalled();
    },
  );

  it.each([
    undefined,
    '',
    HASH.slice(1),
    `${HASH}0`,
    HASH.toUpperCase(),
    `pkce_${HASH.slice(1)}`,
    `PKCE_${HASH}`,
    `pkce-${HASH}`,
    `xpkce_${HASH}`,
    `${HASH}\n`,
    ` ${HASH}`,
    `${HASH.slice(0, 55)}g`,
    '123456',
  ])('refuses the malformed token hash %j without calling Auth', async (token_hash) => {
    await expect(confirmSignIn(form({ token_hash, type: 'email' }))).rejects.toThrow(FAILED);
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it('ignores files in place of the fields', async () => {
    const data = new FormData();
    data.set('token_hash', new Blob([HASH]), 'hash.txt');
    data.set('type', 'email');
    await expect(confirmSignIn(data)).rejects.toThrow(FAILED);
    const typed = new FormData();
    typed.set('token_hash', HASH);
    typed.set('type', new Blob(['email']), 'type.txt');
    await expect(confirmSignIn(typed)).rejects.toThrow(FAILED);
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it.each([
    ['answers an error (used or expired link)', () => auth.verifyOtp.mockResolvedValue({ data: {}, error: { status: 403, code: 'otp_expired', message: 'Email link is invalid or has expired' } })],
    ['answers the hook refusal', () => auth.verifyOtp.mockResolvedValue({ data: {}, error: { status: 403, code: 'unexpected_failure', message: 'Only email sign-in is allowed' } })],
    ['answers without a session', () => auth.verifyOtp.mockResolvedValue({ data: { session: null, user: null }, error: null })],
    ['throws', () => auth.verifyOtp.mockRejectedValue(new Error(`network failed for ${HASH}`))],
  ])('goes back to the sign-in page when Auth %s, and never logs the token', async (_case, arrange) => {
    arrange();
    await expect(confirmSignIn(form({ token_hash: HASH, type: 'email', next: '/t/acme' }))).rejects.toThrow(FAILED);
    expect(consoleText()).not.toContain(HASH);
  });

  it('goes back to the sign-in page when the client cannot be created', async () => {
    vi.mocked(createEditorClient).mockRejectedValueOnce(new Error('NEXT_PUBLIC_SUPABASE_URL is not set'));
    await expect(confirmSignIn(form({ token_hash: HASH, type: 'email' }))).rejects.toThrow(FAILED);
  });

  it('logs nothing about a successful sign-in', async () => {
    await expect(confirmSignIn(form({ token_hash: PKCE_HASH, type: 'email' }))).rejects.toThrow('REDIRECT /');
    expect(consoleText()).toBe('[[],[],[]]');
  });
});
