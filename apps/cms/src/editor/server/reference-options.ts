import 'server-only';
import type { SupabaseClient } from '@/lib/supabase/types';

/** An entry's status as `api.entry_list` derives it (§4.3). */
export type EntryStatus = 'draft' | 'published' | 'changed' | 'archived';

/** One entry a reference field may point to, as the picker shows it. */
export type ReferenceOption = { id: string; type: string; title: string | null; status: EntryStatus };

export type ReferenceOptions = { options: ReferenceOption[]; truncated: boolean };

/** The picker lists at most this many entries, like the entry list (MAX_ROWS). */
export const MAX_REFERENCE_OPTIONS = 200;

/**
 * The entries of the given types in one tenant that a reference may point to (spec §5.2), read
 * from `api.entry_list` with the editor's own session (§4.5): RLS returns only rows of tenants the
 * caller is a member of, so another tenant's id, or a caller with no membership, lists nothing.
 * Archived entries are left out (they can never be published, so a reference to one could never
 * be published either). Ordered by title; `truncated` when there are more than the limit.
 * A database error is thrown with its code only, never read as "no entries".
 */
export async function listReferenceOptions(client: SupabaseClient, tenantId: string, types: readonly string[]): Promise<ReferenceOptions> {
  const { data, error } = await client
    .from('entry_list')
    .select('id, type, title, status')
    .eq('tenant_id', tenantId)
    .in('type', [...types])
    .is('archived_at', null)
    .order('title', { ascending: true, nullsFirst: false })
    .order('id', { ascending: true })
    .limit(MAX_REFERENCE_OPTIONS + 1);
  if (error) throw new Error(`entry_list: ${error.code}`);
  const rows = (data ?? []) as ReferenceOption[];
  return { options: rows.slice(0, MAX_REFERENCE_OPTIONS), truncated: rows.length > MAX_REFERENCE_OPTIONS };
}
