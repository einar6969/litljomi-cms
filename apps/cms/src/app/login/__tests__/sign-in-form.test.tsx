// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// React's act() warns unless the environment says it is a test.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const auth = vi.hoisted(() => ({ signInWithPassword: vi.fn() }));
vi.mock('@/lib/supabase/browser', () => ({ createBrowserEditorClient: vi.fn(() => ({ auth })) }));
const actions = vi.hoisted(() => ({ discardPendingSession: vi.fn() }));
vi.mock('../actions', () => actions);
const navigation = vi.hoisted(() => ({ goTo: vi.fn() }));
vi.mock('../navigate', () => navigation);

const { SignInForm } = await import('../SignInForm');
const { t } = await import('@/i18n/is');

const EMAIL = 'editor@example.test';
const PASSWORD = 'correct horse battery';

let root: Root | undefined;
let errors: ReturnType<typeof vi.spyOn>;
let logs: ReturnType<typeof vi.spyOn>;
let warns: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  auth.signInWithPassword.mockResolvedValue({ data: { session: {}, user: {} }, error: null });
  actions.discardPendingSession.mockResolvedValue(undefined);
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

/** Everything written to the console during the test, as one string. */
const consoleText = () => JSON.stringify([errors.mock.calls, logs.mock.calls, warns.mock.calls]);

async function render(next?: string): Promise<void> {
  const mounted = createRoot(document.body.appendChild(document.createElement('div')));
  root = mounted;
  await act(async () => mounted.render(<SignInForm next={next} />));
}

const input = (id: string) => document.getElementById(id) as HTMLInputElement;
const button = () => document.querySelector('button[type="submit"]') as HTMLButtonElement;
const alertText = () => document.querySelector('[role="alert"]')?.textContent ?? null;

/**
 * Fills the form and submits it, then waits until this attempt has run its course: Auth was asked,
 * and the form either navigated or is ready again.
 */
async function submit(email = EMAIL, password = PASSWORD): Promise<void> {
  const attempts = auth.signInWithPassword.mock.calls.length;
  const navigations = navigation.goTo.mock.calls.length;
  input('email').value = email;
  input('password').value = password;
  await act(async () => {
    input('email').form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() => {
    expect(auth.signInWithPassword).toHaveBeenCalledTimes(attempts + 1);
    expect(navigation.goTo.mock.calls.length > navigations || !button().disabled).toBe(true);
  });
}

describe('<SignInForm />', () => {
  it('asks for an email address and a password, as a password manager expects', async () => {
    await render();
    expect(input('email').type).toBe('email');
    expect(input('email').autocomplete).toBe('email');
    expect(input('email').required).toBe(true);
    expect(input('password').type).toBe('password');
    expect(input('password').autocomplete).toBe('current-password');
    expect(input('password').required).toBe(true);
    expect(document.body.textContent).toContain(t.login.emailLabel);
    expect(document.body.textContent).toContain(t.login.passwordLabel);
    expect(button().textContent).toBe(t.login.submit);
    expect(button().disabled).toBe(false);
    expect(alertText()).toBeNull();
  });

  // Before hydration a native submit would send the fields to the CMS in the URL. With the only
  // submit button disabled, neither the button nor Enter in a field submits (implicit submission).
  it('cannot be sent from the server-rendered page before it is hydrated', () => {
    const html = renderToString(<SignInForm />);
    expect(html).toMatch(/<button type="submit"[^>]* disabled=""/);
    expect(html).not.toMatch(/<form[^>]* (action|method)=/);
  });

  it('signs in straight to Auth with the browser client, then goes to / by a full navigation', async () => {
    await render();
    await submit(`  ${EMAIL} `);
    expect(auth.signInWithPassword).toHaveBeenCalledExactlyOnceWith({ email: EMAIL, password: PASSWORD });
    expect(navigation.goTo).toHaveBeenCalledExactlyOnceWith('/');
  });

  it.each([
    ['/t/labak', '/t/labak'],
    ['/console', '/console'],
    ['/t/demo/news?status=draft', '/t/demo/news?status=draft'],
    ['//evil.example', '/'],
    ['https://evil.example/t/labak', '/'],
    ['/\\evil.example', '/'],
    ['javascript:alert(1)', '/'],
    ['', '/'],
  ])('goes to the safe form of next=%j: %j', async (next, to) => {
    await render(next);
    await submit();
    expect(navigation.goTo).toHaveBeenCalledExactlyOnceWith(to);
  });

  it('discards a pending confirm-page session first, through a server action that is given nothing', async () => {
    const order: string[] = [];
    actions.discardPendingSession.mockImplementation(async () => void order.push('discard'));
    auth.signInWithPassword.mockImplementation(async () => (order.push('signIn'), { data: {}, error: null }));
    await render();
    await submit();
    expect(order).toEqual(['discard', 'signIn']);
    expect(actions.discardPendingSession).toHaveBeenCalledExactlyOnceWith();
  });

  it('still signs in when the server action fails', async () => {
    actions.discardPendingSession.mockRejectedValue(new Error('network down'));
    await render();
    await submit();
    expect(auth.signInWithPassword).toHaveBeenCalledOnce();
    expect(navigation.goTo).toHaveBeenCalledExactlyOnceWith('/');
  });

  it('shows the neutral message for a refused sign-in, stays on the page, keeps the address and clears the password', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { session: null, user: null }, error: { name: 'AuthApiError', status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' } });
    await render();
    await submit();
    expect(alertText()).toBe(t.login.failed);
    expect(navigation.goTo).not.toHaveBeenCalled();
    expect(input('email').value).toBe(EMAIL);
    expect(input('password').value).toBe('');
    expect(button().disabled).toBe(false);
  });

  it('shows the rate-limit message for a rate limit', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: { name: 'AuthApiError', status: 429, code: 'over_request_rate_limit', message: 'Request rate limit reached' } });
    await render();
    await submit();
    expect(alertText()).toBe(t.login.rateLimited);
    expect(navigation.goTo).not.toHaveBeenCalled();
  });

  it('shows the neutral message when the call to Auth throws', async () => {
    auth.signInWithPassword.mockRejectedValue(new TypeError('Failed to fetch'));
    await render();
    await submit();
    expect(alertText()).toBe(t.login.failed);
    expect(navigation.goTo).not.toHaveBeenCalled();
  });

  it('clears an earlier message when it tries again, and signs in', async () => {
    auth.signInWithPassword.mockResolvedValueOnce({ data: {}, error: { name: 'AuthApiError', status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' } });
    await render();
    await submit();
    expect(alertText()).toBe(t.login.failed);
    await submit();
    expect(navigation.goTo).toHaveBeenCalledExactlyOnceWith('/');
    expect(alertText()).toBeNull();
  });

  it('never logs or shows the address or the password', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: { name: 'AuthApiError', status: 500, code: 'unexpected_failure', message: `failed for ${EMAIL} with ${PASSWORD}` } });
    actions.discardPendingSession.mockRejectedValue(new Error(`failed for ${EMAIL}`));
    await render();
    await submit();
    expect(consoleText()).not.toContain(EMAIL);
    expect(consoleText()).not.toContain(PASSWORD);
    expect(alertText()).not.toContain(EMAIL);
    expect(document.body.innerHTML).not.toContain(PASSWORD);
  });

  it('cannot be sent twice while the sign-in runs', async () => {
    let finish = (_: unknown) => {};
    auth.signInWithPassword.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    await render();
    input('email').value = EMAIL;
    input('password').value = PASSWORD;
    await act(async () => {
      input('email').form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(auth.signInWithPassword).toHaveBeenCalledOnce());
    expect(button().disabled).toBe(true);
    // A second submit event, whatever sends it, while the first sign-in runs.
    await act(async () => {
      input('email').form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(auth.signInWithPassword).toHaveBeenCalledOnce();
    await act(async () => finish({ data: {}, error: null }));
    await vi.waitFor(() => expect(navigation.goTo).toHaveBeenCalledOnce());
    expect(button().disabled).toBe(true);
  });
});
