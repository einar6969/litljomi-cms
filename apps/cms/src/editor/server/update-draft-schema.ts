import 'server-only';
import { UpcastError } from '@litljomi/cms-schema';
import type { SupabaseClient } from '@/lib/supabase/types';
import { failureAmong, loadEntryContext, type EntryContext } from './entry-context';

export type UpdateDraftSchemaResult =
  | { ok: true; version: number }
  | { ok: false; code: 'version_conflict' | 'upcast_failed' | 'invalid' | 'auth' | 'error' };

type DraftRow = { data: unknown; schema_version: number; draft_version: number };

/**
 * Brings an outdated draft to its type's current schema version (spec §5.3; plan M2-14): the
 * stored draft is read with the editor's own session (RLS), upcast through the type's transforms,
 * stripped of unknown keys by the type's draft validator and saved through `api.save_draft` as a
 * normal versioned update, expecting the version the editor saw. Nothing the browser sends is
 * saved: only the entry id and the expected version come from the caller.
 *
 * A draft already at the current version (updated in another tab) is not saved again. A failing
 * transform, a gap in the chain or a draft newer than the deployed type is `upcast_failed`; upcast
 * data the validator refuses is `invalid`. A database error on a read is thrown.
 */
export async function updateDraftSchema(client: SupabaseClient, entryId: string, expectedVersion: number): Promise<UpdateDraftSchemaResult> {
  const context = await loadEntryContext(client, entryId);
  if (!context) return { ok: false, code: 'error' };
  const { type } = context;
  const read = await client
    .from('entry_detail')
    .select('data, schema_version, draft_version')
    .eq('id', context.entryId)
    .eq('tenant_id', context.tenantId)
    .maybeSingle();
  if (read.error) throw new Error(`entry_detail: ${read.error.code}`);
  const draft = read.data as DraftRow | null;
  if (!draft) return { ok: false, code: 'error' };
  if (draft.schema_version === type.version) return { ok: true, version: draft.draft_version };
  if (draft.draft_version !== expectedVersion) return { ok: false, code: 'version_conflict' };

  return upcastAndSave(client, context, draft.data, draft.schema_version, expectedVersion);
}

/**
 * Data written at `fromVersion`, brought to the type's current version and saved as the entry's
 * draft (spec §5.3, §5.5): upcast through the type's transforms (M2-05), stripped of unknown keys
 * by the type's draft validator, its query columns derived by the type, and saved through
 * `api.save_draft` expecting `expectedVersion`. Used by the outdated-draft update (M2-14) and by
 * restore from a revision (M2-16).
 */
export async function upcastAndSave(
  client: SupabaseClient,
  context: EntryContext,
  data: unknown,
  fromVersion: number,
  expectedVersion: number,
): Promise<UpdateDraftSchemaResult> {
  const { type } = context;
  let upcast: unknown;
  try {
    upcast = type.upcast(data, fromVersion);
  } catch (error) {
    if (error instanceof UpcastError) return { ok: false, code: 'upcast_failed' };
    throw error;
  }
  const parsed = type.draftValidator().safeParse(upcast);
  if (!parsed.success) return { ok: false, code: 'invalid' };
  const { title, sortAt } = type.queryColumns(parsed.data);
  const result = await client.rpc('save_draft', {
    p_entry_id: context.entryId,
    p_expected_version: expectedVersion,
    p_data: parsed.data,
    p_schema_version: type.version,
    p_title: title,
    p_sort_at: sortAt,
  });
  if (result.error) return { ok: false, code: failureAmong({ error: result.error, status: result.status }, ['version_conflict']) };
  return typeof result.data === 'number' ? { ok: true, version: result.data } : { ok: false, code: 'error' };
}
