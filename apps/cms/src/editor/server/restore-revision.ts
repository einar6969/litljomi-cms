import 'server-only';
import type { SupabaseClient } from '@/lib/supabase/types';
import type { RevisionSummary } from '../revisions';
import { loadEntryContext } from './entry-context';
import { upcastAndSave, type UpdateDraftSchemaResult } from './update-draft-schema';

export type { RevisionSummary };

export type RestoreRevisionResult = UpdateDraftSchemaResult;

/** Enough for an entry's history on one screen; older revisions stay in the database. */
export const HISTORY_LIMIT = 50;

type HistoryRow = { id: string; committed_at: string; requested_by: string; is_published: boolean };
type RevisionRow = { tenant_id: string; entry_id: string; data: unknown; schema_version: number };

/**
 * An entry's published revisions, newest first, read from `api.revision_list` with the editor's
 * own session (RLS: members of the entry's tenant only), filtered to the tenant the page resolved.
 * Editors cannot see each other's addresses, so "who" is whether the reader asked for it. A
 * database error is thrown.
 */
export async function loadRevisionHistory(client: SupabaseClient, tenantId: string, entryId: string): Promise<RevisionSummary[]> {
  const { data, error } = await client
    .from('revision_list')
    .select('id, committed_at, requested_by, is_published')
    .eq('entry_id', entryId)
    .eq('tenant_id', tenantId)
    .order('committed_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error) throw new Error(`revision_list: ${error.code}`);
  const user = await client.auth.getUser();
  const me = user.data.user?.id ?? null;
  return (data as HistoryRow[]).map((r) => ({ id: r.id, committedAt: r.committed_at, mine: me !== null && r.requested_by === me, current: r.is_published }));
}

/**
 * Restore from a revision (spec §5.5 "copies its data into the draft (a normal versioned save).
 * Revisions are never modified"; §7.1; plan M2-16). The revision is read with the editor's own
 * session through `api.revision_detail_by_id`, only as a revision of this entry in the entry's
 * tenant; its data is upcast from the version it was written at to the type's current version
 * (M2-05), stripped of unknown keys by the type's draft validator and saved through
 * `api.save_draft`, expecting the version the editor saw. Only ids and that version come from the
 * caller.
 *
 * A revision that is not visible or not this entry's is the generic `error`. A failing transform,
 * a gap in the chain or a revision newer than the deployed type is `upcast_failed`; upcast data the
 * validator refuses is `invalid`. A database error on a read is thrown.
 */
export async function restoreRevision(client: SupabaseClient, entryId: string, revisionId: string, expectedVersion: number): Promise<RestoreRevisionResult> {
  const context = await loadEntryContext(client, entryId);
  if (!context) return { ok: false, code: 'error' };
  const read = await client.rpc('revision_detail_by_id', { p_revision_id: revisionId });
  if (read.error) throw new Error(`revision_detail_by_id: ${read.error.code}`);
  const revision = read.data as RevisionRow | null;
  if (revision?.entry_id !== context.entryId || revision.tenant_id !== context.tenantId) return { ok: false, code: 'error' };

  return upcastAndSave(client, context, revision.data, revision.schema_version, expectedVersion);
}
