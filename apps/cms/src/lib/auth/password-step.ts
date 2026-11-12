// The set-password step after an invitation or a reset link (spec §4.4; PW-03), as pure rules
// shared by the proxy, the confirm page's actions and the set-password page.
//
// When an invitation or reset link signs the editor in, the confirm action stores the step in an
// httpOnly cookie: the id of the session that link made, and where the editor was going. While the
// cookie names the session the request carries, the proxy sends every page but the sign-in pages
// to the set-password page. The step belongs to that one session: a password sign-in or another
// link makes a new session, and the step no longer applies. Setting the password clears it.

/** The set-password page. */
export const SET_PASSWORD_PATH = '/auth/password';

/** The step's cookie: httpOnly, same-site lax, for every path (app/auth/password/step.ts writes it). */
export const PASSWORD_STEP_COOKIE = 'cms-set-password';

export type PasswordStep = { sessionId: string; next: string };

// Auth's session ids are UUIDs.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The cookie value of a step. */
export const encodePasswordStep = (step: PasswordStep): string => JSON.stringify({ sessionId: step.sessionId, next: step.next });

/**
 * The `session_id` claim of an access token, or null. The token's signature is not checked here: the
 * proxy and the pages read it from a session Auth has just verified (getUser), and the confirm
 * action from Auth's own answer.
 */
export function sessionIdOf(accessToken: string | null | undefined): string | null {
  const payload = accessToken?.split('.')[1];
  if (!payload) return null;
  try {
    const claims: unknown = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof claims !== 'object' || claims === null) return null;
    const { session_id: id } = claims as { session_id?: unknown };
    return typeof id === 'string' && UUID.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** The step in the cookie `raw` if it belongs to the session of `accessToken`; else null. */
export function passwordStepOf(raw: string | undefined, accessToken: string | null | undefined): PasswordStep | null {
  const step = parse(raw);
  const sessionId = sessionIdOf(accessToken);
  return step !== null && sessionId !== null && step.sessionId === sessionId ? step : null;
}

function parse(raw: string | undefined): PasswordStep | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const { sessionId, next } = value as Record<string, unknown>;
    return typeof sessionId === 'string' && UUID.test(sessionId) && typeof next === 'string' ? { sessionId, next } : null;
  } catch {
    return null;
  }
}
