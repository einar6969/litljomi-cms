import 'server-only';
import { createDetachedClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@/lib/supabase/types';
import { clearPending, readPending } from './pending';

/**
 * Ends a pending session left in the cookie (M3-14), if any, and removes the cookie. Used by the
 * confirm page's actions and by sign-out. The cookie is sent only to /auth/confirm, so from another
 * path there is nothing to read and revoke; the cookie is removed either way.
 */
export async function discardPending(): Promise<void> {
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
 * Ends a session on Auth's side (`local` scope: that session only, not the account's other devices).
 * A failure is logged (status and code, never a token) and otherwise ignored.
 */
export async function revoke(client: SupabaseClient, accessToken: string): Promise<void> {
  try {
    const { error } = await client.auth.admin.signOut(accessToken, 'local');
    if (error) console.error('[auth] revoking the replaced session failed:', error.status, error.code);
  } catch (error) {
    logFailure('revoking the replaced session failed', error);
  }
}

export function logFailure(what: string, error: unknown): void {
  console.error(`[auth] ${what}:`, error instanceof Error ? error.name : 'unknown error');
}
