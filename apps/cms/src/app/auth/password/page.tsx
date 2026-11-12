import { redirect } from 'next/navigation';
// Imported here, on the server, so that `signOut` is registered on this route (a client import
// registers only the actions it names; login/page.tsx).
import { signOut } from '@/app/login/actions';
import { t } from '@/i18n/is';
import { createEditorClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@/lib/supabase/types';
import { AuthFrame } from '@/ui/AuthFrame';
import { SignOutForm } from '@/ui/SignOutForm';
import { SetPasswordForm } from './SetPasswordForm';
import { readPasswordStep } from './step';

/**
 * The set-password page (spec §4.4; PW-03): where an invitation or a reset link lands, before any
 * other page (the proxy sends every other page here while the step lasts; lib/auth/password-step.ts).
 * It names the account the link signed in to and asks for its password. Without a session it sends
 * the visitor to sign in; without the step for this session, home: it is not a page for changing a
 * password at will.
 *
 * It offers the sign-out too (S29): someone who opened the link on a shared computer can end the
 * session without setting a password. Signing out also ends the step.
 *
 * Auth sets the password of an account with a verified factor only from an `aal2` session (GoTrue
 * answers `insufficient_aal`), and a link's session is `aal1`. So an account with TOTP, a platform
 * admin's (§4.4), gives its code first, on the form.
 */
export default async function SetPasswordPage() {
  const client = await createEditorClient();
  const email = await verifiedEmail(client);
  if (email === null) redirect('/login');
  const { data } = await client.auth.getSession();
  const accessToken = data.session?.access_token;
  if ((await readPasswordStep(accessToken)) === null) redirect('/');
  const needsCode = await needsTotpCode(client, accessToken);
  return (
    <AuthFrame>
      <h1>{t.password.title}</h1>
      <p>
        {t.password.account} <strong>{email}</strong>.
      </p>
      <p className="lede">{t.password.intro}</p>
      <SetPasswordForm email={email} needsCode={needsCode} />
      <SignOutForm signOut={signOut} />
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

/**
 * Whether the session of `accessToken` is below `aal2` while the account has a verified factor. Auth
 * reads the factors for the token (getUser), not from the cookies. A failure is thrown with its code,
 * never read as "no code", as the console does (lib/console-access.ts).
 */
async function needsTotpCode(client: SupabaseClient, accessToken: string | undefined): Promise<boolean> {
  const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel(accessToken);
  if (error) throw new Error(`assurance level: ${error.code}`);
  return data.nextLevel === 'aal2' && data.currentLevel !== 'aal2';
}
