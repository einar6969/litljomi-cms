import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'x-cms-signature';
export const TIMESTAMP_HEADER = 'x-cms-timestamp';
export const DEFAULT_TOLERANCE_SECONDS = 300;

/** Hex HMAC-SHA256 of `${timestampSeconds}.${body}`; a string body is signed as its UTF-8 bytes. */
export function signWebhook(body: string | Uint8Array, secret: string, timestampSeconds: number): string {
  return createHmac('sha256', secret).update(`${timestampSeconds}.`, 'utf8').update(body).digest('hex');
}

const HEX_SHA256 = /^[0-9a-f]{64}$/;

/**
 * The secrets in a comma-separated list such as `CMS_WEBHOOK_SECRETS` (two during rotation), each
 * trimmed of surrounding whitespace. Throws on an empty entry (an empty value, `"a,"`, `"a, ,b"`):
 * a mistyped list is refused, not read as fewer secrets. The error names no secret.
 */
export function parseWebhookSecrets(value: string): string[] {
  return normalizeWebhookSecrets(value.split(','));
}

/** Each secret trimmed; throws (naming no secret) when one is not a string or is empty once trimmed. */
export function normalizeWebhookSecrets(secrets: readonly unknown[]): string[] {
  return secrets.map((secret, i) => {
    const trimmed = typeof secret === 'string' ? secret.trim() : '';
    if (trimmed === '') throw new Error(`webhook secret list: entry ${i + 1} of ${secrets.length} is empty`);
    return trimmed;
  });
}

/**
 * True when `signature` matches one of `secrets` (two are live during rotation) and the timestamp
 * is within `toleranceSeconds` (default 300) of `nowSeconds`, in either direction. Malformed
 * input returns false and never throws. Every secret is checked, with constant-time comparison.
 */
export function verifyWebhook(o: {
  body: string | Uint8Array;
  signature: string;
  timestamp: number;
  secrets: string[];
  nowSeconds: number;
  toleranceSeconds?: number;
}): boolean {
  try {
    const tolerance = o.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
    if (!(typeof o.body === 'string' || o.body instanceof Uint8Array) || typeof o.signature !== 'string' || !Array.isArray(o.secrets)) return false;
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
