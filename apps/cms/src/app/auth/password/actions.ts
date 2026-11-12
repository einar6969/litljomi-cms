'use server';

import { safeRedirectPath } from '@/lib/auth/routing';
import { createEditorClient } from '@/lib/supabase/server';
import { clearPasswordStep, readPasswordStep } from './step';

/**
 * Ends the set-password step once the browser has set the password (PW-03), and gives the path to
 * go to: where the editor was going when the link signed them in, or `/`. It takes nothing: the
 * password goes from the browser straight to Auth and never reaches the CMS. Ending the step is
 * not a security boundary (the session is the editor's own either way); it only lets the editor on
 * to the other pages.
 */
export async function finishPasswordStep(): Promise<string> {
  const { data } = await (await createEditorClient()).auth.getSession();
  const step = await readPasswordStep(data.session?.access_token);
  await clearPasswordStep();
  return safeRedirectPath(step?.next);
}
