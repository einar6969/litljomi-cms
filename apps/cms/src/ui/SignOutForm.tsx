'use client';

import { useEffect, useRef, type FormEvent } from 'react';
import { announceSignOut, onSignOut } from '@/editor/unsaved';
import { t } from '@/i18n/is';
import { createBrowserEditorClient } from '@/lib/supabase/browser';
import { Icon } from './Icon';

/** How long "Skrá út" waits for the browser's sign-out before the server action runs anyway. */
export const BROWSER_SIGN_OUT_TIMEOUT_MS = 5_000;

/**
 * "Skrá út". Before the server action ends the session, the tab's copies of unsaved changes are
 * removed and every form in it drops its unsaved changes (M2-17), and the browser's other tabs are
 * told to do the same, so nothing of the editor's work stays behind after they sign out.
 *
 * The session is ended in Auth from the browser first (R7): the CMS server never refreshes a session
 * (lib/supabase/no-refresh-fetch.ts), so it cannot end one whose access token has expired, while
 * the browser's client refreshes it from the editor's own address if needed and then calls Auth's
 * logout, for this device only. The server action then runs as before, also if that failed or did
 * not answer within BROWSER_SIGN_OUT_TIMEOUT_MS. Before the page has hydrated, the form posts to
 * the server action alone.
 */
export function SignOutForm({ signOut, label = t.app.signOut }: { signOut: () => Promise<void>; label?: string }) {
  // While an editor page is open the tab listens for a sign-out in another tab; the tab's copies are
  // removed then (unsaved.ts), whether or not a form is open.
  useEffect(() => onSignOut(() => undefined), []);
  // 'browser' while the browser signs out; 'server' while the form's own submission, made after it,
  // goes on to the server action (React runs a form's action unless the submit event is prevented).
  const phase = useRef<'idle' | 'browser' | 'server'>('idle');

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    if (phase.current === 'server') return;
    event.preventDefault();
    if (phase.current === 'browser') return;
    phase.current = 'browser';
    announceSignOut();
    const form = event.currentTarget;
    void signOutInBrowser().then(() => {
      // In a task of its own: without a session the browser's sign-out ends in microtasks, inside
      // this submit event, and a browser ignores requestSubmit while a form's submit event is fired.
      setTimeout(() => {
        phase.current = 'server';
        try {
          form.requestSubmit();
        } finally {
          phase.current = 'idle';
        }
      }, 0);
    });
  }

  return (
    <form action={signOut} onSubmit={onSubmit}>
      <button type="submit">
        <Icon name="signOut" />
        {label}
      </button>
    </form>
  );
}

/** Ends the session in Auth from the browser, for this device; any failure is left to the server action. */
async function signOutInBrowser(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      createBrowserEditorClient().auth.signOut({ scope: 'local' }),
      new Promise<void>((resolve) => (timer = setTimeout(resolve, BROWSER_SIGN_OUT_TIMEOUT_MS))),
    ]);
  } catch {
    // The server action still runs and signs out on this device.
  } finally {
    clearTimeout(timer);
  }
}
