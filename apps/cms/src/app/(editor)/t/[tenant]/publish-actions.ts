'use server';

import { after } from 'next/server';
import { z } from 'zod';
import { failureOf, hasSession, loadEntryContext, type ApiError } from '@/editor/server/entry-context';
import { createEditorClient } from '@/lib/supabase/server';
import { triggerWorker } from '@/lib/worker-trigger';

// Publish and unpublish (spec §6.1; plan Task 25, decisions 9 and 37.8). Every export here is an
// endpoint any signed-in user can call with any arguments. Each validates its arguments, uses only
// the editor's own session (`createEditorClient`; never privileged/ or the secret key), resolves the
// entry's tenant only through `api.entry_list` and `api.my_tenants` (active tenant, type in its
// module: `loadEntryContext`), and lets RLS and the `api` functions decide. The worker is then
// triggered with the request ID only, after the response; it trusts nothing but the database.

const entryId = z.uuid();
const draftVersion = z.number().int().min(1).max(2_147_483_647);
const requestId = z.uuid();

export type PublishError = 'invalid' | 'auth' | 'version_conflict' | 'tenant_inactive' | 'error';
export type PublishActionResult = { requestId: string } | { error: PublishError };

type RpcAnswer = { data: unknown; error: ApiError | null; status?: number };

/** A failed request call: the codes the panel has its own text for, else the generic error. */
function errorOf(error: ApiError, status: number | undefined): PublishError {
  if (error.code === 'P0001' && error.message === 'tenant_inactive') return 'tenant_inactive';
  const failure = failureOf({ error, status });
  return failure === 'version_conflict' || failure === 'auth' ? failure : 'error';
}

/**
 * The shared path of both actions: session, entry context, the request RPC, then the fast-path
 * trigger with `after()` (decision 9). A trigger that fails is logged; the per-minute sweep picks
 * the request up (§6.1).
 */
async function request(id: string, call: (client: Awaited<ReturnType<typeof createEditorClient>>, entry: string) => PromiseLike<RpcAnswer>): Promise<PublishActionResult> {
  try {
    const client = await createEditorClient();
    if (!(await hasSession(client))) return { error: 'auth' };
    const context = await loadEntryContext(client, id);
    if (!context) return { error: 'error' };
    const result = await call(client, context.entryId);
    if (result.error) return { error: errorOf(result.error, result.status) };
    const created = requestId.safeParse(result.data);
    if (!created.success) return { error: 'error' };
    const newId = created.data;
    after(async () => {
      try {
        await triggerWorker(newId);
      } catch (error) {
        console.error('[cms-worker] the worker trigger failed; the sweep picks the request up', { requestId: newId }, error instanceof Error ? error.message : String(error));
      }
    });
    return { requestId: newId };
  } catch {
    return { error: 'error' };
  }
}

/**
 * Requests publication of the draft version the editor last saw (`expectedDraftVersion`, the
 * autosave's version). A draft that moved on is `version_conflict` here or `superseded` at the
 * worker (review focus 3).
 */
export async function requestPublishAction(entryIdArg: string, expectedDraftVersion: number): Promise<PublishActionResult> {
  const args = z.object({ id: entryId, version: draftVersion }).safeParse({ id: entryIdArg, version: expectedDraftVersion });
  if (!args.success) return { error: 'invalid' };
  return request(args.data.id, (client, entry) =>
    client.rpc('request_publish', { p_entry_id: entry, p_expected_draft_version: args.data.version }),
  );
}

/** Requests withdrawal of the entry from the tenant's sites (§6.2: never refused because of references). */
export async function requestUnpublishAction(entryIdArg: string): Promise<PublishActionResult> {
  const args = entryId.safeParse(entryIdArg);
  if (!args.success) return { error: 'invalid' };
  return request(args.data, (client, entry) => client.rpc('request_unpublish', { p_entry_id: entry }));
}
