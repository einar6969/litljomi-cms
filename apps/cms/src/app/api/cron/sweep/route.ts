import { sweep } from '@/privileged/worker/pipeline';
import { verifyCronSecret } from '@/privileged/internal-auth';

export const maxDuration = 300;

/**
 * Vercel Cron, every minute (vercel.json): picks up whatever the fast path missed. It reads only the
 * Authorization header; the sweep decides from the database what to do, never from the request.
 */
export async function GET(req: Request): Promise<Response> {
  if (!verifyCronSecret(req)) return new Response(null, { status: 401 });
  try {
    await sweep();
  } catch (error) {
    console.error('[cms-alert] sweep failed', error);
    return new Response(null, { status: 500 });
  }
  return new Response(null, { status: 200 });
}
