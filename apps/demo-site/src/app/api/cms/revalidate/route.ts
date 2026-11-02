import { revalidateTag } from 'next/cache';
import { createRevalidateHandler } from '@litljomi/cms-sdk';
import { env } from '../../../../lib/cms';

export const POST = createRevalidateHandler({
  secrets: () => env.CMS_WEBHOOK_SECRETS.split(','),
  revalidate: (tag) => revalidateTag(tag, 'max'),
});
