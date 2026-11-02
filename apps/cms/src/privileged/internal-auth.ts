import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();

/**
 * Compares a presented value with the expected secret in constant time. Both are hashed first
 * (SHA-256, always 32 bytes), so not even the secret's length is revealed by timing. False, never a
 * throw, when the secret is not configured (unset or empty) or when nothing is presented.
 */
function matchesSecret(presented: string | null, expected: string): boolean {
  if (presented === null) return false;
  return timingSafeEqual(digest(presented), digest(expected));
}

/** The internal worker trigger: header `x-cms-internal-secret` equals `CMS_INTERNAL_SECRET`. */
export function verifyInternalSecret(req: Request): boolean {
  const secret = process.env.CMS_INTERNAL_SECRET;
  if (!secret) return false;
  return matchesSecret(req.headers.get('x-cms-internal-secret'), secret);
}

/** Vercel Cron: `Authorization: Bearer ${CRON_SECRET}`. */
export function verifyCronSecret(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return matchesSecret(req.headers.get('authorization'), `Bearer ${secret}`);
}
