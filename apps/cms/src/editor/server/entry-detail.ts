import 'server-only';
import type { SupabaseClient } from '@/lib/supabase/types';

export type EntryDetail = {
  tenant_id: string;
  type: string;
  slug: string | null;
  data: unknown;
  schema_version: number;
  draft_version: number;
  first_published_at: string | null;
  status: 'draft' | 'published' | 'changed' | 'archived';
};

/**
 * One entry and its draft data, read with the editor's own session through
 * `api.entry_detail_by_id` (§4.6: no view carries `data`). RLS decides what is visible; a row of
 * another tenant than the one the caller resolved reads as none. The call's `error` and `status`
 * are the caller's to handle.
 */
export async function readEntryDetail(client: SupabaseClient, entryId: string, tenantId: string) {
  const result = await client.rpc('entry_detail_by_id', { p_entry_id: entryId });
  const row = result.data as EntryDetail | null;
  return { error: result.error, status: result.status, data: row?.tenant_id === tenantId ? row : null };
}
