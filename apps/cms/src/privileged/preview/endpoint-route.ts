import 'server-only';
import { supabaseUrl } from '@/lib/supabase/env';
import { createAdminClient } from '../admin-client';
import { handlePreviewRequest } from './endpoint';

/**
 * The entry for `app/api/preview/[tenant]/route.ts` (spec §7.5): the secret-key client, created
 * only once the request carries a token.
 */
export function previewGet(req: Request, tenant: string): Promise<Response> {
  return handlePreviewRequest(req, tenant, async () => ({
    admin: createAdminClient(),
    nowSeconds: () => Date.now() / 1000,
    stackUrl: supabaseUrl(),
  }));
}
