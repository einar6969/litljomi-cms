import { DEFAULT_TOLERANCE_SECONDS, SIGNATURE_HEADER, TIMESTAMP_HEADER, verifyWebhook } from './webhook.ts';

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
 * Route handler body for the site's revalidation endpoint. The site passes its own
 * `revalidateTag`, so the SDK does not depend on a Next.js version. 401 on a bad signature or a
 * stale timestamp, checked (with the signature's format) before the body is read; 413 on a body
 * over MAX_WEBHOOK_BODY_BYTES (declared or streamed); the signature covers the raw body bytes. A throwing `secrets()` gives a plain 500 without detail. Otherwise revalidates the `cms` tag and answers 200.
 */
export function createRevalidateHandler(o: {
  secrets: () => string[];
  revalidate: (tag: string) => void | Promise<void>;
  now?: () => number;
}): (req: Request) => Promise<Response> {
  const now = o.now ?? Date.now;
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
      secrets = o.secrets();
    } catch {
      return Response.json({ revalidated: false }, { status: 500 });
    }
    const body = await readCapped(req, MAX_WEBHOOK_BODY_BYTES);
    if (body === null) return tooLarge();
    const ok = verifyWebhook({ body, signature, timestamp: Number(stamp), secrets, nowSeconds });
    if (!ok) return unauthorized();
    await o.revalidate('cms');
    return Response.json({ revalidated: true, at: new Date(now()).toISOString() });
  };
}
