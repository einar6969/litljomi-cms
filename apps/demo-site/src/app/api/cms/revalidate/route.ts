import { revalidateTag } from 'next/cache';
import { createRevalidateHandler } from '@litljomi/cms-sdk';
import { env } from '../../../../lib/cms';

// { expire: 0 }: the next request regenerates from a fresh pointer (spec §7.3, decision 48.2). With
// 'max' it would be served from the cached pointer while a fresh one loads in the background, and
// the webhook would not take effect until a second one.
export const POST = createRevalidateHandler({
  secrets: () => env.CMS_WEBHOOK_SECRETS.split(','),
  revalidate: (tag) => revalidateTag(tag, { expire: 0 }),
});
