'use client';

import { useRef, useState, type FormEvent } from 'react';
import { t } from '@/i18n/is';
import { createBrowserEditorClient } from '@/lib/supabase/browser';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Notice } from '@/ui/Notice';
import { useHydrated } from '@/ui/useHydrated';
import { codeFailureMessage } from './outcome';

const CODE = /^[0-9]{6}$/;

type Props = {
  /** Called once Auth has verified the code and the session is `aal2`. */
  onVerified: () => void;
};

/**
 * The six-digit TOTP code, before the password, for an account with a verified factor (PW-03; a
 * platform admin's, spec §4.4). Challenged and verified from the browser straight with Auth (the
 * link's session, the publishable key), as the password is set: the same session becomes `aal2`
 * (its id stays, so the step still applies) and the browser client stores it in the session
 * cookies. The factor is the account's verified TOTP factor, looked up here, never taken from the
 * form. A refusal says so (outcome.ts), clears the field and asks again; the code is never logged.
 *
 * As the password form: disabled until hydrated, a POST, and one attempt at a time.
 */
export function TotpCodeForm({ onVerified }: Props) {
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const hydrated = useHydrated();
  const running = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (running.current) return;
    running.current = true;
    const form = event.currentTarget;
    const code = String(new FormData(form).get('code') ?? '');
    setPending(true);
    setFailure(null);

    const message = await verify(code);
    if (message === null) {
      // The password form takes this one's place.
      onVerified();
      return;
    }
    const field = form.elements.namedItem('code');
    if (field instanceof HTMLInputElement) field.value = '';
    setFailure(message);
    setPending(false);
    running.current = false;
  }

  return (
    <form method="post" onSubmit={submit} className="flex flex-col gap-3.5">
      <p>{t.password.codeIntro}</p>
      <Field label={t.password.codeLabel} htmlFor="code">
        <input
          id="code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          className="code"
        />
      </Field>
      <Button type="submit" variant="primary" className="btn-wide" disabled={!hydrated || pending}>
        {t.password.codeSubmit}
      </Button>
      {failure !== null ? (
        <Notice tone="error" role="alert">
          {failure}
        </Notice>
      ) : null}
    </form>
  );
}

/** Null once Auth has verified `code` with the account's TOTP factor, else the message to show. */
async function verify(code: string): Promise<string | null> {
  if (!CODE.test(code)) return t.password.codeRefused;
  try {
    const { mfa } = createBrowserEditorClient().auth;
    const { data: factors, error: factorsError } = await mfa.listFactors();
    if (factorsError) return codeFailureMessage(factorsError);
    // `totp` lists the verified factors only.
    const factor = factors.totp[0];
    if (!factor) return t.password.codeRefused;
    const { error } = await mfa.challengeAndVerify({ factorId: factor.id, code });
    return error ? codeFailureMessage(error) : null;
  } catch (error) {
    return codeFailureMessage(error);
  }
}
