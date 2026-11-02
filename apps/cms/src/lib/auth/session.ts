import 'server-only';
import { redirect } from 'next/navigation';
import type { SupabaseClient } from '../supabase/types';

/**
 * The signed-in editor's user ID, verified by Supabase Auth; otherwise a redirect to the sign-in
 * page. Editor pages call this even though the proxy already redirects, so a page never relies on
 * the proxy's matcher alone.
 */
export async function requireUserId(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) redirect('/login');
  return data.user.id;
}
