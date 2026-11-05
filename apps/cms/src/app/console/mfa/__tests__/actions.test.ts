import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  }),
}));
const access = vi.hoisted(() => ({ consoleAccess: vi.fn() }));
vi.mock('@/lib/console-access', () => access);
const auth = vi.hoisted(() => ({ getUser: vi.fn(), mfa: { listFactors: vi.fn(), challengeAndVerify: vi.fn(), enroll: vi.fn(), unenroll: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({ createEditorClient: vi.fn(async () => ({ auth })) }));

const { createEditorClient } = await import('@/lib/supabase/server');
const { verifyCode } = await import('../actions');

const CODE = '123456';
const REFUSED = { error: "That code didn't work. Try again." };
const AUTH_MESSAGE = 'Invalid TOTP code entered';

const VERIFIED = { id: 'f1', factor_type: 'totp', status: 'verified' };
const UNVERIFIED = { id: 'f2', factor_type: 'totp', status: 'unverified' };
const factors = (...all: Array<{ id: string; factor_type: string; status: string }>) => ({
  data: { all, totp: all.filter((f) => f.status === 'verified'), phone: [], webauthn: [], recovery_code: [] },
  error: null,
});

const form = (code: unknown) => {
  const data = new FormData();
  if (code !== undefined) data.set('code', code as string);
  return data;
};
const verify = (code: unknown) => verifyCode({}, form(code));

let errors: ReturnType<typeof vi.spyOn>;
let logs: ReturnType<typeof vi.spyOn>;
let warns: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  access.consoleAccess.mockResolvedValue('needs_mfa');
  auth.mfa.listFactors.mockResolvedValue(factors(VERIFIED));
  auth.mfa.challengeAndVerify.mockResolvedValue({ data: {}, error: null });
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  logs = vi.spyOn(console, 'log').mockImplementation(() => {});
  warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const consoleText = () => JSON.stringify([errors.mock.calls, logs.mock.calls, warns.mock.calls]);

describe('verifyCode', () => {
  it('verifies the code against the verified factor through the signed-in client, then goes to /console', async () => {
    await expect(verify(CODE)).rejects.toThrow('REDIRECT /console');
    expect(createEditorClient).toHaveBeenCalled();
    expect(auth.mfa.challengeAndVerify).toHaveBeenCalledExactlyOnceWith({ factorId: 'f1', code: CODE });
  });

  it('completes an enrolment by verifying the unverified factor', async () => {
    auth.mfa.listFactors.mockResolvedValue(factors(UNVERIFIED));
    await expect(verify(CODE)).rejects.toThrow('REDIRECT /console');
    expect(auth.mfa.challengeAndVerify).toHaveBeenCalledExactlyOnceWith({ factorId: 'f2', code: CODE });
  });

  it('prefers the verified factor when an unverified one sits beside it', async () => {
    auth.mfa.listFactors.mockResolvedValue(factors(UNVERIFIED, VERIFIED));
    await expect(verify(CODE)).rejects.toThrow('REDIRECT /console');
    expect(auth.mfa.challengeAndVerify).toHaveBeenCalledExactlyOnceWith({ factorId: 'f1', code: CODE });
  });

  it('takes no factor from the form', async () => {
    const data = form(CODE);
    data.set('factorId', 'someone-elses');
    await expect(verifyCode({}, data)).rejects.toThrow('REDIRECT /console');
    expect(auth.mfa.challengeAndVerify).toHaveBeenCalledExactlyOnceWith({ factorId: 'f1', code: CODE });
  });

  it('answers only the fixed sentence when Auth refuses the code, and logs neither code nor message', async () => {
    auth.mfa.challengeAndVerify.mockResolvedValue({ data: null, error: { status: 422, code: 'mfa_verification_failed', message: AUTH_MESSAGE } });
    await expect(verify(CODE)).resolves.toEqual(REFUSED);
    expect(consoleText()).not.toContain(CODE);
    expect(consoleText()).not.toContain(AUTH_MESSAGE);
  });

  it('logs the status and code of any other Auth failure, and still answers the fixed sentence', async () => {
    auth.mfa.challengeAndVerify.mockResolvedValue({ data: null, error: { status: 429, code: 'over_request_rate_limit', message: AUTH_MESSAGE } });
    await expect(verify(CODE)).resolves.toEqual(REFUSED);
    expect(errors).toHaveBeenCalledOnce();
    expect(consoleText()).toContain('over_request_rate_limit');
    expect(consoleText()).not.toContain(CODE);
    expect(consoleText()).not.toContain(AUTH_MESSAGE);
  });

  it.each([[undefined], [''], ['12345'], ['1234567'], ['12345a'], [' 123456'], ['١٢٣٤٥٦'], ['123456\n']])(
    'refuses the malformed code %j without asking Auth',
    async (code) => {
      await expect(verify(code)).resolves.toEqual(REFUSED);
      expect(auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
    },
  );

  it('refuses a file sent as the code', async () => {
    const data = new FormData();
    data.set('code', new File(['123456'], 'code.txt'));
    await expect(verifyCode({}, data)).resolves.toEqual(REFUSED);
    expect(auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
  });

  it('refuses when the user has no factor', async () => {
    auth.mfa.listFactors.mockResolvedValue(factors());
    await expect(verify(CODE)).resolves.toEqual(REFUSED);
    expect(auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
  });

  it('refuses when the factors cannot be read, without echoing Auth', async () => {
    auth.mfa.listFactors.mockResolvedValue({ data: null, error: { status: 500, code: 'unexpected_failure', message: AUTH_MESSAGE } });
    await expect(verify(CODE)).resolves.toEqual(REFUSED);
    expect(auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
    expect(consoleText()).not.toContain(AUTH_MESSAGE);
  });

  it('answers 404 for someone who is not a platform admin, before any factor is touched', async () => {
    access.consoleAccess.mockResolvedValue('none');
    await expect(verify(CODE)).rejects.toThrow('NOT_FOUND');
    expect(auth.mfa.listFactors).not.toHaveBeenCalled();
    expect(auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
  });

  it('sends an admin already at aal2 to /console without verifying again', async () => {
    access.consoleAccess.mockResolvedValue('ok');
    await expect(verify(CODE)).rejects.toThrow('REDIRECT /console');
    expect(auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
  });

  it('sends a visitor without a session to the sign-in page', async () => {
    auth.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } });
    await expect(verify(CODE)).rejects.toThrow('REDIRECT /login');
    expect(access.consoleAccess).not.toHaveBeenCalled();
  });

  it('never enrols or removes a factor', async () => {
    await expect(verify(CODE)).rejects.toThrow('REDIRECT /console');
    expect(auth.mfa.enroll).not.toHaveBeenCalled();
    expect(auth.mfa.unenroll).not.toHaveBeenCalled();
  });
});
