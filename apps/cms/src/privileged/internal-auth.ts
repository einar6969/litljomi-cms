import { timingSafeEqual } from 'node:crypto';

/**
 * Compares a presented value with the expected secret in constant time. False, never a throw, when
 * the secret is not configured (unset or empty), when nothing is presented, or when the lengths
 * differ (timingSafeEqual itself throws on a length mismatch).
 */
function matchesSecret(presented: string | null, expected: string): boolean {
  if (presented === null) return false;
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
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
