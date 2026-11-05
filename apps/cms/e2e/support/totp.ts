// TOTP for the console's e2e tests: RFC 6238 (SHA-1, 30 s, 6 digits) with node:crypto, the same
// computation as tests/integration/src/auth-api.ts, which app code may not import.
import { createHmac } from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_MS = 30_000;

/** The code of a base32 `secret` at time `at`. */
export function totp(secret: string, at = Date.now()): string {
  let bits = '';
  for (const char of secret.replace(/=+$/, '')) bits += BASE32.indexOf(char).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / STEP_MS)));
  const hash = createHmac('sha1', key).update(counter).digest();
  const offset = hash[hash.length - 1]! & 0xf;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1e6).padStart(6, '0');
}

/** Six digits that are not the code of `secret` now or in the step on either side of now. */
export function wrongCode(secret: string): string {
  const now = Date.now();
  const valid = new Set([-1, 0, 1].map((step) => totp(secret, now + step * STEP_MS)));
  for (let candidate = 0; ; candidate++) {
    const code = String(candidate).padStart(6, '0');
    if (!valid.has(code)) return code;
  }
}
