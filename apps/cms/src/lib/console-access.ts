import 'server-only';
import { cache } from 'react';
import { createEditorClient } from './supabase/server';

export type ConsoleAccess = 'none' | 'needs_mfa' | 'ok';

/**
 * What the signed-in user may do with the console, once per request: `none` without a
 * `console_admin` row, `needs_mfa` for an admin below `aal2`, `ok` at `aal2`. A convenience for the
 * pages, not the boundary: the console views run as this user and return nothing below `aal2`
 * (§4.5). Uses the signed-in client only; an error is thrown with its code, never read as `none`.
 */
export const consoleAccess = cache(async (): Promise<ConsoleAccess> => {
  const client = await createEditorClient();
  const { data: admin, error } = await client.from('console_admin').select('user_id').maybeSingle();
  if (error) throw new Error(`console_admin: ${error.code}`);
  if (!admin) return 'none';
  const { data: level, error: levelError } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (levelError) throw new Error(`assurance level: ${levelError.code}`);
  return level.currentLevel === 'aal2' ? 'ok' : 'needs_mfa';
});
