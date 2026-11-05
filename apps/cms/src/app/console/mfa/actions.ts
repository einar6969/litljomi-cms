'use server';

import { notFound, redirect } from 'next/navigation';
import { requireUserId } from '@/lib/auth/session';
import { consoleAccess } from '@/lib/console-access';
import { createEditorClient } from '@/lib/supabase/server';

export type CodeFormState = { error?: string };

const REFUSED: CodeFormState = { error: "That code didn't work. Try again." };
const CODE = /^[0-9]{6}$/;

/**
 * Verifies a TOTP code for the signed-in admin, on the server, so the upgraded `aal2` session
 * reaches the cookies through the editor client. The factor is the admin's verified one, or the
 * unverified one the page just enrolled; it is looked up here, never taken from the form. Every
 * refusal gets the same sentence: Auth's message is not echoed, and the code is never logged.
 */
export async function verifyCode(_previous: CodeFormState, formData: FormData): Promise<CodeFormState> {
  const client = await createEditorClient();
  await requireUserId(client);
  const access = await consoleAccess();
  if (access === 'none') notFound();
  if (access === 'ok') redirect('/console');

  const code = formData.get('code');
  if (typeof code !== 'string' || !CODE.test(code)) return REFUSED;

  const { data: factors, error: factorsError } = await client.auth.mfa.listFactors();
  if (factorsError) {
    console.error('[console] reading the factors failed:', factorsError.status, factorsError.code);
    return REFUSED;
  }
  const factor = factors.totp[0] ?? factors.all.find((candidate) => candidate.factor_type === 'totp' && candidate.status === 'unverified');
  if (!factor) return REFUSED;

  const { error } = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) {
    if (error.code !== 'mfa_verification_failed') console.error('[console] verifying the code failed:', error.status, error.code);
    return REFUSED;
  }
  redirect('/console');
}
