import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '../lib/supabase/types';

/**
 * The secret-key client, for the worker and the preview endpoint only (spec §3.1, §8.1). It runs as
 * `service_role` and keeps no session. Only `api` is exposed, so it reaches the database through
 * the `worker_*` functions (decision 4).
 */
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
  if (!secretKey) throw new Error('SUPABASE_SECRET_KEY is not set');
  return createClient<any, 'api'>(url, secretKey, {
    db: { schema: 'api' },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
