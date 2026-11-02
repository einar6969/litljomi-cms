import 'server-only';
import { cache } from 'react';
import { createEditorClient } from './supabase/server';
import type { SupabaseClient } from './supabase/types';

/** A tenant the signed-in editor is a member of, as `api.my_tenants` returns it. */
export type MyTenant = { id: string; slug: string; name: string; status: 'active' | 'suspended' };

const COLUMNS = 'id, slug, name, status';
// Tenant slugs (plan decision 2); a URL segment of another form names no tenant.
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 100;

/**
 * The tenant named by a URL slug, resolved only through `api.my_tenants` with the editor's own
 * session, so a tenant the editor is not a member of is indistinguishable from one that does not
 * exist (null; the route answers 404). A database error is thrown, never read as "not found".
 */
export async function resolveTenant(client: SupabaseClient, slug: string): Promise<MyTenant | null> {
  if (slug.length > MAX_SLUG_LENGTH || !SLUG.test(slug)) return null;
  const { data, error } = await client.from('my_tenants').select(COLUMNS).eq('slug', slug).maybeSingle();
  if (error) throw new Error(`my_tenants: ${error.code} ${error.message}`);
  return (data as MyTenant | null) ?? null;
}

/** Every tenant the editor is a member of, by name. */
export async function listMyTenants(client: SupabaseClient): Promise<MyTenant[]> {
  const { data, error } = await client.from('my_tenants').select(COLUMNS).order('name');
  if (error) throw new Error(`my_tenants: ${error.code} ${error.message}`);
  return (data as MyTenant[] | null) ?? [];
}

/**
 * The tenant of the current request's `/t/[tenant]` URL, resolved once per request with the
 * editor's session (`resolveTenant`). Layouts and pages render in parallel, so each one that
 * needs the tenant calls this rather than relying on its parent's check.
 */
export const currentTenant = cache(async (slug: string): Promise<MyTenant | null> => resolveTenant(await createEditorClient(), slug));
