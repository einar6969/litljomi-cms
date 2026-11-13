// A12: the move action of a manually ordered type's list (spec §5.1, §4.6 api.move_entry).
import { isManuallyOrdered } from '@litljomi/cms-schema';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Answer = { data?: unknown; error?: { code?: string; message?: string } | null; status?: number };

const state = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  tables: {} as Record<string, Answer>,
  rpc: {} as Record<string, Answer>,
  calls: [] as { name: string; args: unknown }[],
  queries: [] as { table: string; filters: [string, unknown][] }[],
}));

const fake = {
  auth: { getUser: async () => ({ data: { user: state.user }, error: state.user ? null : { name: 'AuthSessionMissingError' } }) },
  from(table: string) {
    const query = { table, filters: [] as [string, unknown][] };
    state.queries.push(query);
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => (query.filters.push([column, value]), chain),
      maybeSingle: async () => ({ data: null, error: null, ...state.tables[table] }),
    };
    return chain;
  },
  async rpc(name: string, args: unknown) {
    state.calls.push({ name, args });
    return { data: null, error: null, status: 200, ...state.rpc[name] };
  },
};
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createEditorClient: vi.fn(async () => fake) }));

const { moveEntryAction } = await import('../order-actions');

const ENTRY = '00000000-0000-4000-8000-0000000000e1';
const TARGET = '00000000-0000-4000-8000-0000000000e2';
const TENANT_ID = '00000000-0000-4000-8000-0000000000f1';
// Module and type names come from the registry, not from this test (no slug literals in core).
const registry = await import('@/modules/registry');
const manualModule = registry.modules.find((m) => m.types.some((t) => isManuallyOrdered(t)))!;
const MANUAL = manualModule.types.find((t) => isManuallyOrdered(t))!;
const OTHER = manualModule.types.find((t) => !isManuallyOrdered(t))!;

beforeEach(() => {
  state.user = { id: 'u1' };
  state.calls = [];
  state.queries = [];
  state.tables = {
    entry_list: { data: { id: ENTRY, tenant_id: TENANT_ID, type: MANUAL.name, slug: null } },
    my_tenants: { data: { id: TENANT_ID, slug: manualModule.tenant, status: 'active' } },
  };
  state.rpc = { move_entry: { data: null } };
});

describe('moveEntryAction', () => {
  it("moves with the editor's session; the tenant and type come from the entry, never the caller", async () => {
    await expect(moveEntryAction(ENTRY, TARGET, 'before')).resolves.toEqual({ ok: true });
    expect(state.queries).toEqual([
      { table: 'entry_list', filters: [['id', ENTRY]] },
      { table: 'my_tenants', filters: [['id', TENANT_ID]] },
    ]);
    expect(state.calls).toEqual([{ name: 'move_entry', args: { p_entry_id: ENTRY, p_target_id: TARGET, p_place: 'before' } }]);
    await expect(moveEntryAction(ENTRY, TARGET, 'after')).resolves.toEqual({ ok: true });
    expect(state.calls[1]).toEqual({ name: 'move_entry', args: { p_entry_id: ENTRY, p_target_id: TARGET, p_place: 'after' } });
  });

  it.each([
    ['an entry id that is not a uuid', 'x', TARGET, 'before'],
    ['a target id that is not a uuid', ENTRY, 'x', 'after'],
    ['a place other than before or after', ENTRY, TARGET, 'above'],
    ['the entry as its own target', ENTRY, ENTRY, 'before'],
    ['a non-string', 1 as unknown as string, TARGET, 'before'],
  ])('refuses %s without calling anything', async (_name, entry, target, place) => {
    await expect(moveEntryAction(entry, target, place as 'before')).resolves.toEqual({ ok: false, code: 'invalid' });
    expect(state.queries).toEqual([]);
    expect(state.calls).toEqual([]);
  });

  it('needs a session', async () => {
    state.user = null;
    await expect(moveEntryAction(ENTRY, TARGET, 'before')).resolves.toEqual({ ok: false, code: 'auth' });
    expect(state.calls).toEqual([]);
  });

  it("refuses an entry the editor cannot see, of an inactive tenant, or of a type that is not ordered by hand", async () => {
    state.tables.entry_list = { data: null };
    await expect(moveEntryAction(ENTRY, TARGET, 'before')).resolves.toEqual({ ok: false, code: 'error' });
    state.tables.entry_list = { data: { id: ENTRY, tenant_id: TENANT_ID, type: MANUAL.name, slug: null } };
    state.tables.my_tenants = { data: { id: TENANT_ID, slug: manualModule.tenant, status: 'suspended' } };
    await expect(moveEntryAction(ENTRY, TARGET, 'before')).resolves.toEqual({ ok: false, code: 'error' });
    state.tables.my_tenants = { data: { id: TENANT_ID, slug: manualModule.tenant, status: 'active' } };
    state.tables.entry_list = { data: { id: ENTRY, tenant_id: TENANT_ID, type: OTHER.name, slug: null } };
    await expect(moveEntryAction(ENTRY, TARGET, 'before')).resolves.toEqual({ ok: false, code: 'error' });
    expect(state.calls).toEqual([]);
  });

  it('maps the function\'s refusals: tenant_inactive, an expired session, and everything else as the generic error', async () => {
    state.rpc.move_entry = { error: { code: 'P0001', message: 'tenant_inactive' } };
    await expect(moveEntryAction(ENTRY, TARGET, 'before')).resolves.toEqual({ ok: false, code: 'tenant_inactive' });
    state.rpc.move_entry = { error: { code: 'PGRST301', message: 'JWT expired' }, status: 401 };
    await expect(moveEntryAction(ENTRY, TARGET, 'before')).resolves.toEqual({ ok: false, code: 'auth' });
    for (const message of ['not_found', 'forbidden']) {
      state.rpc.move_entry = { error: { code: 'P0001', message } };
      await expect(moveEntryAction(ENTRY, TARGET, 'before')).resolves.toEqual({ ok: false, code: 'error' });
    }
    state.rpc.move_entry = { error: { code: '23514', message: 'new row violates check constraint' } };
    await expect(moveEntryAction(ENTRY, TARGET, 'before')).resolves.toEqual({ ok: false, code: 'error' });
  });

  it('never throws: a failing read is the generic error', async () => {
    state.tables.entry_list = { error: { code: '57014', message: 'canceling statement' } };
    await expect(moveEntryAction(ENTRY, TARGET, 'before')).resolves.toEqual({ ok: false, code: 'error' });
  });
});
