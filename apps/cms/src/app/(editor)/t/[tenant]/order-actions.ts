'use server';

import { isManuallyOrdered } from '@litljomi/cms-schema';
import { z } from 'zod';
import { failureAmong, hasSession, loadEntryContext } from '@/editor/server/entry-context';
import { createEditorClient } from '@/lib/supabase/server';

// A12: the order of a manually ordered type's entries (spec §5.1, §4.6 api.move_entry). Every
// export here is an endpoint any signed-in user can call with any arguments. It validates its
// arguments, uses only the editor's own session (`createEditorClient`), resolves the entry's tenant
// and type only through `api.entry_list` and `api.my_tenants` (active tenant, type in its module:
// `loadEntryContext`), offers the move only for a type the module orders by hand, and lets RLS and
// api.move_entry decide the rest: the target's tenant and type, archived entries, the tenant's
// status under lock.

const args = z.object({ entryId: z.uuid(), targetId: z.uuid(), place: z.enum(['before', 'after']) });

export type MoveEntryResult = { ok: true } | { ok: false; code: 'invalid' | 'auth' | 'tenant_inactive' | 'error' };

/** Moves the entry just before or just after the target, at once (no draft, no publish). Never throws. */
export async function moveEntryAction(entryId: string, targetId: string, place: 'before' | 'after'): Promise<MoveEntryResult> {
  const parsed = args.safeParse({ entryId, targetId, place });
  if (!parsed.success || parsed.data.entryId === parsed.data.targetId) return { ok: false, code: 'invalid' };
  try {
    const client = await createEditorClient();
    if (!(await hasSession(client))) return { ok: false, code: 'auth' };
    const context = await loadEntryContext(client, parsed.data.entryId);
    if (!context || !isManuallyOrdered(context.type)) return { ok: false, code: 'error' };
    const { error, status } = await client.rpc('move_entry', {
      p_entry_id: context.entryId,
      p_target_id: parsed.data.targetId,
      p_place: parsed.data.place,
    });
    if (!error) return { ok: true };
    if (error.code === 'P0001' && error.message === 'tenant_inactive') return { ok: false, code: 'tenant_inactive' };
    return { ok: false, code: failureAmong({ error, status }, []) };
  } catch {
    return { ok: false, code: 'error' };
  }
}
