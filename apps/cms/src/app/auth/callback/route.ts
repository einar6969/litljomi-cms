import { NextResponse, type NextRequest } from 'next/server';
import { safeRedirectPath } from '@/lib/auth/routing';
import { createEditorClient } from '@/lib/supabase/server';

// The magic link's landing page (PKCE): exchanges the one-time code for a session, written to the
// editor's cookies, then redirects only to a path on this origin (no open redirect). A missing,
// used or expired code goes back to the sign-in page.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const next = safeRedirectPath(request.nextUrl.searchParams.get('next'));
  const failed = () => NextResponse.redirect(new URL('/login?error=link', request.url), 303);
  if (!code) return failed();
  try {
    const client = await createEditorClient();
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (error) {
      console.error('[auth] code exchange failed:', error.status, error.code);
      return failed();
    }
  } catch (error) {
    console.error('[auth] code exchange failed:', error instanceof Error ? error.name : 'unknown error');
    return failed();
  }
  return NextResponse.redirect(new URL(next, request.url), 303);
}
