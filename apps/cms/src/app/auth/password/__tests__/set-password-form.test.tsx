// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// React's act() warns unless the environment says it is a test.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const auth = vi.hoisted(() => ({ updateUser: vi.fn(), mfa: { listFactors: vi.fn(), challengeAndVerify: vi.fn() } }));
vi.mock('@/lib/supabase/browser', () => ({ createBrowserEditorClient: vi.fn(() => ({ auth })) }));
const actions = vi.hoisted(() => ({ finishPasswordStep: vi.fn() }));
vi.mock('../actions', () => actions);
const navigation = vi.hoisted(() => ({ goTo: vi.fn() }));
vi.mock('@/app/login/navigate', () => navigation);

const { SetPasswordForm } = await import('../SetPasswordForm');
const { t } = await import('@/i18n/is');

const EMAIL = 'ritstjori@example.is';
const PASSWORD = 'nýtt lykilorð 42';
const CODE = '123456';
const FACTOR = { id: 'f-1', factor_type: 'totp', status: 'verified' };
const refusal = (status: number, code: string) => ({ data: { user: null }, error: { name: 'AuthApiError', status, code, message: `refused ${PASSWORD}` } });

let root: Root | undefined;
let errors: ReturnType<typeof vi.spyOn>;
let logs: ReturnType<typeof vi.spyOn>;
let warns: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  auth.updateUser.mockResolvedValue({ data: { user: {} }, error: null });
  auth.mfa.listFactors.mockResolvedValue({ data: { all: [FACTOR], totp: [FACTOR], phone: [] }, error: null });
  auth.mfa.challengeAndVerify.mockResolvedValue({ data: {}, error: null });
  actions.finishPasswordStep.mockResolvedValue('/t/acme/news');
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  logs = vi.spyOn(console, 'log').mockImplementation(() => {});
  warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const consoleText = () => JSON.stringify([errors.mock.calls, logs.mock.calls, warns.mock.calls]);

async function render(needsCode = false): Promise<void> {
  const mounted = createRoot(document.body.appendChild(document.createElement('div')));
  root = mounted;
  await act(async () => mounted.render(<SetPasswordForm email={EMAIL} needsCode={needsCode} />));
}

const password = () => document.getElementById('password') as HTMLInputElement;
const button = () => document.querySelector('button[type="submit"]') as HTMLButtonElement;
const alertText = () => document.querySelector('form [role="alert"]')?.textContent ?? null;

/** Types `value` and submits, then waits until the attempt has run its course. */
async function submit(value = PASSWORD): Promise<void> {
  const navigations = navigation.goTo.mock.calls.length;
  password().value = value;
  await act(async () => {
    password().form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() => expect(navigation.goTo.mock.calls.length > navigations || !button().disabled).toBe(true));
}

describe('<SetPasswordForm /> (PW-03)', () => {
  it('asks for a new password as a password manager expects, with the account as its user name', async () => {
    await render();
    expect(password().type).toBe('password');
    expect(password().autocomplete).toBe('new-password');
    expect(password().required).toBe(true);
    // No rule of its own: Auth's minimum of 6 is said in the help and enforced by Auth.
    expect(password().minLength).toBe(-1);
    expect(password().getAttribute('aria-describedby')).toBe('password-help');
    expect(document.getElementById('password-help')?.textContent).toBe(t.password.help);
    const username = document.querySelector('input[autocomplete="username"]') as HTMLInputElement;
    expect(username.value).toBe(EMAIL);
    expect(username.readOnly).toBe(true);
    expect(username.hidden).toBe(true);
    expect(document.body.textContent).toContain(t.password.label);
    expect(button().textContent).toBe(t.password.submit);
    expect(button().disabled).toBe(false);
  });

  it('cannot be sent before it is hydrated, and never puts the password in a URL', () => {
    const html = renderToString(<SetPasswordForm email={EMAIL} needsCode={false} />);
    expect(html).toMatch(/<button type="submit"[^>]* disabled=""/);
    expect(html).toMatch(/<form[^>]* method="post"/);
    expect(html).not.toMatch(/<form[^>]* action=/);
  });

  it('sets the password straight with Auth from the browser, ends the step, then goes on by a full navigation', async () => {
    const order: string[] = [];
    auth.updateUser.mockImplementation(async () => (order.push('update'), { data: { user: {} }, error: null }));
    actions.finishPasswordStep.mockImplementation(async () => (order.push('finish'), '/t/acme/news'));
    await render();
    await submit();
    expect(auth.updateUser).toHaveBeenCalledExactlyOnceWith({ password: PASSWORD });
    expect(actions.finishPasswordStep).toHaveBeenCalledExactlyOnceWith();
    expect(order).toEqual(['update', 'finish']);
    expect(navigation.goTo).toHaveBeenCalledExactlyOnceWith('/t/acme/news');
  });

  it('sends the password as typed, spaces and all', async () => {
    await render();
    await submit('  six  ');
    expect(auth.updateUser).toHaveBeenCalledExactlyOnceWith({ password: '  six  ' });
  });

  it('goes only to a path on this origin, whatever the action answers', async () => {
    actions.finishPasswordStep.mockResolvedValue('//evil.example');
    await render();
    await submit();
    expect(navigation.goTo).toHaveBeenCalledExactlyOnceWith('/');
  });

  it.each([
    ['too short', refusal(422, 'weak_password'), t.password.tooShort],
    ['the same as now', refusal(422, 'same_password'), t.password.same],
    ['from a session too old', refusal(400, 'reauthentication_needed'), t.password.stale],
    ['rate limited', refusal(429, 'over_request_rate_limit'), t.login.rateLimited],
    ['an Auth error', refusal(500, 'unexpected_failure'), t.password.failed],
  ])('says so when Auth refuses it (%s), keeps the editor here and clears the field', async (_case, answer, message) => {
    auth.updateUser.mockResolvedValue(answer);
    await render();
    await submit();
    expect(alertText()).toBe(message);
    expect(actions.finishPasswordStep).not.toHaveBeenCalled();
    expect(navigation.goTo).not.toHaveBeenCalled();
    expect(password().value).toBe('');
    expect(button().disabled).toBe(false);
  });

  it('says so when Auth cannot be reached', async () => {
    auth.updateUser.mockRejectedValue(new TypeError('Failed to fetch'));
    await render();
    await submit();
    expect(alertText()).toBe(t.password.failed);
    expect(navigation.goTo).not.toHaveBeenCalled();
  });

  it('clears an earlier message when it tries again, and goes on', async () => {
    auth.updateUser.mockResolvedValueOnce(refusal(422, 'weak_password'));
    await render();
    await submit('12345');
    expect(alertText()).toBe(t.password.tooShort);
    await submit();
    expect(alertText()).toBeNull();
    expect(navigation.goTo).toHaveBeenCalledExactlyOnceWith('/t/acme/news');
  });

  // The password is set but the step could not be ended: trying again must not set it again (Auth
  // would refuse the same password), only end the step.
  it('when the step cannot be ended after the password is set, says so and then only ends the step', async () => {
    actions.finishPasswordStep.mockRejectedValueOnce(new Error('network down'));
    await render();
    await submit();
    expect(alertText()).toBe(t.password.failed);
    expect(navigation.goTo).not.toHaveBeenCalled();
    await submit();
    expect(auth.updateUser).toHaveBeenCalledOnce();
    expect(actions.finishPasswordStep).toHaveBeenCalledTimes(2);
    expect(navigation.goTo).toHaveBeenCalledExactlyOnceWith('/t/acme/news');
  });

  it('never logs or shows the password', async () => {
    auth.updateUser.mockResolvedValue(refusal(500, 'unexpected_failure'));
    await render();
    await submit();
    expect(consoleText()).not.toContain(PASSWORD);
    expect(document.body.innerHTML).not.toContain(PASSWORD);
  });

  it('cannot be sent twice while the update runs', async () => {
    let finish = (_: unknown) => {};
    auth.updateUser.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    await render();
    password().value = PASSWORD;
    const send = async () =>
      act(async () => {
        password().form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
    await send();
    await vi.waitFor(() => expect(auth.updateUser).toHaveBeenCalledOnce());
    expect(button().disabled).toBe(true);
    await send();
    expect(auth.updateUser).toHaveBeenCalledOnce();
    await act(async () => finish({ data: { user: {} }, error: null }));
    await vi.waitFor(() => expect(navigation.goTo).toHaveBeenCalledOnce());
    expect(button().disabled).toBe(true);
  });
});

// A platform admin enrols TOTP (spec §4.4), and Auth sets the password of an account with a
// verified factor only from an `aal2` session (GoTrue v2.197.0 answers `insufficient_aal`). The
// link's session is `aal1`, so the code comes first: challenged and verified from the browser
// straight with Auth, which raises the same session to `aal2` (the step's session id stays).
describe('<SetPasswordForm needsCode /> (PW-03, an account with TOTP)', () => {
  const code = () => document.getElementById('code') as HTMLInputElement | null;

  /** Types `value` as the code and submits, then waits until the attempt has run its course. */
  async function submitCode(value = CODE): Promise<void> {
    code()!.value = value;
    await act(async () => {
      code()!.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(code() === null || !button().disabled).toBe(true));
  }

  it('asks for the six-digit code first, as an authenticator app and a password manager expect, and not yet for the password', async () => {
    await render(true);
    expect(document.body.textContent).toContain(t.password.codeIntro);
    expect(document.body.textContent).toContain(t.password.codeLabel);
    expect(code()!.autocomplete).toBe('one-time-code');
    expect(code()!.inputMode).toBe('numeric');
    expect(code()!.pattern).toBe('[0-9]{6}');
    expect(code()!.maxLength).toBe(6);
    expect(code()!.required).toBe(true);
    expect(password()).toBeNull();
    expect(button().textContent).toBe(t.password.codeSubmit);
    expect(button().disabled).toBe(false);
  });

  it('cannot be sent before it is hydrated, and never puts the code in a URL', () => {
    const html = renderToString(<SetPasswordForm email={EMAIL} needsCode />);
    expect(html).toMatch(/<button type="submit"[^>]* disabled=""/);
    expect(html).toMatch(/<form[^>]* method="post"/);
    expect(html).not.toMatch(/<form[^>]* action=/);
  });

  it('verifies the code with the account\'s verified TOTP factor, then asks for the password and sets it', async () => {
    const order: string[] = [];
    auth.mfa.challengeAndVerify.mockImplementation(async () => (order.push('verify'), { data: {}, error: null }));
    auth.updateUser.mockImplementation(async () => (order.push('update'), { data: { user: {} }, error: null }));
    await render(true);
    await submitCode();
    expect(auth.mfa.challengeAndVerify).toHaveBeenCalledExactlyOnceWith({ factorId: FACTOR.id, code: CODE });
    expect(code()).toBeNull();
    expect(document.body.textContent).not.toContain(t.password.codeIntro);
    expect(password()).not.toBeNull();
    expect(document.activeElement).toBe(password());
    expect(alertText()).toBeNull();
    expect(auth.updateUser).not.toHaveBeenCalled();

    await submit();
    expect(order).toEqual(['verify', 'update']);
    expect(auth.updateUser).toHaveBeenCalledExactlyOnceWith({ password: PASSWORD });
    expect(navigation.goTo).toHaveBeenCalledExactlyOnceWith('/t/acme/news');
  });

  it.each([
    ['a wrong or expired code', () => auth.mfa.challengeAndVerify.mockResolvedValue({ data: null, error: { status: 422, code: 'mfa_verification_failed' } }), t.password.codeRefused],
    ['Auth\'s rate limit', () => auth.mfa.challengeAndVerify.mockResolvedValue({ data: null, error: { status: 429, code: 'over_request_rate_limit' } }), t.login.rateLimited],
    ['Auth cannot be reached', () => auth.mfa.challengeAndVerify.mockRejectedValue(new TypeError('Failed to fetch')), t.password.codeRefused],
    ['the factors cannot be read', () => auth.mfa.listFactors.mockResolvedValue({ data: null, error: { status: 500, code: 'unexpected_failure' } }), t.password.codeRefused],
    ['no verified TOTP factor', () => auth.mfa.listFactors.mockResolvedValue({ data: { all: [], totp: [], phone: [] }, error: null }), t.password.codeRefused],
  ])('says so when the code is refused (%s), keeps asking for it and clears the field', async (_case, arrange, message) => {
    arrange();
    await render(true);
    await submitCode();
    expect(alertText()).toBe(message);
    expect(code()!.value).toBe('');
    expect(password()).toBeNull();
    expect(button().disabled).toBe(false);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('refuses anything but six digits without asking Auth', async () => {
    await render(true);
    await submitCode('12345a');
    expect(alertText()).toBe(t.password.codeRefused);
    expect(auth.mfa.listFactors).not.toHaveBeenCalled();
    expect(auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
  });

  it('clears an earlier message when the next code is accepted', async () => {
    auth.mfa.challengeAndVerify.mockResolvedValueOnce({ data: null, error: { status: 422, code: 'mfa_verification_failed' } });
    await render(true);
    await submitCode('000000');
    expect(alertText()).toBe(t.password.codeRefused);
    await submitCode();
    expect(alertText()).toBeNull();
    expect(password()).not.toBeNull();
  });

  it('never logs or shows the code', async () => {
    auth.mfa.challengeAndVerify.mockResolvedValue({ data: null, error: { status: 422, code: 'mfa_verification_failed', message: `bad ${CODE}` } });
    await render(true);
    await submitCode();
    expect(consoleText()).not.toContain(CODE);
    expect(document.body.innerHTML).not.toContain(CODE);
  });

  it('cannot be sent twice while the code is verified', async () => {
    let finish = (_: unknown) => {};
    auth.mfa.challengeAndVerify.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    await render(true);
    code()!.value = CODE;
    const send = async () =>
      act(async () => {
        code()!.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
    await send();
    await vi.waitFor(() => expect(auth.mfa.challengeAndVerify).toHaveBeenCalledOnce());
    expect(button().disabled).toBe(true);
    await send();
    expect(auth.mfa.challengeAndVerify).toHaveBeenCalledOnce();
    await act(async () => finish({ data: {}, error: null }));
    await vi.waitFor(() => expect(password()).not.toBeNull());
  });
});
