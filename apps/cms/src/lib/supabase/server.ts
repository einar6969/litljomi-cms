import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabasePublicEnv } from './env';
import { fetchWithoutRefresh } from './no-refresh-fetch';
import { serverCookiesAreSecure, sessionCookieOptions } from './session-cookies';
import type { SupabaseClient } from './types';

/**
 * The editor's client on the server: the publishable key and the signed-in editor's session from
 * the request cookies, so every call runs as that editor under RLS. Only `api` is exposed (§4.2).
 * It never refreshes the session (R7; no-refresh-fetch.ts): an expired one counts as signed out.
 */
export async function createEditorClient(): Promise<SupabaseClient> {
  const { url, publishableKey } = supabasePublicEnv();
  const cookieStore = await cookies();
  return createServerClient<any, 'api'>(url, publishableKey, {
    db: { schema: 'api' },
    global: { fetch: fetchWithoutRefresh },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          const secure = serverCookiesAreSecure();
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, sessionCookieOptions(options, secure));
        } catch {
          // A Server Component cannot set cookies; an action or the browser writes them (Task 22).
        }
      },
    },
  });
}

/**
 * A client with the publishable key that neither reads nor writes the request cookies: whatever
 * session it gets stays in this object. The links' confirm action uses it to verify a link
 * for a visitor who is already signed in, so the link's session is known before it replaces the
 * visitor's own (M3-14), and to check or end that pending session by its access token.
 */
export function createDetachedClient(): SupabaseClient {
  const { url, publishableKey } = supabasePublicEnv();
  return createServerClient<any, 'api'>(url, publishableKey, {
    db: { schema: 'api' },
    global: { fetch: fetchWithoutRefresh },
    cookies: { getAll: () => [], setAll: () => {} },
  });
}
