import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabasePublicEnv } from './env';
import type { SupabaseClient } from './types';

/**
 * The editor's client on the server: the publishable key and the signed-in editor's session from
 * the request cookies, so every call runs as that editor under RLS. Only `api` is exposed (§4.2).
 */
export async function createEditorClient(): Promise<SupabaseClient> {
  const { url, publishableKey } = supabasePublicEnv();
  const cookieStore = await cookies();
  return createServerClient<any, 'api'>(url, publishableKey, {
    db: { schema: 'api' },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // A Server Component cannot set cookies; the session is refreshed where it can be (Task 22).
        }
      },
    },
  });
}

/**
 * A client with the publishable key that neither reads nor writes the request cookies: whatever
 * session it gets stays in this object. The magic link's confirm action uses it to verify a link
 * for a visitor who is already signed in, so the link's session is known before it replaces the
 * visitor's own (M3-14), and to check or end that pending session by its access token.
 */
export function createDetachedClient(): SupabaseClient {
  const { url, publishableKey } = supabasePublicEnv();
  return createServerClient<any, 'api'>(url, publishableKey, {
    db: { schema: 'api' },
    cookies: { getAll: () => [], setAll: () => {} },
  });
}
