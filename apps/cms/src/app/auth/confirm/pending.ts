import 'server-only';
import { cookies } from 'next/headers';

/**
 * The session a magic link issued for a visitor who was already signed in as another account
 * (M3-14), held until the visitor answers whether to replace their session with it. It lives in its
 * own cookie: HTTP-only, sent only to /auth/confirm, same-site only, and for PENDING_MAX_AGE seconds.
 * The visitor's own session cookies are untouched until they answer.
 */
export type PendingSession = { accessToken: string; refreshToken: string; next: string };

export const PENDING_COOKIE = 'cms-confirm-pending';
/** Seconds the question stays answerable; afterwards the link has to be requested again. */
export const PENDING_MAX_AGE = 600;
const PATH = '/auth/confirm';

const isPending = (value: unknown): value is PendingSession => {
  if (typeof value !== 'object' || value === null) return false;
  const { accessToken, refreshToken, next } = value as Record<string, unknown>;
  return typeof accessToken === 'string' && accessToken !== '' && typeof refreshToken === 'string' && refreshToken !== '' && typeof next === 'string';
};

/** The pending session, or null when there is none or the cookie is not one this code wrote. */
export async function readPending(): Promise<PendingSession | null> {
  const raw = (await cookies()).get(PENDING_COOKIE)?.value;
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return isPending(value) ? { accessToken: value.accessToken, refreshToken: value.refreshToken, next: value.next } : null;
  } catch {
    return null;
  }
}

/** Stores the pending session (server actions only: a Server Component cannot set cookies). */
export async function writePending(pending: PendingSession): Promise<void> {
  (await cookies()).set(PENDING_COOKIE, JSON.stringify(pending), {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: PATH,
    maxAge: PENDING_MAX_AGE,
  });
}

/** Removes the pending session cookie (server actions only). */
export async function clearPending(): Promise<void> {
  (await cookies()).set(PENDING_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'strict', path: PATH, maxAge: 0 });
}
