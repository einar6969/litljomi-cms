import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isPublicPath } from '../auth/routing';
import { supabasePublicEnv } from './env';

/**
 * Refreshes the editor's session on every request the proxy sees: Supabase Auth verifies the
 * session (`getUser`), and refreshed tokens are written to both the request (for the page that
 * renders next) and the response. Without a session, every path but the sign-in page and the
 * callback is redirected to `/login`. A convenience, not the boundary (§4.5): pages check the
 * session again and the database checks every call.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const { url, publishableKey } = supabasePublicEnv();
  let response = NextResponse.next({ request });
  const supabase = createServerClient<any, 'api'>(url, publishableKey, {
    db: { schema: 'api' },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user || isPublicPath(request.nextUrl.pathname)) return response;

  const redirect = NextResponse.redirect(new URL('/login', request.url));
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}
