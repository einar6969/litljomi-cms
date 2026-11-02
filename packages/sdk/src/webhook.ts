import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'x-cms-signature';
export const TIMESTAMP_HEADER = 'x-cms-timestamp';
export const DEFAULT_TOLERANCE_SECONDS = 300;

/** Hex HMAC-SHA256 of `${timestampSeconds}.${body}`. */
export function signWebhook(body: string, secret: string, timestampSeconds: number): string {
  return createHmac('sha256', secret).update(`${timestampSeconds}.${body}`, 'utf8').digest('hex');
}

const HEX_SHA256 = /^[0-9a-f]{64}$/;

/**
 * True when `signature` matches one of `secrets` (two are live during rotation) and the timestamp
 * is within `toleranceSeconds` (default 300) of `nowSeconds`, in either direction. Malformed
 * input returns false and never throws. Every secret is checked, with constant-time comparison.
 */
export function verifyWebhook(o: {
  body: string;
  signature: string;
  timestamp: number;
  secrets: string[];
  nowSeconds: number;
  toleranceSeconds?: number;
}): boolean {
  try {
    const tolerance = o.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
    if (typeof o.body !== 'string' || typeof o.signature !== 'string' || !Array.isArray(o.secrets)) return false;
    if (!Number.isSafeInteger(o.timestamp) || o.timestamp < 0) return false;
    if (!Number.isFinite(o.nowSeconds) || !Number.isFinite(tolerance)) return false;
    if (Math.abs(o.nowSeconds - o.timestamp) > tolerance) return false;
    if (!HEX_SHA256.test(o.signature)) return false;
    const given = Buffer.from(o.signature, 'hex');
    let ok = false;
    for (const secret of o.secrets) {
      if (typeof secret !== 'string' || secret === '') continue;
      const expected = Buffer.from(signWebhook(o.body, secret, o.timestamp), 'hex');
      if (expected.length === given.length && timingSafeEqual(expected, given)) ok = true;
    }
    return ok;
  } catch {
    return false;
  }
}
