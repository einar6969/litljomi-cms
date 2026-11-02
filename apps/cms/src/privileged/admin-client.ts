import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { supabaseUrl } from '../lib/supabase/env';
import type { SupabaseClient } from '../lib/supabase/types';

/**
 * The secret-key client, for the worker and the preview endpoint only (spec §3.1, §8.1). It runs as
 * `service_role` and keeps no session. Only `api` is exposed, so it reaches the database through
 * the `worker_*` functions (decision 4). `server-only` makes a client-side import a build error
 * (defence in depth next to the ESLint rule).
 */
export function createAdminClient(): SupabaseClient {
  const url = supabaseUrl();
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) throw new Error('SUPABASE_SECRET_KEY is not set');
  // `any`: no generated database types yet (lib/supabase/types.ts).
  return createClient<any, 'api'>(url, secretKey, {
    db: { schema: 'api' },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
