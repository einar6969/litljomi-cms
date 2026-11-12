'use server';

import { redirect } from 'next/navigation';
import { discardPending } from '@/app/auth/confirm/revoke';
import { clearPasswordStep } from '@/app/auth/password/step';
import { createEditorClient } from '@/lib/supabase/server';

// Password sign-in runs in the browser, straight to Auth with the publishable key (spec §4.4;
// decision 72.4), so no action here ever receives the address or the password.

/**
 * Discards a session a link left waiting for the confirm page's question (M3-14), if any. The
 * sign-in form calls it before signing in, so that question can never later replace the new session
 * with another account's. It takes nothing and returns nothing; a failure is logged without detail
 * and does not stop the sign-in.
 */
export async function discardPendingSession(): Promise<void> {
  await discardPendingQuietly();
}

/**
 * Ends the editor's session on this device and returns to the sign-in page. A session a link left
 * waiting for the confirm page's question (M3-14) is discarded first, so it cannot be taken over
 * after the editor has signed out; a failure there does not keep the editor signed in. The
 * set-password step (PW-03) ends with the session, as when signing out from that page (S29).
 */
export async function signOut(): Promise<void> {
  await discardPendingQuietly();
  const client = await createEditorClient();
  await client.auth.signOut({ scope: 'local' });
  await clearPasswordStep();
  redirect('/login');
}

async function discardPendingQuietly(): Promise<void> {
  try {
    await discardPending();
  } catch (error) {
    console.error('[auth] discarding the pending session failed:', error instanceof Error ? error.name : 'unknown error');
  }
}
