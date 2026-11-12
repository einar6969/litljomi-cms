import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { PASSWORD_STEP_COOKIE, SET_PASSWORD_PATH, passwordStepOf } from '../auth/password-step';
import { isPublicPath } from '../auth/routing';
import { supabasePublicEnv } from './env';
import { serverCookiesAreSecure, sessionCookieOptions } from './session-cookies';

/**
 * Refreshes the editor's session on every request the proxy sees: Supabase Auth verifies the
 * session (`getUser`), and refreshed tokens are written to both the request (for the page that
 * renders next) and the response. Without a session, every path but the sign-in pages and the
 * links' confirm page is redirected to `/login`. A convenience, not the boundary (§4.5):
 * pages check the session again and the database checks every call.
 *
 * After an invitation or reset link (PW-03), while the set-password step names the session the
 * request carries (lib/auth/password-step.ts), every other path that needs a session is redirected
 * to the set-password page, whatever the editor types or follows. A step left from another session
 * is removed.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const { url, publishableKey } = supabasePublicEnv();
  let response = NextResponse.next({ request });
  // `<any, 'api'>` as in lib/supabase/types.ts: no generated database types yet (see there).
  const supabase = createServerClient<any, 'api'>(url, publishableKey, {
    db: { schema: 'api' },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        const secure = serverCookiesAreSecure();
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, sessionCookieOptions(options, secure));
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;
  if (!user) return isPublicPath(pathname) ? response : redirectTo('/login', request, response);

  const step = request.cookies.get(PASSWORD_STEP_COOKIE)?.value;
  if (step === undefined || isPublicPath(pathname)) return response;
  // The session getUser has just verified (and refreshed, if it had to).
  const { data } = await supabase.auth.getSession();
  if (passwordStepOf(step, data.session?.access_token) === null) {
    response.cookies.set(PASSWORD_STEP_COOKIE, '', { path: '/', maxAge: 0, httpOnly: true, secure: true, sameSite: 'lax' });
    return response;
  }
  return pathname === SET_PASSWORD_PATH ? response : redirectTo(SET_PASSWORD_PATH, request, response);
}

/** A redirect to `path` that keeps the cookies `response` writes (a refreshed or cleared session). */
function redirectTo(path: string, request: NextRequest, response: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(new URL(path, request.url));
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}
