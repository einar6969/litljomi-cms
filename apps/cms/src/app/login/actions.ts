'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { discardPending } from '@/app/auth/confirm/revoke';
import { createEditorClient } from '@/lib/supabase/server';

const emailSchema = z.email().max(254);

function confirmUrl(): string {
  const base = process.env.CMS_PUBLIC_URL;
  if (!base) throw new Error('CMS_PUBLIC_URL is not set');
  return `${base.replace(/\/+$/, '')}/auth/confirm`;
}

/**
 * Sends a magic link to an existing editor (spec §4.4; self sign-up is off, so
 * `shouldCreateUser: false`), with the editor's publishable-key client. The mail links to
 * `/auth/confirm` with the token hash (supabase/templates/magic_link.html, decision 41.1), which
 * needs no PKCE verifier, so the link works in any browser. Every outcome (sent, unknown address, rate limit, Auth
 * failure, malformed input) ends in the same redirect to the same neutral message, so the answer
 * never reveals whether an account exists. The address is never logged or echoed back.
 */
export async function requestMagicLink(formData: FormData): Promise<void> {
  const emailRedirectTo = confirmUrl();
  const raw = formData.get('email');
  const parsed = emailSchema.safeParse(typeof raw === 'string' ? raw.trim() : undefined);
  if (parsed.success) {
    try {
      const client = await createEditorClient();
      const { error } = await client.auth.signInWithOtp({
        email: parsed.data,
        options: { shouldCreateUser: false, emailRedirectTo },
      });
      // An unknown address (422) and the rate limits (429) are expected; only the status and code
      // are logged, never the address or Auth's message.
      if (error && error.status !== 422 && error.status !== 429) {
        console.error('[auth] magic link request failed:', error.status, error.code);
      }
    } catch (error) {
      console.error('[auth] magic link request failed:', error instanceof Error ? error.name : 'unknown error');
    }
  }
  redirect('/login?sent=1');
}

/**
 * Ends the editor's session on this device and returns to the sign-in page. A session a magic link
 * left waiting for the confirm page's question (M3-14) is discarded first, so it cannot be taken
 * over after the editor has signed out; a failure there does not keep the editor signed in.
 */
export async function signOut(): Promise<void> {
  try {
    await discardPending();
  } catch (error) {
    console.error('[auth] discarding the pending session failed:', error instanceof Error ? error.name : 'unknown error');
  }
  const client = await createEditorClient();
  await client.auth.signOut({ scope: 'local' });
  redirect('/login');
}
