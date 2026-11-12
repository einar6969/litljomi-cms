// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// React's act() warns unless the environment says it is a test.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const auth = vi.hoisted(() => ({ resetPasswordForEmail: vi.fn() }));
vi.mock('@/lib/supabase/browser', () => ({ createBrowserEditorClient: vi.fn(() => ({ auth })) }));

const { ForgotPasswordForm } = await import('../ForgotPasswordForm');
const { t } = await import('@/i18n/is');

const EMAIL = 'ritstjori@example.is';

let root: Root | undefined;
let errors: ReturnType<typeof vi.spyOn>;
let logs: ReturnType<typeof vi.spyOn>;
let warns: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
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

async function render(): Promise<void> {
  const mounted = createRoot(document.body.appendChild(document.createElement('div')));
  root = mounted;
  await act(async () => mounted.render(<ForgotPasswordForm />));
}

const input = () => document.getElementById('email') as HTMLInputElement | null;
const button = () => document.querySelector('button[type="submit"]') as HTMLButtonElement | null;
const sentText = () => document.querySelector('[role="status"]')?.textContent ?? null;

async function submit(email = EMAIL): Promise<void> {
  input()!.value = email;
  await act(async () => {
    input()!.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() => expect(sentText()).not.toBeNull());
}

describe('<ForgotPasswordForm /> (PW-03)', () => {
  it('asks for the email address', async () => {
    await render();
    expect(input()!.type).toBe('email');
    expect(input()!.autocomplete).toBe('email');
    expect(input()!.required).toBe(true);
    expect(document.body.textContent).toContain(t.login.emailLabel);
    expect(button()!.textContent).toBe(t.forgot.submit);
    expect(button()!.disabled).toBe(false);
    expect(sentText()).toBeNull();
  });

  it('cannot be sent before it is hydrated, and never puts the address in a URL', () => {
    const html = renderToString(<ForgotPasswordForm />);
    expect(html).toMatch(/<button type="submit"[^>]* disabled=""/);
    expect(html).toMatch(/<form[^>]* method="post"/);
    expect(html).not.toMatch(/<form[^>]* action=/);
  });

  // Decision 72.4: from the browser, so Auth's limits count the editor's own address.
  it('asks Auth for the reset from the browser, with the confirm page as the link\'s landing', async () => {
    await render();
    await submit(`  ${EMAIL} `);
    expect(auth.resetPasswordForEmail).toHaveBeenCalledExactlyOnceWith(EMAIL, { redirectTo: `${window.location.origin}/auth/confirm` });
  });

  it.each([
    ['Auth accepts it', () => undefined],
    ['Auth refuses it', () => auth.resetPasswordForEmail.mockResolvedValue({ data: null, error: { name: 'AuthApiError', status: 400, code: 'validation_failed', message: 'x' } })],
    ['Auth rate-limits it', () => auth.resetPasswordForEmail.mockResolvedValue({ data: null, error: { name: 'AuthApiError', status: 429, code: 'over_email_send_rate_limit', message: 'x' } })],
    ['the call throws', () => auth.resetPasswordForEmail.mockRejectedValue(new TypeError('Failed to fetch'))],
  ])('shows the same confirmation, and not the address, when %s', async (_case, arrange) => {
    arrange();
    await render();
    await submit();
    expect(sentText()).toBe(t.forgot.sent);
    expect(input()).toBeNull();
    expect(document.body.innerHTML).not.toContain(EMAIL);
    expect(consoleText()).not.toContain(EMAIL);
  });

  it('logs nothing', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ data: null, error: { name: 'AuthApiError', status: 500, code: 'unexpected_failure', message: `failed for ${EMAIL}` } });
    await render();
    await submit();
    expect(consoleText()).toBe('[[],[],[]]');
  });

  it('asks only once while the request runs', async () => {
    let finish = (_: unknown) => {};
    auth.resetPasswordForEmail.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    await render();
    input()!.value = EMAIL;
    const send = async () =>
      act(async () => {
        input()!.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
    await send();
    expect(button()!.disabled).toBe(true);
    await send();
    expect(auth.resetPasswordForEmail).toHaveBeenCalledOnce();
    await act(async () => finish({ data: {}, error: null }));
    await vi.waitFor(() => expect(sentText()).toBe(t.forgot.sent));
  });
});
