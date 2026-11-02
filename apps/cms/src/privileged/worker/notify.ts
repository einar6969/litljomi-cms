// Worker step 3a: the signed revalidation webhook (spec §7.3, §7.4, §8.2; plan Task 21, decision 35).
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, signWebhook } from '@litljomi/cms-sdk';

/** How long one notification may take before it counts as failed. */
export const NOTIFY_TIMEOUT_MS = 10_000;

export type NotifyTarget = { revalidate_url: string; webhook_secrets: string[] };
export type NotifyPayload = { tenant: string; release: number };

/**
 * POSTs `{ tenant, release }` to the site's revalidation route, signed (HMAC-SHA256 over
 * `${timestamp}.${body}`) with `webhook_secrets[0]` (§7.3). `ok` is a 2xx answer. Never throws:
 * an empty secret list (nothing to sign with; the site is not called), a network error or the
 * timeout give `{ ok: false, status: 0 }`. A redirect is not followed, so the signed request goes
 * only to the configured URL; its 3xx status is returned as not ok.
 */
export async function notifySite(
  site: NotifyTarget,
  payload: NotifyPayload,
  options: { timeoutMs?: number; now?: () => number } = {},
): Promise<{ ok: boolean; status: number }> {
  const secret = site.webhook_secrets[0];
  if (!secret) return { ok: false, status: 0 };
  const body = JSON.stringify({ tenant: payload.tenant, release: payload.release });
  const timestamp = Math.floor((options.now ?? Date.now)() / 1000);
  try {
    const response = await fetch(site.revalidate_url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [SIGNATURE_HEADER]: signWebhook(body, secret, timestamp),
        [TIMESTAMP_HEADER]: String(timestamp),
      },
      body,
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs ?? NOTIFY_TIMEOUT_MS),
    });
    await response.body?.cancel().catch(() => {});
    return { ok: response.status >= 200 && response.status < 300, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}
