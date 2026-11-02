import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

// Next.js 16 Proxy (formerly middleware): refreshes the editor's session and sends a request
// without one to /login. The worker and cron routes under /api authenticate with their own
// secrets and are not matched, nor are static assets, the self-hosted fonts under /fonts (the sign-in
// page needs them before there is a session) and the favicon.
export function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ['/((?!api/|_next/static|_next/image|fonts/|favicon\\.ico).*)'],
};
