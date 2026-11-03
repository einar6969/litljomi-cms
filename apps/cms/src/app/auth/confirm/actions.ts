'use server';

import { redirect } from 'next/navigation';
import { safeRedirectPath } from '@/lib/auth/routing';
import { createDetachedClient, createEditorClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@/lib/supabase/types';
import { clearPending, readPending, writePending } from './pending';

// The shape Auth issues for `{{ .TokenHash }}` (GoTrue v2.197.0, observed 2026-11-02): a SHA-224
// hex digest, prefixed `pkce_` when the link was requested by the PKCE client.
const TOKEN_HASH = /^(?:pkce_)?[0-9a-f]{56}$/;
const FAILED = '/login?error=link';
/** Where the confirm page asks a signed-in visitor whether to replace their session (M3-14). */
const QUESTION = '/auth/confirm';

const field = (formData: FormData, name: string): string | null => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : null;
};

type Session = { access_token: string; refresh_token: string; user?: { id?: string } | null };
type Current = { accessToken: string; userId: string | null };
type Outcome = { to: string };

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
 */
export async function confirmSignIn(formData: FormData): Promise<void> {
  const tokenHash = field(formData, 'token_hash');
  const type = field(formData, 'type');
  const next = safeRedirectPath(field(formData, 'next'));
  redirect((await signInWithLink(tokenHash, type, next)).to);
}

async function signInWithLink(tokenHash: string | null, type: string | null, next: string): Promise<Outcome> {
  if (tokenHash === null || !TOKEN_HASH.test(tokenHash)) return { to: FAILED };
  // Only the link types the mail templates send (supabase/templates/magic_link.html, invite.html).
  if (type !== 'email' && type !== 'invite') return { to: FAILED };
  try {
    const client = await createEditorClient();
    const current = await currentSession(client);
    if (current === null) {
      return (await verify(client, tokenHash, type)) === null ? { to: FAILED } : { to: next };
    }

    const session = await verify(createDetachedClient(), tokenHash, type);
    if (session === null) return { to: FAILED };
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

/** Verifies the link with `client`; the session Auth issued, or null when it issued none. */
async function verify(client: SupabaseClient, tokenHash: string, type: 'email' | 'invite'): Promise<Session | null> {
  const { data, error } = await client.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) {
    console.error('[auth] link verification failed:', error.status, error.code);
    return null;
  }
  return data.session ?? null;
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

/** Ends a pending session left in the cookie, if any, and removes the cookie. */
async function discardPending(): Promise<void> {
  const pending = await readPending();
  await clearPending();
  if (pending === null) return;
  try {
    await revoke(createDetachedClient(), pending.accessToken);
  } catch (error) {
    logFailure('revoking the replaced session failed', error);
  }
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

/**
 * Ends a session on Auth's side (`local` scope: that session only, not the account's other devices).
 * A failure is logged (status and code, never a token) and otherwise ignored.
 */
async function revoke(client: SupabaseClient, accessToken: string): Promise<void> {
  try {
    const { error } = await client.auth.admin.signOut(accessToken, 'local');
    if (error) console.error('[auth] revoking the replaced session failed:', error.status, error.code);
  } catch (error) {
    logFailure('revoking the replaced session failed', error);
  }
}

function logFailure(what: string, error: unknown): void {
  console.error(`[auth] ${what}:`, error instanceof Error ? error.name : 'unknown error');
}
