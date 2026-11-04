import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// redirect() ends a server action by throwing; the fake throws a recognisable error instead.
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  }),
}));
const auth = vi.hoisted(() => ({ signInWithOtp: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createEditorClient: vi.fn(async () => ({ auth })) }));
// The pending session a magic link left for the confirm page's question (M3-14).
const revoke = vi.hoisted(() => ({ discardPending: vi.fn() }));
vi.mock('@/app/auth/confirm/revoke', () => revoke);

const { createEditorClient } = await import('@/lib/supabase/server');
const { requestMagicLink, signOut } = await import('../actions');

const KNOWN = 'editor@example.test';
const SENT = 'REDIRECT /login?sent=1';

const form = (email: unknown) => {
  const data = new FormData();
  if (email !== undefined) data.set('email', email as string);
  return data;
};

let errors: ReturnType<typeof vi.spyOn>;
let logs: ReturnType<typeof vi.spyOn>;
let warns: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CMS_PUBLIC_URL', 'http://localhost:3100');
  auth.signInWithOtp.mockResolvedValue({ data: {}, error: null });
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  logs = vi.spyOn(console, 'log').mockImplementation(() => {});
  warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Everything written to the console during the test, as one string. */
const consoleText = () => JSON.stringify([errors.mock.calls, logs.mock.calls, warns.mock.calls]);

describe('requestMagicLink', () => {
  it('asks Auth for a magic link to an existing user only, landing on /auth/confirm, through the editor client', async () => {
    await expect(requestMagicLink(form(`  ${KNOWN} `))).rejects.toThrow(SENT);
    expect(createEditorClient).toHaveBeenCalledOnce();
    expect(auth.signInWithOtp).toHaveBeenCalledExactlyOnceWith({
      email: KNOWN,
      options: { shouldCreateUser: false, emailRedirectTo: 'http://localhost:3100/auth/confirm' },
    });
  });

  it('builds the landing URL from CMS_PUBLIC_URL without a doubled slash', async () => {
    vi.stubEnv('CMS_PUBLIC_URL', 'https://cms.example.test/');
    await expect(requestMagicLink(form(KNOWN))).rejects.toThrow(SENT);
    expect(auth.signInWithOtp.mock.calls[0]![0].options.emailRedirectTo).toBe('https://cms.example.test/auth/confirm');
  });

  // The same outcome whatever Auth answers, so the response never reveals whether an account
  // exists or a limit was hit; the email is never logged.
  it.each([
    ['an unknown email (shouldCreateUser: false)', { data: {}, error: { status: 422, code: 'otp_disabled', message: 'Signups not allowed for otp' } }],
    ['a rate limit', { data: {}, error: { status: 429, code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' } }],
    ['a per-address frequency limit', { data: {}, error: { status: 429, code: 'over_request_rate_limit', message: 'For security purposes…' } }],
    ['a server error', { data: {}, error: { status: 500, code: 'unexpected_failure', message: `failed for ${KNOWN}` } }],
  ])('gives the neutral outcome for %s and never logs the email', async (_case, answer) => {
    auth.signInWithOtp.mockResolvedValue(answer);
    await expect(requestMagicLink(form(KNOWN))).rejects.toThrow(SENT);
    expect(consoleText()).not.toContain(KNOWN);
  });

  it('gives the neutral outcome when the Auth call throws, without logging the email', async () => {
    auth.signInWithOtp.mockRejectedValue(new Error(`fetch failed for ${KNOWN}`));
    await expect(requestMagicLink(form(KNOWN))).rejects.toThrow(SENT);
    expect(consoleText()).not.toContain(KNOWN);
  });

  it.each([undefined, '', '   ', 'not-an-email', 'a@b', `${'x'.repeat(250)}@example.test`])(
    'gives the neutral outcome for the malformed address %j without calling Auth',
    async (email) => {
      await expect(requestMagicLink(form(email))).rejects.toThrow(SENT);
      expect(auth.signInWithOtp).not.toHaveBeenCalled();
    },
  );

  it('ignores a file in place of the address', async () => {
    const data = new FormData();
    data.set('email', new Blob([KNOWN]), 'email.txt');
    await expect(requestMagicLink(data)).rejects.toThrow(SENT);
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it('refuses to run without CMS_PUBLIC_URL, before calling Auth', async () => {
    vi.stubEnv('CMS_PUBLIC_URL', '');
    await expect(requestMagicLink(form(KNOWN))).rejects.toThrow('CMS_PUBLIC_URL is not set');
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
  });
});

describe('signOut', () => {
  it('ends the session through the editor client and returns to the sign-in page', async () => {
    auth.signOut.mockResolvedValue({ error: null });
    await expect(signOut()).rejects.toThrow('REDIRECT /login');
    expect(auth.signOut).toHaveBeenCalledOnce();
  });

  it('discards a pending session from the confirm page before ending the session', async () => {
    const order: string[] = [];
    revoke.discardPending.mockImplementation(async () => void order.push('discardPending'));
    auth.signOut.mockImplementation(async () => (order.push('signOut'), { error: null }));
    await expect(signOut()).rejects.toThrow('REDIRECT /login');
    expect(order).toEqual(['discardPending', 'signOut']);
  });

  it('still signs out when discarding the pending session fails, logging no detail', async () => {
    revoke.discardPending.mockRejectedValue(new Error('cookie store refused eyJsecret'));
    auth.signOut.mockResolvedValue({ error: null });
    await expect(signOut()).rejects.toThrow('REDIRECT /login');
    expect(auth.signOut).toHaveBeenCalledOnce();
    expect(consoleText()).not.toContain('eyJsecret');
  });
});
