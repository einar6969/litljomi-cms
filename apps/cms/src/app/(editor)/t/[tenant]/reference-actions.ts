'use server';

import { z } from 'zod';
import { hasSession } from '@/editor/server/entry-context';
import { listReferenceOptions, type ReferenceOption } from '@/editor/server/reference-options';
import { createEditorClient } from '@/lib/supabase/server';
import { isActive, resolveTenant } from '@/lib/tenant';

// The reference picker's endpoint (spec §5.2). Like every action here, any signed-in user can call
// it with any arguments: it validates them, uses only the editor's own session
// (`createEditorClient`; never the secret key) and lets RLS decide which entries are visible. The
// tenant comes only from `api.my_tenants`. The types are only a filter over rows the editor may
// read anyway; a target of a type the field does not allow is refused at publish by the field's
// projection (M2-04).

// Content type names (packages/schema: lower-case kebab).
const typeName = z.string().max(100).regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
const args = z.object({ tenantSlug: z.string(), types: z.array(typeName).min(1).max(20) });

export type ReferenceOptionsResult =
  | { ok: true; options: ReferenceOption[]; truncated: boolean }
  | { ok: false; code: 'invalid' | 'auth' | 'error' };

/** The entries of the given types in the editor's tenant, for a reference field's picker. */
export async function referenceOptionsAction(tenantSlug: string, types: readonly string[]): Promise<ReferenceOptionsResult> {
  const parsed = args.safeParse({ tenantSlug, types });
  if (!parsed.success) return { ok: false, code: 'invalid' };
  try {
    const client = await createEditorClient();
    if (!(await hasSession(client))) return { ok: false, code: 'auth' };
    const tenant = await resolveTenant(client, parsed.data.tenantSlug);
    if (!tenant || !isActive(tenant)) return { ok: false, code: 'invalid' };
    const { options, truncated } = await listReferenceOptions(client, tenant.id, parsed.data.types);
    return { ok: true, options, truncated };
  } catch {
    return { ok: false, code: 'error' };
  }
}
