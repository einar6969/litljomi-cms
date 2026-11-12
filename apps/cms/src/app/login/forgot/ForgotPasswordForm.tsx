'use client';

import { useRef, useState, type FormEvent } from 'react';
import { t } from '@/i18n/is';
import { createBrowserEditorClient } from '@/lib/supabase/browser';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Notice } from '@/ui/Notice';
import { useHydrated } from '@/ui/useHydrated';

/**
 * "Gleymt lykilorð?" (spec §4.4; PW-03). Asks Auth for a reset email from the browser, with the
 * publishable key, as sign-in does (decision 72.4), so Auth's limits count the editor's own address.
 * The email's link lands on the confirm page (`redirectTo`; the template builds it from the Site URL).
 *
 * Whatever Auth answers, an unknown address, a refusal, a rate limit or no answer at all, the form
 * gives way to one confirmation, so it never shows whether an account exists. The address is not
 * logged, stored or shown. As the sign-in form: disabled until hydrated, a POST, one request at a time.
 */
export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const hydrated = useHydrated();
  const running = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (running.current) return;
    running.current = true;
    const email = String(new FormData(event.currentTarget).get('email') ?? '').trim();
    setPending(true);
    try {
      await createBrowserEditorClient().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/confirm` });
    } catch {
      // The same confirmation as for any other answer (see above).
    }
    setSent(true);
  }

  if (sent) {
    return (
      <Notice tone="success" role="status">
        {t.forgot.sent}
      </Notice>
    );
  }
  return (
    <form method="post" onSubmit={submit} className="flex flex-col gap-3.5">
      <Field label={t.login.emailLabel} htmlFor="email">
        <input id="email" name="email" type="email" autoComplete="email" required maxLength={254} />
      </Field>
      <Button type="submit" variant="primary" className="btn-wide" disabled={!hydrated || pending}>
        {t.forgot.submit}
      </Button>
    </form>
  );
}
