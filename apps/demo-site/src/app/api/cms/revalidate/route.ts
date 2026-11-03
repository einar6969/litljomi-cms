import { revalidateTag } from 'next/cache';
import { createRevalidateHandler, parseWebhookSecrets } from '@litljomi/cms-sdk';
import { env } from '../../../../lib/cms';

// The SDK calls Next.js's own revalidateTag as revalidateTag('cms', { expire: 0 }), which means the
// same on Next.js 15 and 16 (plan M3-13): the next request regenerates from a fresh pointer (spec
// §7.3, decision 48.2). With 'max' it would be served from the cached pointer while a fresh one
// loads in the background, and the webhook would not take effect until a second one.
export const POST = createRevalidateHandler({
  // Trimmed; an empty entry is refused with a 500 (M3-09).
  secrets: () => parseWebhookSecrets(env.CMS_WEBHOOK_SECRETS),
  revalidateTag,
});
