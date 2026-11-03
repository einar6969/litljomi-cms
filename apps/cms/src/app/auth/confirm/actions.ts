'use server';

import { redirect } from 'next/navigation';
import { safeRedirectPath } from '@/lib/auth/routing';
import { createEditorClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@/lib/supabase/types';

// The shape Auth issues for `{{ .TokenHash }}` (GoTrue v2.197.0, observed 2026-11-02): a SHA-224
// hex digest, prefixed `pkce_` when the link was requested by the PKCE client.
const TOKEN_HASH = /^(?:pkce_)?[0-9a-f]{56}$/;

const field = (formData: FormData, name: string): string | null => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : null;
};

/**
 * Signs the editor in from the magic link's confirm page (spec §4.4; decision 41.1): the button's
 * POST, never the link's GET, so a mail scanner opening the link does not use it up. Next.js checks
 * the action's origin. The token hash is verified on the server with the editor's cookie client,
 * which writes the session to the editor's cookies; no PKCE verifier is needed, so the link works
 * in any browser. Any failure goes back to the sign-in page's invalid-link notice; success goes only
 * to a path on this origin. The token is never logged: only Auth's status and code are.
 *
 * A visitor who already has a session (decision 42.2, Q1) keeps it until the link is verified: a
 * malformed, used or expired link changes nothing. Once Auth has issued the new session, verifyOtp
 * writes it over the old session's cookies, and the old session is then revoked on Auth's side
 * (`local` scope: that session only, not the old account's other devices), so it cannot be used again.
 */
export async function confirmSignIn(formData: FormData): Promise<void> {
  const tokenHash = field(formData, 'token_hash');
  const type = field(formData, 'type');
  const next = safeRedirectPath(field(formData, 'next'));
  if (!(await verified(tokenHash, type))) redirect('/login?error=link');
  redirect(next);
}

async function verified(tokenHash: string | null, type: string | null): Promise<boolean> {
  if (tokenHash === null || !TOKEN_HASH.test(tokenHash)) return false;
  // Only the link types the mail templates send (supabase/templates/magic_link.html, invite.html).
  if (type !== 'email' && type !== 'invite') return false;
  try {
    const client = await createEditorClient();
    const previous = await currentAccessToken(client);
    const { data, error } = await client.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) {
      console.error('[auth] link verification failed:', error.status, error.code);
      return false;
    }
    if (data.session === null || data.session === undefined) return false;
    if (previous !== null && previous !== data.session.access_token) await revoke(client, previous);
    return true;
  } catch (error) {
    console.error('[auth] link verification failed:', error instanceof Error ? error.name : 'unknown error');
    return false;
  }
}

/** The access token of the session already in the visitor's cookies, if any (only to revoke it). */
async function currentAccessToken(client: SupabaseClient): Promise<string | null> {
  try {
    const { data, error } = await client.auth.getSession();
    return error ? null : (data.session?.access_token ?? null);
  } catch {
    return null;
  }
}

/**
 * Ends the replaced session on Auth's side. Its cookies are already overwritten, so a failure here
 * leaves the visitor signed in with the new session; it is logged (status and code, never a token).
 */
async function revoke(client: SupabaseClient, accessToken: string): Promise<void> {
  try {
    const { error } = await client.auth.admin.signOut(accessToken, 'local');
    if (error) console.error('[auth] revoking the replaced session failed:', error.status, error.code);
  } catch (error) {
    console.error('[auth] revoking the replaced session failed:', error instanceof Error ? error.name : 'unknown error');
  }
}
