import { createBrowserClient } from '@supabase/ssr';
import { supabasePublicEnv } from './env';
import { documentSessionCookies, sessionCookieOptions, writeDocumentCookie } from './session-cookies';
import type { SupabaseClient } from './types';

/**
 * The editor's client in the browser: the publishable key and the session cookies; only `api`
 * (§4.2). It refreshes the session itself in a tab left open, so its writes keep the same flags as
 * the server's (the default document.cookie writer would give them 400 days and no `Secure`).
 */
export function createBrowserEditorClient(): SupabaseClient {
  const { url, publishableKey } = supabasePublicEnv();
  return createBrowserClient<any, 'api'>(url, publishableKey, {
    db: { schema: 'api' },
    cookies: {
      getAll: () => documentSessionCookies(document.cookie),
      setAll(cookiesToSet) {
        const secure = location.protocol === 'https:';
        for (const { name, value, options } of cookiesToSet) writeDocumentCookie(name, value, sessionCookieOptions(options, secure));
      },
    },
  });
}
