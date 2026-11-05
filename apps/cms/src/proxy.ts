import type { NextRequest } from 'next/server';
import { contentSecurityPolicy, newNonce } from '@/lib/security-headers';
import { supabaseUrl } from '@/lib/supabase/env';
import { updateSession } from '@/lib/supabase/proxy';

// Next.js 16 Proxy (formerly middleware): refreshes the editor's session and sends a request
// without one to /login. The worker and cron routes under /api authenticate with their own
// secrets and are not matched, nor are static assets, the self-hosted fonts under /fonts (the sign-in
// page needs them before there is a session), the favicon and the app icon (`src/app/icon.svg`,
// served at exactly `/icon.svg`; the browser fetches it before there is a session too).
// It also sets each page's Content-Security-Policy: on the request, where Next.js finds the nonce for
// the scripts it renders, and on the response, which is what the browser enforces.
export async function proxy(request: NextRequest) {
  const policy = contentSecurityPolicy(newNonce(), supabaseUrl());
  request.headers.set('Content-Security-Policy', policy);
  const response = await updateSession(request);
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

export const config = {
  matcher: ['/((?!api/|_next/static|_next/image|fonts/|favicon\\.ico$|icon\\.svg$).*)'],
};
