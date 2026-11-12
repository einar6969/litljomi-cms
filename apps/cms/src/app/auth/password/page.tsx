import { redirect } from 'next/navigation';
import { t } from '@/i18n/is';
import { createEditorClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@/lib/supabase/types';
import { AuthFrame } from '@/ui/AuthFrame';
import { SetPasswordForm } from './SetPasswordForm';
import { readPasswordStep } from './step';

/**
 * The set-password page (spec §4.4; PW-03): where an invitation or a reset link lands, before any
 * other page (the proxy sends every other page here while the step lasts; lib/auth/password-step.ts).
 * It names the account the link signed in to and asks for its password. Without a session it sends
 * the visitor to sign in; without the step for this session, home: it is not a page for changing a
 * password at will.
 */
export default async function SetPasswordPage() {
  const client = await createEditorClient();
  const email = await verifiedEmail(client);
  if (email === null) redirect('/login');
  const { data } = await client.auth.getSession();
  if ((await readPasswordStep(data.session?.access_token)) === null) redirect('/');
  return (
    <AuthFrame>
      <h1>{t.password.title}</h1>
      <p>
        {t.password.account} <strong>{email}</strong>.
      </p>
      <p className="lede">{t.password.intro}</p>
      <SetPasswordForm email={email} />
    </AuthFrame>
  );
}

/** The address of the signed-in user as Auth verifies them, or null; anything that fails counts as signed out. */
async function verifiedEmail(client: SupabaseClient): Promise<string | null> {
  try {
    const { data, error } = await client.auth.getUser();
    return error || !data.user ? null : (data.user.email ?? '');
  } catch {
    return null;
  }
}
