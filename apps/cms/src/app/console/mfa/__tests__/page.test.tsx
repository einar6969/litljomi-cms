import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
const auth = vi.hoisted(() => ({ getUser: vi.fn(), mfa: { listFactors: vi.fn(), enroll: vi.fn(), unenroll: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({ createEditorClient: vi.fn(async () => ({ auth })) }));
vi.mock('../actions', () => ({ verifyCode: vi.fn() }));

const { default: MfaPage } = await import('../page');

const SECRET = 'JBSWY3DPEHPK3PXP';
const QR = 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg"></svg>';
const ENROLLED = { data: { id: 'new', type: 'totp', totp: { qr_code: QR, secret: SECRET, uri: `otpauth://totp/x?secret=${SECRET}` } }, error: null };
const VERIFIED = { id: 'f1', factor_type: 'totp', status: 'verified' };
const LEFTOVER = { id: 'f2', factor_type: 'totp', status: 'unverified' };
const factors = (...all: Array<{ id: string; factor_type: string; status: string }>) => ({
  data: { all, totp: all.filter((f) => f.status === 'verified'), phone: [], webauthn: [], recovery_code: [] },
  error: null,
});

const render = async () => renderToStaticMarkup(await MfaPage());

beforeEach(() => {
  vi.clearAllMocks();
  auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  access.consoleAccess.mockResolvedValue('needs_mfa');
  auth.mfa.listFactors.mockResolvedValue(factors());
  auth.mfa.enroll.mockResolvedValue(ENROLLED);
  auth.mfa.unenroll.mockResolvedValue({ data: { id: 'f2' }, error: null });
});

describe('who reaches /console/mfa', () => {
  it('answers 404 for someone who is not a platform admin, and enrols nothing', async () => {
    access.consoleAccess.mockResolvedValue('none');
    await expect(render()).rejects.toThrow('NOT_FOUND');
    expect(auth.mfa.listFactors).not.toHaveBeenCalled();
    expect(auth.mfa.enroll).not.toHaveBeenCalled();
  });

  it('sends an admin at aal2 to /console, and enrols nothing', async () => {
    access.consoleAccess.mockResolvedValue('ok');
    await expect(render()).rejects.toThrow('REDIRECT /console');
    expect(auth.mfa.enroll).not.toHaveBeenCalled();
  });

  it('sends a visitor without a session to the sign-in page', async () => {
    auth.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } });
    await expect(render()).rejects.toThrow('REDIRECT /login');
    expect(access.consoleAccess).not.toHaveBeenCalled();
  });
});

describe('with no verified factor', () => {
  it('enrols a TOTP factor and shows the QR from Auth and the manual code', async () => {
    const html = await render();
    expect(auth.mfa.enroll).toHaveBeenCalledOnce();
    expect(auth.mfa.enroll.mock.calls[0]![0]).toMatchObject({ factorType: 'totp' });
    expect(auth.mfa.unenroll).not.toHaveBeenCalled();
    expect(html).toContain('<img');
    expect(html).toContain('src="data:image/svg+xml;utf-8,');
    expect(html).toContain(`<code`);
    expect(html).toContain(SECRET);
    expect(html).toContain('name="code"');
  });

  it('removes a leftover unverified factor first, then enrols afresh', async () => {
    auth.mfa.listFactors.mockResolvedValue(factors(LEFTOVER));
    await render();
    expect(auth.mfa.unenroll).toHaveBeenCalledExactlyOnceWith({ factorId: 'f2' });
    expect(auth.mfa.unenroll.mock.invocationCallOrder[0]!).toBeLessThan(auth.mfa.enroll.mock.invocationCallOrder[0]!);
    expect(auth.mfa.enroll).toHaveBeenCalledOnce();
  });

  it('throws with the code only when Auth refuses, and shows no form', async () => {
    auth.mfa.enroll.mockResolvedValue({ data: null, error: { code: 'too_many_enrolled_mfa_factors', message: 'Auth said something' } });
    await expect(render()).rejects.toThrow(/^mfa enroll: too_many_enrolled_mfa_factors$/);
  });

  it('does not enrol when the leftover cannot be removed', async () => {
    auth.mfa.listFactors.mockResolvedValue(factors(LEFTOVER));
    auth.mfa.unenroll.mockResolvedValue({ data: null, error: { code: 'unexpected_failure', message: 'Auth said something' } });
    await expect(render()).rejects.toThrow(/^mfa unenroll: unexpected_failure$/);
    expect(auth.mfa.enroll).not.toHaveBeenCalled();
  });
});

describe('with a verified factor', () => {
  it('only challenges: no enrolment, no QR, no secret', async () => {
    auth.mfa.listFactors.mockResolvedValue(factors(VERIFIED));
    const html = await render();
    expect(auth.mfa.enroll).not.toHaveBeenCalled();
    expect(auth.mfa.unenroll).not.toHaveBeenCalled();
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<code');
    expect(html).toContain('name="code"');
  });

  it('does not touch a leftover unverified factor beside it', async () => {
    auth.mfa.listFactors.mockResolvedValue(factors(VERIFIED, LEFTOVER));
    await render();
    expect(auth.mfa.enroll).not.toHaveBeenCalled();
    expect(auth.mfa.unenroll).not.toHaveBeenCalled();
  });
});
