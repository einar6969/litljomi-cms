import { DEFAULT_TOLERANCE_SECONDS, SIGNATURE_HEADER, TIMESTAMP_HEADER, verifyWebhook } from './webhook.ts';

/**
 * Route handler body for the site's revalidation endpoint. The site passes its own
 * `revalidateTag`, so the SDK does not depend on a Next.js version. 401 on a bad signature or a
 * stale timestamp, checked (with the signature's format) before the body is read; the signature
 * covers the raw body bytes. A throwing `secrets()` gives a plain 500 without detail. Otherwise revalidates the `cms` tag and answers 200.
 */
export function createRevalidateHandler(o: {
  secrets: () => string[];
  revalidate: (tag: string) => void | Promise<void>;
  now?: () => number;
}): (req: Request) => Promise<Response> {
  const now = o.now ?? Date.now;
  const unauthorized = () => Response.json({ revalidated: false }, { status: 401 });
  return async (req) => {
    const signature = req.headers.get(SIGNATURE_HEADER) ?? '';
    const stamp = req.headers.get(TIMESTAMP_HEADER) ?? '';
    if (!/^\d{1,15}$/.test(stamp) || !/^[0-9a-f]{64}$/.test(signature)) return unauthorized();
    const nowSeconds = Math.floor(now() / 1000);
    if (Math.abs(nowSeconds - Number(stamp)) > DEFAULT_TOLERANCE_SECONDS) return unauthorized();
    let secrets: string[];
    try {
      secrets = o.secrets();
    } catch {
      return Response.json({ revalidated: false }, { status: 500 });
    }
    const body = new Uint8Array(await req.arrayBuffer());
    const ok = verifyWebhook({ body, signature, timestamp: Number(stamp), secrets, nowSeconds });
    if (!ok) return unauthorized();
    await o.revalidate('cms');
    return Response.json({ revalidated: true, at: new Date(now()).toISOString() });
  };
}
