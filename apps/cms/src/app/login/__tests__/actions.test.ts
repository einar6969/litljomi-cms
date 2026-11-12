import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// redirect() ends a server action by throwing; the fake throws a recognisable error instead.
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  }),
}));
const auth = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createEditorClient: vi.fn(async () => ({ auth })) }));
// The pending session a link left for the confirm page's question (M3-14).
const revoke = vi.hoisted(() => ({ discardPending: vi.fn() }));
vi.mock('@/app/auth/confirm/revoke', () => revoke);
// The set-password step after an invitation or reset link (PW-03).
const step = vi.hoisted(() => ({ clearPasswordStep: vi.fn() }));
vi.mock('@/app/auth/password/step', () => step);

const { createEditorClient } = await import('@/lib/supabase/server');
const actions = await import('../actions');
const { discardPendingSession, signOut } = actions;

let errors: ReturnType<typeof vi.spyOn>;
let logs: ReturnType<typeof vi.spyOn>;
let warns: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  logs = vi.spyOn(console, 'log').mockImplementation(() => {});
  warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** Everything written to the console during the test, as one string. */
const consoleText = () => JSON.stringify([errors.mock.calls, logs.mock.calls, warns.mock.calls]);

describe('the sign-in actions', () => {
  // Password sign-in runs in the browser, straight to Auth (decision 72.4): no action takes the
  // address or the password, and the magic-link request is gone.
  it('are only sign-out and discarding the pending session', () => {
    expect(Object.keys(actions).sort()).toEqual(['discardPendingSession', 'signOut']);
  });
});

describe('discardPendingSession', () => {
  it('discards the pending session from the confirm page, and touches no other session', async () => {
    revoke.discardPending.mockResolvedValue(undefined);
    await expect(discardPendingSession()).resolves.toBeUndefined();
    expect(revoke.discardPending).toHaveBeenCalledOnce();
    expect(createEditorClient).not.toHaveBeenCalled();
  });

  it('takes no arguments, so it can never be given the password', () => {
    expect(discardPendingSession.length).toBe(0);
  });

  it('resolves when discarding fails, logging no detail', async () => {
    revoke.discardPending.mockRejectedValue(new Error('cookie store refused eyJsecret'));
    await expect(discardPendingSession()).resolves.toBeUndefined();
    expect(consoleText()).not.toContain('eyJsecret');
    expect(errors).toHaveBeenCalledOnce();
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

  // S29: signing out from the set-password page ends the step with the session.
  it('clears the set-password step', async () => {
    auth.signOut.mockResolvedValue({ error: null });
    await expect(signOut()).rejects.toThrow('REDIRECT /login');
    expect(step.clearPasswordStep).toHaveBeenCalledOnce();
  });

  it('still signs out when discarding the pending session fails, logging no detail', async () => {
    revoke.discardPending.mockRejectedValue(new Error('cookie store refused eyJsecret'));
    auth.signOut.mockResolvedValue({ error: null });
    await expect(signOut()).rejects.toThrow('REDIRECT /login');
    expect(auth.signOut).toHaveBeenCalledOnce();
    expect(consoleText()).not.toContain('eyJsecret');
  });
});
