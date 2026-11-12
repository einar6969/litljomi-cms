'use client';

import { useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { t } from '@/i18n/is';
import { safeRedirectPath } from '@/lib/auth/routing';
import { createBrowserEditorClient } from '@/lib/supabase/browser';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Notice } from '@/ui/Notice';
import { discardPendingSession } from './actions';
import { goTo } from './navigate';
import { signInFailureMessage } from './outcome';

// True once hydrated, false on the server and during hydration.
const noSubscription = () => () => {};
const useHydrated = () => useSyncExternalStore(noSubscription, () => true, () => false);

type Props = {
  /** Where to go once signed in, as the sign-in page's query gave it; only a path on this origin is used. */
  next?: string;
};

/**
 * Email and password, sent from the browser straight to Auth with the publishable key (spec §4.4;
 * decision 72.4), so Auth's per-address limit counts the editor's own address and the password
 * never reaches the CMS server. The browser client writes the session cookies; a full navigation to
 * `next` (default `/`) then leaves the routing to the server, as before. A failure shows one of two
 * messages (outcome.ts) and keeps the editor here. Neither the address nor the password is logged,
 * stored or shown.
 *
 * The button is disabled until the form is hydrated: before that, a native submit (the button, or
 * Enter in a field) would send both fields to the CMS in the URL. With the only submit button
 * disabled, the browser submits nothing.
 */
export function SignInForm({ next }: Props) {
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const hydrated = useHydrated();
  // Any submit event while a sign-in runs is ignored, not only the disabled button's.
  const running = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (running.current) return;
    running.current = true;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const email = String(fields.get('email') ?? '').trim();
    const password = String(fields.get('password') ?? '');
    setPending(true);
    setFailure(null);

    const message = await signIn(email, password);
    if (message === null) {
      // The button stays disabled while the browser leaves the page.
      goTo(safeRedirectPath(next));
      return;
    }
    const passwordField = form.elements.namedItem('password');
    if (passwordField instanceof HTMLInputElement) passwordField.value = '';
    setFailure(message);
    setPending(false);
    running.current = false;
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3.5">
      <Field label={t.login.emailLabel} htmlFor="email">
        <input id="email" name="email" type="email" autoComplete="email" required maxLength={254} />
      </Field>
      <Field label={t.login.passwordLabel} htmlFor="password">
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" variant="primary" className="btn-wide" disabled={!hydrated || pending}>
        {t.login.submit}
      </Button>
      {failure !== null ? (
        <Notice tone="error" role="alert">
          {failure}
        </Notice>
      ) : null}
    </form>
  );
}

/** Null once signed in, else the message to show. */
async function signIn(email: string, password: string): Promise<string | null> {
  try {
    await discardPendingSession();
  } catch {
    // The action could not be reached; the sign-in goes on (actions.ts).
  }
  try {
    const { error } = await createBrowserEditorClient().auth.signInWithPassword({ email, password });
    return error ? signInFailureMessage(error) : null;
  } catch (error) {
    return signInFailureMessage(error);
  }
}
