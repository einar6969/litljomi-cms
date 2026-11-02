import type { SupabaseClient as BaseSupabaseClient } from '@supabase/supabase-js';

/**
 * The CMS app's Supabase client. Every client here uses the `api` schema, the only exposed one
 * (§4.2), so the type names it: supabase-js's bare `SupabaseClient` is typed for `public` and does
 * not accept an `api` client. App code outside lib/supabase and privileged/ imports this type, not
 * supabase-js (ESLint).
 */
//
// `any` stands in for generated database types until codegen exists; do not replace it with a
// hand-written type. The same `<any, 'api'>` is used where the clients are created.
export type SupabaseClient = BaseSupabaseClient<any, 'api'>;
