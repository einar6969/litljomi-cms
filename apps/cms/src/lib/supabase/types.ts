import type { SupabaseClient as BaseSupabaseClient } from '@supabase/supabase-js';

/**
 * The CMS app's Supabase client. Every client here uses the `api` schema, the only exposed one
 * (§4.2), so the type names it: supabase-js's bare `SupabaseClient` is typed for `public` and does
 * not accept an `api` client. App code outside lib/supabase and privileged/ imports this type, not
 * supabase-js (ESLint).
 */
export type SupabaseClient = BaseSupabaseClient<any, 'api'>;
