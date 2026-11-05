import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// redirect() ends a server action by throwing; the fake throws a recognisable error instead.
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  }),
}));
const auth = vi.hoisted(() => ({ verifyOtp: vi.fn(), getSession: vi.fn(), getUser: vi.fn(), setSession: vi.fn(), admin: { signOut: vi.fn() } }));
// The detached client (no cookies) a signed-in visitor's link is verified with (M3-14).
const detached = vi.hoisted(() => ({ verifyOtp: vi.fn(), admin: { signOut: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({ createEditorClient: vi.fn(async () => ({ auth })), createDetachedClient: vi.fn(() => ({ auth: detached })) }));
const pending = vi.hoisted(() => ({ readPending: vi.fn(), writePending: vi.fn(), clearPending: vi.fn() }));
vi.mock('../pending', () => pending);

const { createDetachedClient, createEditorClient } = await import('@/lib/supabase/server');
const { confirmSignIn, keepSession, replaceSession } = await import('../actions');

// The shapes local Supabase Auth (GoTrue v2.197.0) puts in `{{ .TokenHash }}`: a SHA-224 hex
// digest, prefixed `pkce_` when the link was requested by the PKCE client (observed 2026-11-02).
const HASH = '16b012167d533434e7798fb52bd2c600ea40eac016b347f9d5dd10f3';
const PKCE_HASH = `pkce_${HASH}`;
const FAILED = 'REDIRECT /login?error=link';
/** After the first of an email change's two confirmations (spec §4.4). */
const WAITING = /^REDIRECT \/login\?emailChange=waiting$/;
/** What Auth answers for the first of the two links: 200, and no session (supabase-js's shape). */
const FIRST_OF_TWO = { data: { session: null, user: { code: 200, msg: 'Confirmation link accepted.' } }, error: null };
/** The redirect to `/` exactly: a substring match would also pass on FAILED. */
const HOME = /^REDIRECT \/$/;
const OLD_TOKEN = 'eyJold.access.token';
const NEW_TOKEN = 'eyJnew.access.token';
const NEW_REFRESH = 'new-refresh-token';
const OLD_USER = 'user-old';
const NEW_USER = 'user-new';
const QUESTION = /^REDIRECT \/auth\/confirm$/;
const signedIn = (userId = OLD_USER) => {
  auth.getSession.mockResolvedValue({ data: { session: { access_token: OLD_TOKEN } }, error: null });
  auth.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
};
const linkSession = { access_token: NEW_TOKEN, refresh_token: NEW_REFRESH, user: { id: NEW_USER } };
const PENDING = { accessToken: NEW_TOKEN, refreshToken: NEW_REFRESH, next: '/t/acme' };

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
  auth.verifyOtp.mockResolvedValue({ data: { session: linkSession, user: linkSession.user }, error: null });
  auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  auth.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401, code: 'no_authorization', message: 'x' } });
  auth.setSession.mockImplementation(async (session: { access_token: string }) => ({ data: { session, user: {} }, error: null }));
  auth.admin.signOut.mockResolvedValue({ data: null, error: null });
  detached.verifyOtp.mockResolvedValue({ data: { session: linkSession, user: linkSession.user }, error: null });
  detached.admin.signOut.mockResolvedValue({ data: null, error: null });
  pending.readPending.mockResolvedValue(null);
  pending.writePending.mockResolvedValue(undefined);
  pending.clearPending.mockResolvedValue(undefined);
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  logs = vi.spyOn(console, 'log').mockImplementation(() => {});
  warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** Everything written to the console during the test, as one string. */
const consoleText = () => JSON.stringify([errors.mock.calls, logs.mock.calls, warns.mock.calls]);

describe('confirmSignIn with an email change link (spec §4.4)', () => {
  it.each([HASH, PKCE_HASH])('verifies %s with its POST, as type email_change', async (token_hash) => {
    await expect(confirmSignIn(form({ token_hash, type: 'email_change' }))).rejects.toThrow(HOME);
    expect(auth.verifyOtp).toHaveBeenCalledExactlyOnceWith({ token_hash, type: 'email_change' });
  });

  it('says the other address has to confirm too after the first of the two links, with no session and no error logged', async () => {
    auth.verifyOtp.mockResolvedValue(FIRST_OF_TWO);
    await expect(confirmSignIn(form({ token_hash: HASH, type: 'email_change', next: '/t/acme' }))).rejects.toThrow(WAITING);
    expect(errors).not.toHaveBeenCalled();
  });

  it('leaves a signed-in visitor\'s session alone after the first of the two links', async () => {
    signedIn();
    detached.verifyOtp.mockResolvedValue(FIRST_OF_TWO);
    await expect(confirmSignIn(form({ token_hash: HASH, type: 'email_change' }))).rejects.toThrow(WAITING);
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(auth.setSession).not.toHaveBeenCalled();
    expect(auth.admin.signOut).not.toHaveBeenCalled();
    expect(pending.writePending).not.toHaveBeenCalled();
  });

  it('after the second link, the session Auth issues takes over as a magic link\'s does', async () => {
    signedIn(NEW_USER);
    await expect(confirmSignIn(form({ token_hash: HASH, type: 'email_change' }))).rejects.toThrow(HOME);
    expect(detached.verifyOtp).toHaveBeenCalledExactlyOnceWith({ token_hash: HASH, type: 'email_change' });
    expect(auth.setSession).toHaveBeenCalledOnce();
  });

  it('asks a visitor signed in as another account before the second link\'s session replaces theirs', async () => {
    signedIn(OLD_USER);
    await expect(confirmSignIn(form({ token_hash: HASH, type: 'email_change' }))).rejects.toThrow(QUESTION);
    expect(pending.writePending).toHaveBeenCalledOnce();
    expect(auth.setSession).not.toHaveBeenCalled();
  });

  it('sends a refused link to the invalid-link notice, not to the waiting one', async () => {
    auth.verifyOtp.mockResolvedValue({ data: { session: null, user: null }, error: { status: 403, code: 'otp_expired', message: 'x' } });
    await expect(confirmSignIn(form({ token_hash: HASH, type: 'email_change' }))).rejects.toThrow(FAILED);
  });

  it.each(['email', 'invite'])('still counts a %s link that issues no session as failed', async (type) => {
    auth.verifyOtp.mockResolvedValue(FIRST_OF_TWO);
    await expect(confirmSignIn(form({ token_hash: HASH, type }))).rejects.toThrow(FAILED);
  });
});

describe('confirmSignIn', () => {
  it.each([
    ['email', HASH],
    ['email', PKCE_HASH],
    ['invite', HASH],
    ['invite', PKCE_HASH],
  ])('verifies a %s link (%s) with the editor client and goes to /', async (type, token_hash) => {
    await expect(confirmSignIn(form({ token_hash, type }))).rejects.toThrow(HOME);
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

  it.each(['magiclink', 'signup', 'recovery', 'sms', 'phone_change', 'email_change_new', 'email_change_current', 'EMAIL', 'EMAIL_CHANGE', ' email', '', undefined])(
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

  // Decision 42.2 (Q1) and M3-14: with a session already in the browser, the link is verified first
  // with the detached client, so a bad link leaves the visitor's session as it was and a good one
  // changes no cookie. A link for another account is held aside and the confirm page asks; a link
  // for the same account takes over at once and revokes the old session.
  describe('the session already in the browser, if any', () => {
    it('verifies the link without touching the cookies, holds its session aside and goes to the question', async () => {
      signedIn();
      await expect(confirmSignIn(form({ token_hash: HASH, type: 'email', next: '/t/acme' }))).rejects.toThrow(QUESTION);
      expect(createDetachedClient).toHaveBeenCalled();
      expect(detached.verifyOtp).toHaveBeenCalledExactlyOnceWith({ token_hash: HASH, type: 'email' });
      expect(auth.verifyOtp).not.toHaveBeenCalled();
      expect(auth.setSession).not.toHaveBeenCalled();
      expect(pending.writePending).toHaveBeenCalledExactlyOnceWith(PENDING);
      // The visitor's session is neither replaced nor revoked yet.
      expect(auth.admin.signOut).not.toHaveBeenCalled();
      expect(detached.admin.signOut).not.toHaveBeenCalled();
      expect(auth.getSession.mock.invocationCallOrder[0]!).toBeLessThan(detached.verifyOtp.mock.invocationCallOrder[0]!);
      expect(consoleText()).toBe('[[],[],[]]');
    });

    it('holds only a same-origin next path', async () => {
      signedIn();
      await expect(confirmSignIn(form({ token_hash: HASH, type: 'email', next: '//evil.example' }))).rejects.toThrow(QUESTION);
      expect(pending.writePending).toHaveBeenCalledExactlyOnceWith({ ...PENDING, next: '/' });
    });

    it('ends an earlier pending session before holding the new one', async () => {
      signedIn();
      pending.readPending.mockResolvedValue({ accessToken: 'eyJearlier.pending', refreshToken: 'r', next: '/' });
      await expect(confirmSignIn(form({ token_hash: HASH, type: 'email' }))).rejects.toThrow(QUESTION);
      expect(detached.admin.signOut).toHaveBeenCalledExactlyOnceWith('eyJearlier.pending', 'local');
      expect(pending.clearPending.mock.invocationCallOrder[0]!).toBeLessThan(pending.writePending.mock.invocationCallOrder[0]!);
    });

    it('lets a link for the same account take over at once, revoking only the old session', async () => {
      signedIn(NEW_USER);
      await expect(confirmSignIn(form({ token_hash: HASH, type: 'email', next: '/t/acme' }))).rejects.toThrow('REDIRECT /t/acme');
      expect(auth.setSession).toHaveBeenCalledExactlyOnceWith({ access_token: NEW_TOKEN, refresh_token: NEW_REFRESH });
      expect(auth.admin.signOut).toHaveBeenCalledExactlyOnceWith(OLD_TOKEN, 'local');
      expect(auth.setSession.mock.invocationCallOrder[0]!).toBeLessThan(auth.admin.signOut.mock.invocationCallOrder[0]!);
      expect(pending.writePending).not.toHaveBeenCalled();
    });

    it('compares the account Auth verifies for the cookie\'s token, not what the cookie claims', async () => {
      signedIn(NEW_USER);
      await expect(confirmSignIn(form({ token_hash: HASH, type: 'email' }))).rejects.toThrow(HOME);
      expect(auth.getUser).toHaveBeenCalledExactlyOnceWith(OLD_TOKEN);
    });

    it.each([
      ['answers an error', () => auth.getUser.mockResolvedValue({ data: { user: null }, error: { status: 403, code: 'session_not_found', message: 'x' } })],
      ['throws', () => auth.getUser.mockRejectedValue(new Error('network failed'))],
    ])('asks when Auth cannot say whose the old session is (getUser %s)', async (_case, arrange) => {
      signedIn(NEW_USER);
      arrange();
      await expect(confirmSignIn(form({ token_hash: HASH, type: 'email' }))).rejects.toThrow(QUESTION);
      expect(auth.setSession).not.toHaveBeenCalled();
    });

    it('goes to the sign-in page, revoking nothing, when Auth refuses the same account\'s new session', async () => {
      signedIn(NEW_USER);
      auth.setSession.mockResolvedValue({ data: { session: null, user: null }, error: { status: 403, code: 'session_not_found', message: 'x' } });
      await expect(confirmSignIn(form({ token_hash: HASH, type: 'email' }))).rejects.toThrow(FAILED);
      expect(auth.admin.signOut).not.toHaveBeenCalled();
    });

    it.each([
      ['the token hash is malformed', () => undefined, { token_hash: '123456', type: 'email' }],
      ['the type is not allowed', () => undefined, { token_hash: HASH, type: 'recovery' }],
      ['Auth refuses the link', () => detached.verifyOtp.mockResolvedValue({ data: {}, error: { status: 403, code: 'otp_expired', message: 'expired' } }), { token_hash: HASH, type: 'email' }],
      ['Auth answers without a session', () => detached.verifyOtp.mockResolvedValue({ data: { session: null, user: null }, error: null }), { token_hash: HASH, type: 'email' }],
      ['Auth throws', () => detached.verifyOtp.mockRejectedValue(new Error(`network failed for ${HASH}`)), { token_hash: HASH, type: 'email' }],
    ])('leaves the old session alone when %s', async (_case, arrange, fields) => {
      signedIn();
      arrange();
      await expect(confirmSignIn(form(fields))).rejects.toThrow(FAILED);
      expect(auth.setSession).not.toHaveBeenCalled();
      expect(auth.admin.signOut).not.toHaveBeenCalled();
      expect(pending.writePending).not.toHaveBeenCalled();
      expect(consoleText()).not.toContain(HASH);
    });

    it.each([
      ['reading it throws', () => auth.getSession.mockRejectedValue(new Error('cookie unreadable'))],
      ['Auth answers an error', () => auth.getSession.mockResolvedValue({ data: { session: null }, error: { status: 400, code: 'refresh_token_not_found', message: 'x' } })],
    ])('signs in directly when the old session cannot be read (%s)', async (_case, arrange) => {
      arrange();
      await expect(confirmSignIn(form({ token_hash: HASH, type: 'email' }))).rejects.toThrow(HOME);
      expect(auth.verifyOtp).toHaveBeenCalledOnce();
      expect(detached.verifyOtp).not.toHaveBeenCalled();
      expect(auth.admin.signOut).not.toHaveBeenCalled();
    });

    it('signs in directly, asking nothing and revoking nothing, when there was no session', async () => {
      await expect(confirmSignIn(form({ token_hash: HASH, type: 'email' }))).rejects.toThrow(HOME);
      expect(detached.verifyOtp).not.toHaveBeenCalled();
      expect(pending.writePending).not.toHaveBeenCalled();
      expect(auth.admin.signOut).not.toHaveBeenCalled();
    });
  });

  describe('replaceSession: "Skipta um aðgang" (M3-14)', () => {
    it('writes the pending session to the cookies, revokes the old one and goes to the link\'s next path', async () => {
      signedIn();
      pending.readPending.mockResolvedValue(PENDING);
      await expect(replaceSession()).rejects.toThrow('REDIRECT /t/acme');
      expect(pending.clearPending).toHaveBeenCalledOnce();
      expect(auth.setSession).toHaveBeenCalledExactlyOnceWith({ access_token: NEW_TOKEN, refresh_token: NEW_REFRESH });
      expect(auth.admin.signOut).toHaveBeenCalledExactlyOnceWith(OLD_TOKEN, 'local');
      expect(auth.setSession.mock.invocationCallOrder[0]!).toBeLessThan(auth.admin.signOut.mock.invocationCallOrder[0]!);
      expect(consoleText()).toBe('[[],[],[]]');
    });

    it('signs in with the pending session when the old one has gone meanwhile', async () => {
      pending.readPending.mockResolvedValue(PENDING);
      await expect(replaceSession()).rejects.toThrow('REDIRECT /t/acme');
      expect(auth.setSession).toHaveBeenCalledOnce();
      expect(auth.admin.signOut).not.toHaveBeenCalled();
    });

    it('re-checks the held next path', async () => {
      pending.readPending.mockResolvedValue({ ...PENDING, next: '//evil.example' });
      await expect(replaceSession()).rejects.toThrow(HOME);
    });

    it('goes to the sign-in page without a pending session', async () => {
      signedIn();
      await expect(replaceSession()).rejects.toThrow(FAILED);
      expect(auth.setSession).not.toHaveBeenCalled();
      expect(auth.admin.signOut).not.toHaveBeenCalled();
    });

    it.each([
      ['answers an error (expired or revoked)', () => auth.setSession.mockResolvedValue({ data: { session: null, user: null }, error: { status: 403, code: 'session_not_found', message: `bad ${NEW_TOKEN}` } })],
      ['throws', () => auth.setSession.mockRejectedValue(new Error(`network failed for ${NEW_TOKEN}`))],
    ])('keeps the old session when Auth %s, and never logs a token', async (_case, arrange) => {
      signedIn();
      pending.readPending.mockResolvedValue(PENDING);
      arrange();
      await expect(replaceSession()).rejects.toThrow(FAILED);
      expect(pending.clearPending).toHaveBeenCalledOnce();
      expect(auth.admin.signOut).not.toHaveBeenCalled();
      expect(consoleText()).not.toContain(NEW_TOKEN);
      expect(consoleText()).not.toContain(OLD_TOKEN);
    });

    it.each([
      ['answers an error', () => auth.admin.signOut.mockResolvedValue({ data: null, error: { status: 401, code: 'bad_jwt', message: `invalid JWT ${OLD_TOKEN}` } })],
      ['throws', () => auth.admin.signOut.mockRejectedValue(new Error(`network failed for ${OLD_TOKEN}`))],
    ])('still signs in when revoking the old session %s, and never logs either token', async (_case, arrange) => {
      signedIn();
      pending.readPending.mockResolvedValue(PENDING);
      arrange();
      await expect(replaceSession()).rejects.toThrow('REDIRECT /t/acme');
      expect(consoleText()).not.toContain(OLD_TOKEN);
      expect(consoleText()).not.toContain(NEW_TOKEN);
    });
  });

  describe('keepSession: "Hætta við" (M3-14)', () => {
    it('revokes the pending session, removes its cookie and goes to the start page, leaving the visitor\'s session', async () => {
      signedIn();
      pending.readPending.mockResolvedValue(PENDING);
      await expect(keepSession()).rejects.toThrow(HOME);
      expect(detached.admin.signOut).toHaveBeenCalledExactlyOnceWith(NEW_TOKEN, 'local');
      expect(pending.clearPending).toHaveBeenCalledOnce();
      expect(auth.setSession).not.toHaveBeenCalled();
      expect(auth.admin.signOut).not.toHaveBeenCalled();
    });

    it('still goes to the start page when there is nothing pending or revoking fails, logging no token', async () => {
      await expect(keepSession()).rejects.toThrow(HOME);
      expect(detached.admin.signOut).not.toHaveBeenCalled();
      pending.readPending.mockResolvedValue(PENDING);
      detached.admin.signOut.mockRejectedValue(new Error(`network failed for ${NEW_TOKEN}`));
      await expect(keepSession()).rejects.toThrow(HOME);
      expect(consoleText()).not.toContain(NEW_TOKEN);
    });
  });

  it('logs nothing about a successful sign-in', async () => {
    await expect(confirmSignIn(form({ token_hash: PKCE_HASH, type: 'email' }))).rejects.toThrow(HOME);
    expect(consoleText()).toBe('[[],[],[]]');
  });
});
