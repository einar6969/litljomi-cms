'use client';

import { useRef, useState, type FormEvent } from 'react';
import { goTo } from '@/app/login/navigate';
import { t } from '@/i18n/is';
import { safeRedirectPath } from '@/lib/auth/routing';
import { createBrowserEditorClient } from '@/lib/supabase/browser';
import { Button } from '@/ui/Button';
import { Field, describedByOf } from '@/ui/Field';
import { Notice } from '@/ui/Notice';
import { useHydrated } from '@/ui/useHydrated';
import { finishPasswordStep } from './actions';
import { setPasswordFailureMessage } from './outcome';

type Props = {
  /** The signed-in account's address, for password managers to store the password under. */
  email: string;
};

/**
 * The new password, set from the browser straight with Auth (`updateUser`, the link's session,
 * the publishable key), so the password never reaches the CMS server (spec §4.4; PW-03). Then the
 * step is ended on the server and a full navigation goes where the editor was going. A refusal or
 * failure says so (outcome.ts), clears the field and keeps the editor here.
 *
 * As the sign-in form: disabled until hydrated, a POST, and one attempt at a time. If the password
 * was set but the step could not be ended, the next attempt only ends the step.
 */
export function SetPasswordForm({ email }: Props) {
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const hydrated = useHydrated();
  const running = useRef(false);
  const saved = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (running.current) return;
    running.current = true;
    const form = event.currentTarget;
    const password = String(new FormData(form).get('password') ?? '');
    setPending(true);
    setFailure(null);

    const message = saved.current ? null : await save(password);
    if (message === null) {
      saved.current = true;
      const to = await finish();
      if (to !== null) {
        // The button stays disabled while the browser leaves the page.
        goTo(to);
        return;
      }
    } else {
      const field = form.elements.namedItem('password');
      if (field instanceof HTMLInputElement) field.value = '';
    }
    setFailure(message ?? t.password.failed);
    setPending(false);
    running.current = false;
  }

  const help = t.password.help;
  return (
    <form method="post" onSubmit={submit} className="flex flex-col gap-3.5">
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <Field label={t.password.label} htmlFor="password" help={help}>
        <input id="password" name="password" type="password" autoComplete="new-password" required aria-describedby={describedByOf('password', { help })} />
      </Field>
      <Button type="submit" variant="primary" className="btn-wide" disabled={!hydrated || pending}>
        {t.password.submit}
      </Button>
      {failure !== null ? (
        <Notice tone="error" role="alert">
          {failure}
        </Notice>
      ) : null}
    </form>
  );
}

/** Null once Auth has set the password, else the message to show. */
async function save(password: string): Promise<string | null> {
  try {
    const { error } = await createBrowserEditorClient().auth.updateUser({ password });
    return error ? setPasswordFailureMessage(error) : null;
  } catch (error) {
    return setPasswordFailureMessage(error);
  }
}

/** The path to go to once the step is ended, or null if the server could not be reached. */
async function finish(): Promise<string | null> {
  try {
    return safeRedirectPath(await finishPasswordStep());
  } catch {
    return null;
  }
}
