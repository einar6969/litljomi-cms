import { DEFAULT_TOLERANCE_SECONDS, SIGNATURE_HEADER, TIMESTAMP_HEADER, normalizeWebhookSecrets, verifyWebhook } from './webhook.ts';

/**
 * The largest webhook body the handler reads (the worker sends about 40 bytes). A larger body is
 * refused with 413 before it is buffered or hashed, so the SDK does not rely on the host's request
 * size limit (Task 26 security r1, F2).
 */
export const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;

/** The body's bytes, or null once it passes `max` bytes (the rest is not read). */
async function readCapped(req: Request, max: number): Promise<Uint8Array | null> {
  if (req.body === null) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/**
 * The cache-life profile the handler passes to Next.js's `revalidateTag`: the `cms` tag expires at
 * once, so the next request regenerates from a fresh pointer (spec §7.3, decision 48.2). With
 * `'max'` (stale-while-revalidate) that regeneration would still render from the cached pointer and
 * one webhook would not be enough.
 */
export const CMS_REVALIDATE_PROFILE = Object.freeze({ expire: 0 } as const);

/**
 * `revalidateTag` from `next/cache`, on any Next.js major the SDK supports (spec §7.3: currently 15
 * and 16, whose signatures differ). Next.js 15 declares `revalidateTag(tag)`, expires the tag at
 * once and ignores a second argument; Next.js 16 declares `revalidateTag(tag, profile)` and, given
 * no profile, warns that the one-argument form is deprecated. Both are assignable to this type, and
 * the handler always calls it as `revalidateTag('cms', { expire: 0 })`, which means the same on both
 * (plan M3-13; tested against each major's own `next/cache` in `__tests__/next-compat.test.ts`).
 */
export type NextRevalidateTag = (tag: string, profile: { expire: 0 }) => unknown;

/**
 * Route handler for the site's revalidation endpoint. The site passes its own `revalidateTag` from
 * `next/cache` (either major, see NextRevalidateTag), so the SDK does not import Next.js; or instead
 * `revalidate`, a function of its own that expires the tag at once. 401 on a bad signature or stale
 * timestamp (checked before the body is read), 413 on a body over MAX_WEBHOOK_BODY_BYTES, a plain
 * 500 if `secrets()` throws or returns an empty entry (each secret is trimmed first; parseWebhookSecrets reads
 * `CMS_WEBHOOK_SECRETS`); otherwise revalidates the `cms` tag and answers 200.
 *
 * Replays: a request replayed with its signature and timestamp within the 5-minute window is
 * accepted again, by design (M3-09, decision 50.5). It can only make the site expire its `cms`
 * tag once more: nothing is read from the body, revalidation is idempotent and changes no content,
 * and the next request renders from the same published pointer. So there is no nonce store.
 */
export function createRevalidateHandler(
  o: {
    secrets: () => string[];
    now?: () => number;
  } & (
    | { /** The site's `revalidateTag` from `next/cache`. */ revalidateTag: NextRevalidateTag; revalidate?: never }
    | { /** Expires the tag itself (it must expire at once, not stale-while-revalidate). */ revalidate: (tag: string) => void | Promise<void>; revalidateTag?: never }
  ),
): (req: Request) => Promise<Response> {
  const now = o.now ?? Date.now;
  // A fresh profile object per call: Next.js normalizes the one it is given.
  const revalidate: (tag: string) => unknown =
    o.revalidateTag !== undefined ? (tag) => o.revalidateTag(tag, { ...CMS_REVALIDATE_PROFILE }) : o.revalidate;
  const unauthorized = () => Response.json({ revalidated: false }, { status: 401 });
  const tooLarge = () => Response.json({ revalidated: false }, { status: 413 });
  return async (req) => {
    const signature = req.headers.get(SIGNATURE_HEADER) ?? '';
    const stamp = req.headers.get(TIMESTAMP_HEADER) ?? '';
    if (!/^\d{1,15}$/.test(stamp) || !/^[0-9a-f]{64}$/.test(signature)) return unauthorized();
    const nowSeconds = Math.floor(now() / 1000);
    if (Math.abs(nowSeconds - Number(stamp)) > DEFAULT_TOLERANCE_SECONDS) return unauthorized();
    const declared = req.headers.get('content-length');
    if (declared !== null && !(/^\d{1,15}$/.test(declared) && Number(declared) <= MAX_WEBHOOK_BODY_BYTES)) return tooLarge();
    let secrets: string[];
    try {
      secrets = normalizeWebhookSecrets(o.secrets());
    } catch {
      return Response.json({ revalidated: false }, { status: 500 });
    }
    const body = await readCapped(req, MAX_WEBHOOK_BODY_BYTES);
    if (body === null) return tooLarge();
    const ok = verifyWebhook({ body, signature, timestamp: Number(stamp), secrets, nowSeconds });
    if (!ok) return unauthorized();
    await revalidate('cms');
    return Response.json({ revalidated: true, at: new Date(now()).toISOString() });
  };
}
