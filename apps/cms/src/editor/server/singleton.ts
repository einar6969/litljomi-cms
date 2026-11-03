import 'server-only';
import type { SupabaseClient } from '@/lib/supabase/types';
import { authOrError } from './entry-context';

export type OpenSingletonResult = { ok: true; entryId: string } | { ok: false; code: 'auth' | 'error' };

/**
 * Opens a singleton type (spec §10.1; M2-09): `api.create_singleton_entry` returns the tenant's one
 * live entry of the type and creates it, with an empty draft, on first open. The database enforces
 * one entry, and two concurrent first opens both get the same id, so neither editor sees an error.
 * Runs with the editor's own session; the tenant id must come from `api.my_tenants`.
 */
export async function openSingleton(
  client: Pick<SupabaseClient, 'rpc'>,
  tenantId: string,
  type: { name: string; version: number },
): Promise<OpenSingletonResult> {
  const { data, error, status } = await client.rpc('create_singleton_entry', {
    p_tenant_id: tenantId,
    p_type: type.name,
    p_schema_version: type.version,
  });
  if (error) return { ok: false, code: authOrError({ error, status }) };
  return typeof data === 'string' ? { ok: true, entryId: data } : { ok: false, code: 'error' };
}
