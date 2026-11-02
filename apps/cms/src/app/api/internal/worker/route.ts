import { after } from 'next/server';
import { z } from 'zod';
import { canonicalUuid } from '@litljomi/rich-text';
import { processAndDeliver } from '@/privileged/worker/pipeline';
import { verifyInternalSecret } from '@/privileged/internal-auth';

// The worker may run for up to five minutes after the response (decision 9).
export const maxDuration = 300;

// The trigger carries only the request ID (spec §6.1); the worker trusts nothing but the database.
const body = z.strictObject({ requestId: canonicalUuid });

/** The fast path: an editor action posts the new request ID here after `request_publish`. */
export async function POST(req: Request): Promise<Response> {
  if (!verifyInternalSecret(req)) return new Response(null, { status: 401 });
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return new Response(null, { status: 400 });
  }
  const parsed = body.safeParse(json);
  if (!parsed.success) return new Response(null, { status: 400 });
  const { requestId } = parsed.data;
  after(async () => {
    try {
      await processAndDeliver(requestId);
    } catch (error) {
      // The sweep retries what this run left behind (spec §6.3); this records the failure (decision 10).
      console.error('[cms-alert] worker run failed', { requestId }, error);
    }
  });
  return new Response(null, { status: 202 });
}
