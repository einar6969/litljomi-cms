'use server';

import { redirect } from 'next/navigation';
import { safeRedirectPath } from '@/lib/auth/routing';
import { createDetachedClient, createEditorClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@/lib/supabase/types';
import { clearPending, readPending, writePending } from './pending';
import { discardPending, logFailure, revoke } from './revoke';

// The shape Auth issues for `{{ .TokenHash }}` (GoTrue v2.197.0, observed 2026-11-02): a SHA-224
// hex digest, prefixed `pkce_` when the link was requested by the PKCE client.
const TOKEN_HASH = /^(?:pkce_)?[0-9a-f]{56}$/;
const FAILED = '/login?error=link';
/** After the first of an email change's two links: the sign-in page says the other is still needed. */
const WAITING = '/login?emailChange=waiting';
/** Where the confirm page asks a signed-in visitor whether to replace their session (M3-14). */
const QUESTION = '/auth/confirm';

const field = (formData: FormData, name: string): string | null => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : null;
};

type Session = { access_token: string; refresh_token: string; user?: { id?: string } | null };
type Current = { accessToken: string; userId: string | null };
type Outcome = { to: string };
type LinkType = 'email' | 'invite' | 'email_change';

// Only the link types the mail templates send (supabase/templates/magic_link.html, invite.html,
// email_change.html). Every other type Auth knows is refused here, before Auth is called.
const isLinkType = (type: string | null): type is LinkType => type === 'email' || type === 'invite' || type === 'email_change';

/**
 * Signs the editor in from the magic link's confirm page (spec §4.4; decision 41.1): the button's
 * POST, never the link's GET, so a mail scanner opening the link does not use it up. Next.js checks
 * the action's origin. The token hash is verified on the server; no PKCE verifier is needed, so the
 * link works in any browser. Any failure goes back to the sign-in page's invalid-link notice; success
 * goes only to a path on this origin. The token is never logged: only Auth's status and code are.
 *
 * A visitor without a session is signed in with the editor's cookie client, which writes the session
 * to the cookies. A visitor who already has a session keeps it until the link is verified, so a bad
 * link changes nothing (decision 42.2, Q1). The link is then verified with a detached client, which
 * leaves the cookies alone: if it signs in to the same account, that session simply takes over; if
 * it signs in to another account, its session is held aside (pending.ts) and the confirm page shows
 * which account the link is for and asks before replacing the visitor's session (M3-14).
 *
 * An email change's links from both addresses come here too (spec §4.4): each needs this POST. The
 * first one Auth accepts issues no session and changes nothing, so the visitor is told the other
 * address has to confirm as well. The second completes the change and issues a session, which is
 * handled as a magic link's is.
 */
export async function confirmSignIn(formData: FormData): Promise<void> {
  const tokenHash = field(formData, 'token_hash');
  const type = field(formData, 'type');
  const next = safeRedirectPath(field(formData, 'next'));
  redirect((await signInWithLink(tokenHash, type, next)).to);
}

async function signInWithLink(tokenHash: string | null, type: string | null, next: string): Promise<Outcome> {
  if (tokenHash === null || !TOKEN_HASH.test(tokenHash)) return { to: FAILED };
  if (!isLinkType(type)) return { to: FAILED };
  try {
    const client = await createEditorClient();
    const current = await currentSession(client);
    if (current === null) {
      const verified = await verify(client, tokenHash, type);
      return verified === null ? { to: FAILED } : verified === 'waiting' ? { to: WAITING } : { to: next };
    }

    const session = await verify(createDetachedClient(), tokenHash, type);
    if (session === null) return { to: FAILED };
    if (session === 'waiting') return { to: WAITING };
    if (session.user?.id !== undefined && session.user.id === current.userId) {
      return (await adopt(client, session, current.accessToken)) ? { to: next } : { to: FAILED };
    }
    await discardPending();
    await writePending({ accessToken: session.access_token, refreshToken: session.refresh_token, next });
    return { to: QUESTION };
  } catch (error) {
    logFailure('link verification failed', error);
    return { to: FAILED };
  }
}

/**
 * Verifies the link with `client`: the session Auth issued; 'waiting' for the first of an email
 * change's two links, which Auth accepts without one; else null.
 */
async function verify(client: SupabaseClient, tokenHash: string, type: LinkType): Promise<Session | 'waiting' | null> {
  const { data, error } = await client.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) {
    console.error('[auth] link verification failed:', error.status, error.code);
    return null;
  }
  if (data.session) return data.session;
  return type === 'email_change' ? 'waiting' : null;
}

/**
 * Replaces the visitor's session with the pending one: the "Skipta um aðgang" button of the question
 * the confirm page asks (M3-14). The pending session is checked by Auth as it is written to the
 * cookies; the replaced session is then revoked. A missing, expired or refused pending session goes
 * to the invalid-link notice and leaves the visitor's session as it was.
 */
export async function replaceSession(): Promise<void> {
  redirect((await replace()).to);
}

async function replace(): Promise<Outcome> {
  const pending = await readPending();
  await clearPending();
  if (pending === null) return { to: FAILED };
  try {
    const client = await createEditorClient();
    const current = await currentSession(client);
    const session = { access_token: pending.accessToken, refresh_token: pending.refreshToken };
    return (await adopt(client, session, current?.accessToken ?? null)) ? { to: safeRedirectPath(pending.next) } : { to: FAILED };
  } catch (error) {
    logFailure('replacing the session failed', error);
    return { to: FAILED };
  }
}

/**
 * Keeps the visitor's session: the "Hætta við" button. The pending session is revoked on Auth's side
 * (the link is used up either way) and the visitor goes to the start page as the account they were.
 */
export async function keepSession(): Promise<void> {
  await discardPending();
  redirect('/');
}

/** Writes `session` to the visitor's cookies (Auth checks it), then revokes `previous` if it differs. */
async function adopt(client: SupabaseClient, session: Pick<Session, 'access_token' | 'refresh_token'>, previous: string | null): Promise<boolean> {
  const { data, error } = await client.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  if (error || !data.session) {
    if (error) console.error('[auth] taking over the session failed:', error.status, error.code);
    return false;
  }
  if (previous !== null && previous !== session.access_token && previous !== data.session.access_token) await revoke(client, previous);
  return true;
}

/**
 * The session already in the visitor's cookies, if any (to know whether to ask, and to revoke it).
 * Its account is the one Auth verifies (getUser), not the one the cookie claims; when Auth cannot
 * say, the account counts as unknown and the visitor is asked.
 */
async function currentSession(client: SupabaseClient): Promise<Current | null> {
  try {
    const { data, error } = await client.auth.getSession();
    const accessToken = error ? null : (data.session?.access_token ?? null);
    if (accessToken === null) return null;
    return { accessToken, userId: await verifiedUserId(client, accessToken) };
  } catch {
    return null;
  }
}

async function verifiedUserId(client: SupabaseClient, accessToken: string): Promise<string | null> {
  try {
    const { data, error } = await client.auth.getUser(accessToken);
    return error ? null : (data.user?.id ?? null);
  } catch {
    return null;
  }
}
