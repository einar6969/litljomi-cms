'use server';

import { z } from 'zod';
import { failureOf, hasSession, loadEntryContext } from '@/editor/server/entry-context';
import { createEditorClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import { getType } from '@/modules/registry';

// Every export here is an endpoint any signed-in user can call with any arguments. Each action
// validates its arguments, uses only the editor's own session (`createEditorClient`) and lets RLS
// and the `api` functions decide; nothing here trusts a tenant or a version the caller names.

const entryId = z.uuid();
const draftVersion = z.number().int().min(1).max(2_147_483_647);
// The database check (§4.3, decision 2); the length bound keeps a long title's slug storable.
const slugShape = z.string().max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const MAX_NAME_LENGTH = 100;

export type SaveDraftResult =
  | { ok: true; version: number }
  | { ok: false; code: 'version_conflict' | 'auth' | 'invalid' | 'error'; issues?: { path: (string | number)[]; message: string }[] };

export type SetSlugResult =
  | { ok: true; slug: string }
  | { ok: false; code: 'invalid' | 'slug_taken' | 'slug_locked' | 'auth' | 'error' };

/**
 * Creates an entry and its empty draft in a tenant the editor is a member of. The tenant comes
 * only from `api.my_tenants` and the type must be in that tenant's module. Throws on any failure;
 * the form shows one generic message.
 */
export async function createEntryAction(tenantSlug: string, type: string): Promise<{ entryId: string }> {
  if (typeof tenantSlug !== 'string' || typeof type !== 'string' || type.length > MAX_NAME_LENGTH) throw new Error('create_entry: invalid arguments');
  const client = await createEditorClient();
  const tenant = await resolveTenant(client, tenantSlug);
  const contentType = tenant?.status === 'active' ? getType(tenant.slug, type) : undefined;
  if (!tenant || !contentType) throw new Error('create_entry: unknown tenant or type');
  const { data, error } = await client.rpc('create_entry', {
    p_tenant_id: tenant.id,
    p_type: contentType.name,
    p_slug: null,
    p_schema_version: contentType.version,
  });
  if (error || typeof data !== 'string') throw new Error(`create_entry: ${error?.code ?? 'no id'}`);
  return { entryId: data };
}

/**
 * Autosave (§5.5). The data is checked with the type's lenient draft validator, which also strips
 * keys the type does not define (§5.3); `title` and `sort_at` come from the same type. The caller's
 * version is passed through, so a stale save is `version_conflict`. A field kind the form cannot
 * edit yet is saved unchanged because the form sends it back as it received it.
 */
export async function saveDraftAction(id: string, expectedVersion: number, data: unknown): Promise<SaveDraftResult> {
  const args = z.object({ id: entryId, expectedVersion: draftVersion }).safeParse({ id, expectedVersion });
  if (!args.success) return { ok: false, code: 'invalid' };
  try {
    const client = await createEditorClient();
    if (!(await hasSession(client))) return { ok: false, code: 'auth' };
    const context = await loadEntryContext(client, args.data.id);
    if (!context) return { ok: false, code: 'error' };
    const parsed = context.type.draftValidator().safeParse(data);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => ({ path: i.path.map((p) => (typeof p === 'number' ? p : String(p))), message: i.message }));
      return { ok: false, code: 'invalid', issues };
    }
    const { title, sortAt } = context.type.queryColumns(parsed.data);
    const result = await client.rpc('save_draft', {
      p_entry_id: context.entryId,
      p_expected_version: args.data.expectedVersion,
      p_data: parsed.data,
      p_schema_version: context.type.version,
      p_title: title,
      p_sort_at: sortAt,
    });
    if (result.error) {
      const failure = failureOf({ error: result.error, status: result.status });
      return { ok: false, code: failure === 'version_conflict' || failure === 'auth' ? failure : 'error' };
    }
    return typeof result.data === 'number' ? { ok: true, version: result.data } : { ok: false, code: 'error' };
  } catch {
    return { ok: false, code: 'error' };
  }
}

/** Sets the entry's slug before its first publication (§4.6); the database locks it afterwards. */
export async function setSlugAction(id: string, slug: string): Promise<SetSlugResult> {
  const args = z.object({ id: entryId, slug: slugShape }).safeParse({ id, slug });
  if (!args.success) return { ok: false, code: 'invalid' };
  try {
    const client = await createEditorClient();
    if (!(await hasSession(client))) return { ok: false, code: 'auth' };
    const context = await loadEntryContext(client, args.data.id);
    if (!context) return { ok: false, code: 'error' };
    const result = await client.rpc('set_slug', { p_entry_id: context.entryId, p_slug: args.data.slug });
    if (result.error) {
      const failure = failureOf({ error: result.error, status: result.status });
      return { ok: false, code: failure === 'slug_taken' || failure === 'slug_locked' || failure === 'auth' ? failure : 'error' };
    }
    return { ok: true, slug: args.data.slug };
  } catch {
    return { ok: false, code: 'error' };
  }
}
