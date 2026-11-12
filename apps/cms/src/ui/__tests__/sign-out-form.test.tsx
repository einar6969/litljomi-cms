// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// React's act() warns unless the environment says it is a test.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const auth = vi.hoisted(() => ({ signOut: vi.fn() }));
const browser = vi.hoisted(() => ({ createBrowserEditorClient: vi.fn(() => ({ auth })) }));
vi.mock('@/lib/supabase/browser', () => browser);
// The unsaved copies have their own tests (editor/__tests__/session-expiry-form.test.tsx).
const unsaved = vi.hoisted(() => ({ announceSignOut: vi.fn(), onSignOut: vi.fn(() => () => undefined) }));
vi.mock('@/editor/unsaved', () => unsaved);

const { SignOutForm, BROWSER_SIGN_OUT_TIMEOUT_MS } = await import('../SignOutForm');

/** What ran, in order: the unsaved copies' announcement, the browser's sign-out, the server action. */
const ran: string[] = [];
const serverAction = vi.fn(async () => {
  ran.push('server action');
});

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  ran.length = 0;
  unsaved.announceSignOut.mockImplementation(() => ran.push('announce'));
  auth.signOut.mockImplementation(async () => {
    ran.push('browser sign-out');
    return { error: null };
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

async function render(): Promise<void> {
  await act(async () => root.render(<SignOutForm signOut={serverAction} />));
}

/** Presses "Skrá út", then lets `ms` pass. */
async function submit(ms = 0): Promise<void> {
  await act(async () => {
    container.querySelector('form')!.requestSubmit();
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const pass = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms));

describe('"Skrá út" (R7 security review)', () => {
  // The CMS server cannot load an expired session (it never refreshes one), so it could not end it
  // in Auth. The browser's client refreshes it from the editor's address if needed and calls Auth's
  // logout; the server action then runs as before (the pending link session, the step, the cookies).
  it('signs out in the browser first, on this device only, and runs the server action once that is done', async () => {
    let finish!: (result: { error: null }) => void;
    auth.signOut.mockImplementation(() => {
      ran.push('browser sign-out');
      return new Promise((resolve) => (finish = resolve));
    });
    await render();
    await submit();
    expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' });
    expect(serverAction).not.toHaveBeenCalled();

    await act(async () => finish({ error: null }));
    await pass(0);
    expect(serverAction).toHaveBeenCalledOnce();
    expect(ran).toEqual(['announce', 'browser sign-out', 'server action']);
  });

  // Without a session the browser's sign-out needs no network and ends in microtasks, inside the
  // press's own submit event; a browser ignores a form's requestSubmit while that event is being
  // dispatched ("firing submission events"), so the server action is asked for in a task of its own.
  it('submits again in a task of its own, after the press\'s submit event', async () => {
    await render();
    await act(async () => {
      container.querySelector('form')!.requestSubmit();
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
    expect(auth.signOut).toHaveBeenCalledOnce();
    expect(serverAction).not.toHaveBeenCalled();
    await pass(0);
    expect(serverAction).toHaveBeenCalledOnce();
  });

  it.each([
    ['Auth answers with an error', () => auth.signOut.mockResolvedValue({ error: { name: 'AuthRetryableFetchError', status: 0 } })],
    ['the sign-out throws', () => auth.signOut.mockRejectedValue(new Error('network failed'))],
    ['the browser client cannot be made', () => browser.createBrowserEditorClient.mockImplementationOnce(() => { throw new Error('no env'); })],
  ])('still runs the server action when %s', async (_case, arrange) => {
    arrange();
    await render();
    await submit();
    expect(serverAction).toHaveBeenCalledOnce();
  });

  // A hung network cannot keep the editor signed in on the device.
  it('runs the server action after a short wait when the browser\'s sign-out does not answer', async () => {
    auth.signOut.mockImplementation(() => new Promise(() => undefined));
    await render();
    await submit(BROWSER_SIGN_OUT_TIMEOUT_MS - 1);
    expect(serverAction).not.toHaveBeenCalled();
    await pass(1);
    // The submission's own task (a timer set while timers run comes 1 ms later in fake time).
    await pass(1);
    expect(serverAction).toHaveBeenCalledOnce();
    expect(BROWSER_SIGN_OUT_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
  });

  it('a second press while the browser signs out starts nothing more', async () => {
    let finish!: (result: { error: null }) => void;
    auth.signOut.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    await render();
    await submit();
    await submit();
    await act(async () => finish({ error: null }));
    await pass(0);
    expect(auth.signOut).toHaveBeenCalledOnce();
    expect(unsaved.announceSignOut).toHaveBeenCalledOnce();
    expect(serverAction).toHaveBeenCalledOnce();
  });

  it('starts over on a later press, if the editor is still on the page', async () => {
    await render();
    await submit();
    await submit();
    expect(auth.signOut).toHaveBeenCalledTimes(2);
    expect(serverAction).toHaveBeenCalledTimes(2);
  });
});
