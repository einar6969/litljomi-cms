import 'server-only';
import { createEditorClient } from '@/lib/supabase/server';
import { createAdminClient } from '../admin-client';
import { handlePreviewTokenRequest } from './token';

/**
 * The entry for `app/api/preview-token/route.ts` (spec §7.5): the editor's client from the request
 * cookies and the secret-key client, created only once the request has passed its own checks.
 */
export function previewTokenPost(req: Request): Promise<Response> {
  return handlePreviewTokenRequest(req, async () => ({
    editor: await createEditorClient(),
    admin: createAdminClient(),
    nowSeconds: () => Date.now() / 1000,
  }));
}
