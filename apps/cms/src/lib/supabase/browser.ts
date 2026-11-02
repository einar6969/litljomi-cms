import { createBrowserClient } from '@supabase/ssr';
import { supabasePublicEnv } from './env';
import type { SupabaseClient } from './types';

/** The editor's client in the browser: the publishable key and the session cookies; only `api` (§4.2). */
export function createBrowserEditorClient(): SupabaseClient {
  const { url, publishableKey } = supabasePublicEnv();
  return createBrowserClient<any, 'api'>(url, publishableKey, { db: { schema: 'api' } });
}
