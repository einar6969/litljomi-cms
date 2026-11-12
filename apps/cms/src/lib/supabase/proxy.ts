import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { PASSWORD_STEP_COOKIE, SET_PASSWORD_PATH, passwordStepOf } from '../auth/password-step';
import { REFRESH_PATH, isPublicPath, refreshesExpiredSession } from '../auth/routing';
import { supabasePublicEnv } from './env';
import { fetchWithoutRefresh } from './no-refresh-fetch';
import { serverCookiesAreSecure, sessionCookieOptions } from './session-cookies';
import { sessionHasExpired } from './session-expiry';

/**
 * Checks the editor's session on every request the proxy sees: Supabase Auth verifies it
 * (`getUser`), and any cookies the client changes are written to both the request (for the page
 * that renders next) and the response. Without a session, every path but the public ones
 * (lib/auth/routing.ts) is redirected to `/login`. A convenience, not the boundary (§4.5): pages
 * check the session again and the database checks every call.
 *
 * The server never refreshes a session (R7; no-refresh-fetch.ts): the browser does, from the
 * editor's own address. A page navigation whose session's access token has expired goes to the
 * refresh page, which comes back to it; any other request with one counts as signed out, and its
 * cookies are left for the browser to refresh.
 *
 * After an invitation or reset link (PW-03), while the set-password step names the session the
 * request carries (lib/auth/password-step.ts), every other path that needs a session is redirected
 * to the set-password page, whatever the editor types or follows. A step left from another session
 * is removed.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const { url, publishableKey } = supabasePublicEnv();
  if (await sessionHasExpired(request.cookies.getAll(), url)) return expiredSession(request);
  let response = NextResponse.next({ request });
  // `<any, 'api'>` as in lib/supabase/types.ts: no generated database types yet (see there).
  const supabase = createServerClient<any, 'api'>(url, publishableKey, {
    db: { schema: 'api' },
    global: { fetch: fetchWithoutRefresh },
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
  // The session getUser has just verified.
  const { data } = await supabase.auth.getSession();
  if (passwordStepOf(step, data.session?.access_token) === null) {
    response.cookies.set(PASSWORD_STEP_COOKIE, '', { path: '/', maxAge: 0, httpOnly: true, secure: true, sameSite: 'lax' });
    return response;
  }
  return pathname === SET_PASSWORD_PATH ? response : redirectTo(SET_PASSWORD_PATH, request, response);
}

/**
 * A request whose session's access token has expired, which the server cannot refresh (R7). A page
 * navigation (a GET that is not a server action) goes to the refresh page with its path, and comes
 * back once the browser has refreshed; the sign-in pages are served as they are. Anything else
 * counts as signed out, as without a session. No cookie is touched: the refresh token in them is
 * the browser's to use.
 */
function expiredSession(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const navigation = request.method === 'GET' && !request.headers.has('next-action');
  if (navigation && refreshesExpiredSession(pathname)) {
    const back = request.nextUrl.clone();
    // The router's cache key on a client-side navigation; the full load after the refresh has none.
    back.searchParams.delete('_rsc');
    const to = new URL(REFRESH_PATH, request.url);
    to.searchParams.set('next', `${back.pathname}${back.search}`);
    return NextResponse.redirect(to);
  }
  return isPublicPath(pathname) ? NextResponse.next({ request }) : NextResponse.redirect(new URL('/login', request.url));
}

/** A redirect to `path` that keeps the cookies `response` writes (a cleared session). */
function redirectTo(path: string, request: NextRequest, response: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(new URL(path, request.url));
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}
