import 'server-only';
import type { ContentType } from '@litljomi/cms-schema';
import type { SupabaseClient } from '@/lib/supabase/types';
import { isActive } from '@/lib/tenant';
import { getType } from '@/modules/registry';

/** What an `api` call answered with, as supabase-js reports it. */
export type ApiError = { code?: string; message?: string };
export type ApiResult = { error: ApiError | null; status?: number };

/** The editor-facing outcome of a failed `api` call (decision 3). `error` is the generic one. */
export type ApiFailure = 'version_conflict' | 'slug_taken' | 'slug_locked' | 'auth' | 'error';

// PostgREST answers an expired or malformed JWT with PGRST301/PGRST303 (status 401); a request
// with no session is the `anon` role, which has no EXECUTE on the editor's functions.
const AUTH_CODES = new Set(['PGRST301', 'PGRST302', 'PGRST303']);

/**
 * Maps a failed `api` call: a P0001 message the editor has its own text for, an expired or missing
 * session, and everything else (integrity SQLSTATEs 23xxx, 22P02, 54000, not_found, forbidden, an
 * unreachable database) to the one generic error. Raw messages never reach the browser.
 */
export function failureOf({ error, status }: ApiResult & { error: ApiError }): ApiFailure {
  if (error.code === 'P0001') {
    if (error.message === 'version_conflict' || error.message === 'slug_taken' || error.message === 'slug_locked') return error.message;
    return 'error';
  }
  if (status === 401 || (error.code !== undefined && AUTH_CODES.has(error.code)) || /\bJWT\b/.test(error.message ?? '')) return 'auth';
  return 'error';
}

/** True when Supabase Auth, asked with the editor's session, says there is a signed-in user. */
export async function hasSession(client: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await client.auth.getUser();
    return !error && data.user !== null;
  } catch {
    return false;
  }
}

export type EntryContext = { entryId: string; tenantId: string; tenantSlug: string; type: ContentType };

/**
 * The entry's tenant and content type, read with the editor's own session: the entry through
 * `api.entry_list` (RLS hides another tenant's) and its tenant through `api.my_tenants`. Null when
 * the entry is not visible, its tenant is not active, or its type is not in the tenant's module.
 * A database error is thrown, never read as "not found".
 */
export async function loadEntryContext(client: SupabaseClient, entryId: string): Promise<EntryContext | null> {
  const entry = await client.from('entry_list').select('id, tenant_id, type').eq('id', entryId).maybeSingle();
  if (entry.error) throw new Error(`entry_list: ${entry.error.code}`);
  if (!entry.data) return null;
  const tenant = await client.from('my_tenants').select('id, slug, status').eq('id', entry.data.tenant_id).maybeSingle();
  if (tenant.error) throw new Error(`my_tenants: ${tenant.error.code}`);
  if (!tenant.data || !isActive(tenant.data)) return null;
  const type = getType(tenant.data.slug, entry.data.type);
  if (!type) return null;
  return { entryId, tenantId: entry.data.tenant_id, tenantSlug: tenant.data.slug, type };
}
