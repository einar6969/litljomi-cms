import 'server-only';

/**
 * The fast path (spec §6.1; decisions 9 and 35): after `request_publish`, the editor's action posts
 * only the request ID to the internal worker route, authenticated by the internal secret. It lives
 * outside privileged/ because it holds no Supabase credentials: only `CMS_PUBLIC_URL` and
 * `CMS_INTERNAL_SECRET`. The worker trusts nothing but the database. Throws when the route does not
 * accept the trigger (HTTP status other than 2xx); the per-minute sweep picks the request up then.
 */
export async function triggerWorker(requestId: string): Promise<void> {
  const baseUrl = process.env.CMS_PUBLIC_URL;
  const secret = process.env.CMS_INTERNAL_SECRET;
  if (!baseUrl) throw new Error('CMS_PUBLIC_URL is not set');
  if (!secret) throw new Error('CMS_INTERNAL_SECRET is not set');
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/internal/worker`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cms-internal-secret': secret },
    body: JSON.stringify({ requestId }),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`worker trigger failed: HTTP ${response.status}`);
}
