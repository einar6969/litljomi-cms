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
