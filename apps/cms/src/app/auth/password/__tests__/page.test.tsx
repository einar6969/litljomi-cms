import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  }),
}));
const auth = vi.hoisted(() => ({ getUser: vi.fn(), getSession: vi.fn(), mfa: { getAuthenticatorAssuranceLevel: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({ createEditorClient: vi.fn(async () => ({ auth })) }));
const step = vi.hoisted(() => ({ readPasswordStep: vi.fn() }));
vi.mock('../step', () => step);
// The form is a client component with its own tests (set-password-form.test.tsx).
vi.mock('../SetPasswordForm', () => ({
  SetPasswordForm: ({ email, needsCode }: { email: string; needsCode: boolean }) => <form data-email={email} data-needs-code={String(needsCode)} />,
}));

const { default: SetPasswordPage } = await import('../page');
const { t } = await import('@/i18n/is');

const TOKEN = 'eyJlink.access.token';
const render = async () => renderToStaticMarkup(await SetPasswordPage());

beforeEach(() => {
  vi.clearAllMocks();
  auth.getUser.mockResolvedValue({ data: { user: { id: 'u', email: 'ritstjori@example.is' } }, error: null });
  auth.getSession.mockResolvedValue({ data: { session: { access_token: TOKEN } }, error: null });
  step.readPasswordStep.mockResolvedValue({ sessionId: 's', next: '/' });
  auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue(level('aal1', 'aal1'));
});

const level = (currentLevel: string, nextLevel: string) => ({ data: { currentLevel, nextLevel, currentAuthenticationMethods: [] }, error: null });

describe('the set-password page (PW-03)', () => {
  it('names the account and shows the form, for the session the step belongs to', async () => {
    const html = await render();
    expect(step.readPasswordStep).toHaveBeenCalledExactlyOnceWith(TOKEN);
    expect(html).toContain(`<h1>${t.password.title}</h1>`);
    expect(html).toContain(`${t.password.account} <strong>ritstjori@example.is</strong>.`);
    expect(html).toContain(t.password.intro);
    expect(html).toContain('data-email="ritstjori@example.is"');
    expect(html).toContain('data-needs-code="false"');
  });

  // Auth wants `aal2` to change the password of an account with a verified factor (GoTrue v2.197.0
  // answers `insufficient_aal` otherwise; tests/integration auth-confirm.test.ts). A link's session
  // is `aal1`, so a platform admin with TOTP gives the code first.
  it('asks for the TOTP code first when the account has a verified factor and the session is below aal2', async () => {
    auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue(level('aal1', 'aal2'));
    const html = await render();
    // With the session's token, so Auth reads the factors (getUser) instead of the cookies' copy.
    expect(auth.mfa.getAuthenticatorAssuranceLevel).toHaveBeenCalledExactlyOnceWith(TOKEN);
    expect(html).toContain('data-needs-code="true"');
  });

  it('asks for no code once the session is aal2', async () => {
    auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue(level('aal2', 'aal2'));
    expect(await render()).toContain('data-needs-code="false"');
  });

  it('fails, rather than guess, when Auth cannot say the assurance level', async () => {
    auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: null, error: { status: 500, code: 'unexpected_failure' } });
    await expect(render()).rejects.toThrow(/^assurance level: unexpected_failure$/);
  });

  it('escapes the account it names', async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: 'u', email: '<b>x</b>@example.is' } }, error: null });
    expect(await render()).toContain('<strong>&lt;b&gt;x&lt;/b&gt;@example.is</strong>');
  });

  it.each([
    ['Auth refuses the session', () => auth.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401, code: 'no_authorization' } })],
    ['Auth cannot be reached', () => auth.getUser.mockRejectedValue(new Error('network failed'))],
  ])('sends a visitor to /login when %s', async (_case, arrange) => {
    arrange();
    await expect(render()).rejects.toThrow(/^REDIRECT \/login$/);
  });

  // It is not a "change password" screen for a signed-in editor (docs/plans/passwords.md).
  it('sends a session without the step home', async () => {
    step.readPasswordStep.mockResolvedValue(null);
    await expect(render()).rejects.toThrow(/^REDIRECT \/$/);
    expect(auth.mfa.getAuthenticatorAssuranceLevel).not.toHaveBeenCalled();
  });
});
