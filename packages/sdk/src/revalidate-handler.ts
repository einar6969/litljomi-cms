import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifyWebhook } from './webhook.ts';

/**
 * Route handler body for the site's revalidation endpoint. The site passes its own
 * `revalidateTag`, so the SDK does not depend on a Next.js version. 401 on a bad signature or a
 * stale timestamp; otherwise revalidates the `cms` tag and answers 200.
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
    if (!/^\d{1,15}$/.test(stamp)) return unauthorized();
    const body = await req.text();
    const ok = verifyWebhook({
      body,
      signature,
      timestamp: Number(stamp),
      secrets: o.secrets(),
      nowSeconds: Math.floor(now() / 1000),
    });
    if (!ok) return unauthorized();
    await o.revalidate('cms');
    return Response.json({ revalidated: true, at: new Date(now()).toISOString() });
  };
}
