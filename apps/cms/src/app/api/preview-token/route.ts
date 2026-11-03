import { previewTokenPost } from '@/privileged/preview/token-route';

// The preview token route (spec §7.5, plan M3-10). Its logic is in privileged/ (decision 35's rule,
// extended to this one entry): it verifies the editor's session, reads the entry with the editor's
// JWT and mints the token with the site's preview secret. Never cached.
export const dynamic = 'force-dynamic';

export function POST(req: Request): Promise<Response> {
  return previewTokenPost(req);
}
