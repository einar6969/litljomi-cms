import 'server-only';
import { cookies } from 'next/headers';
import { PASSWORD_STEP_COOKIE, encodePasswordStep, passwordStepOf, sessionIdOf, type PasswordStep } from '@/lib/auth/password-step';
import { SESSION_MAX_AGE } from '@/lib/supabase/session-cookies';

/**
 * The set-password step's cookie (PW-03; lib/auth/password-step.ts for the rules). HTTP-only, so
 * no script on the page can remove it; same-site lax and for every path, so it goes with every
 * request that carries the session cookies, a link followed from another site included; and for as
 * long as a session cookie can last (SESSION_MAX_AGE), so it cannot lapse before the session does.
 */
const OPTIONS = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } as const;

/**
 * Starts the step for the session of `accessToken`, which an invitation or reset link has just
 * made, with `next` as where to go once the password is set (server actions only). False when the
 * token names no session, so the caller can refuse the link instead of skipping the step.
 */
export async function writePasswordStep(accessToken: string, next: string): Promise<boolean> {
  const sessionId = sessionIdOf(accessToken);
  if (sessionId === null) return false;
  (await cookies()).set(PASSWORD_STEP_COOKIE, encodePasswordStep({ sessionId, next }), { ...OPTIONS, maxAge: SESSION_MAX_AGE });
  return true;
}

/** The step, if it belongs to the session of `accessToken`; else null. */
export async function readPasswordStep(accessToken: string | null | undefined): Promise<PasswordStep | null> {
  return passwordStepOf((await cookies()).get(PASSWORD_STEP_COOKIE)?.value, accessToken);
}

/** Ends the step (server actions only). */
export async function clearPasswordStep(): Promise<void> {
  (await cookies()).set(PASSWORD_STEP_COOKIE, '', { ...OPTIONS, maxAge: 0 });
}
