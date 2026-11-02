import { beforeEach, describe, expect, it, vi } from 'vitest';

type Answer = { data?: unknown; error?: { code?: string; message?: string } | null; status?: number };

const state = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  tables: {} as Record<string, Answer>,
  rpc: {} as Record<string, Answer>,
  calls: [] as { name: string; args: unknown }[],
  queries: [] as { table: string; filters: [string, unknown][] }[],
  after: [] as (() => unknown)[],
  triggered: [] as string[],
  trigger: (async () => undefined) as (id: string) => Promise<void>,
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
vi.mock('next/server', () => ({ after: (fn: () => unknown) => void state.after.push(fn) }));
vi.mock('@/lib/worker-trigger', () => ({
  triggerWorker: async (id: string) => {
    state.triggered.push(id);
    await state.trigger(id);
  },
}));

const { requestPublishAction, requestUnpublishAction } = await import('../publish-actions');

const ENTRY = '00000000-0000-4000-8000-0000000000e1';
const REQUEST = '00000000-0000-4000-8000-0000000000d1';
const TENANT_ID = '00000000-0000-4000-8000-0000000000f1';
// Module and type names come from the registry, not from this test (no slug literals in core).
const registry = await import('@/modules/registry');
const module_ = registry.modules[0]!;
const SLUG = module_.tenant;
const TYPE = module_.types[0]!;

beforeEach(() => {
  state.user = { id: 'u1' };
  state.calls = [];
  state.queries = [];
  state.after = [];
  state.triggered = [];
  state.trigger = async () => undefined;
  state.tables = {
    entry_list: { data: { id: ENTRY, tenant_id: TENANT_ID, type: TYPE.name } },
    my_tenants: { data: { id: TENANT_ID, slug: SLUG, status: 'active' } },
  };
  state.rpc = { request_publish: { data: REQUEST }, request_unpublish: { data: REQUEST } };
});

const runAfter = async () => {
  for (const fn of state.after) await fn();
};

describe('requestPublishAction', () => {
  it('requests publication with the editor\'s session at the version the editor saw, then triggers the worker after the response', async () => {
    await expect(requestPublishAction(ENTRY, 7)).resolves.toEqual({ requestId: REQUEST });
    // The tenant comes from the entry (entry_list) and api.my_tenants, never from the caller.
    expect(state.queries).toEqual([
      { table: 'entry_list', filters: [['id', ENTRY]] },
      { table: 'my_tenants', filters: [['id', TENANT_ID]] },
    ]);
    expect(state.calls).toEqual([{ name: 'request_publish', args: { p_entry_id: ENTRY, p_expected_draft_version: 7 } }]);
    // Only the request ID goes to the worker, and only after the response (decision 9).
    expect(state.triggered).toEqual([]);
    expect(state.after).toHaveLength(1);
    await runAfter();
    expect(state.triggered).toEqual([REQUEST]);
  });

  it('a failed trigger is logged, not thrown (the sweep picks the request up)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    state.trigger = async () => {
      throw new Error('worker trigger failed: HTTP 401');
    };
    await expect(requestPublishAction(ENTRY, 7)).resolves.toEqual({ requestId: REQUEST });
    await expect(runAfter()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[cms-worker]'), { requestId: REQUEST }, 'worker trigger failed: HTTP 401');
    log.mockRestore();
  });

  it('rejects malformed arguments before any database call', async () => {
    for (const [id, v] of [['not-a-uuid', 3], [ENTRY, 0], [ENTRY, 1.5], [ENTRY, 2 ** 31], [ENTRY, '3'], [ENTRY, null], [{}, 3], [null, 3]] as const) {
      await expect(requestPublishAction(id as string, v as number)).resolves.toEqual({ error: 'invalid' });
    }
    expect(state.queries).toEqual([]);
    expect(state.calls).toEqual([]);
    expect(state.after).toEqual([]);
  });

  it('without a session answers auth and calls nothing', async () => {
    state.user = null;
    await expect(requestPublishAction(ENTRY, 3)).resolves.toEqual({ error: 'auth' });
    expect(state.calls).toEqual([]);
  });

  it('refuses an entry that is not visible, of a type outside the module, or in a suspended tenant', async () => {
    state.tables.entry_list = { data: null };
    await expect(requestPublishAction(ENTRY, 3)).resolves.toEqual({ error: 'error' });
    state.tables.entry_list = { data: { id: ENTRY, tenant_id: TENANT_ID, type: 'nonexistent' } };
    await expect(requestPublishAction(ENTRY, 3)).resolves.toEqual({ error: 'error' });
    state.tables.entry_list = { data: { id: ENTRY, tenant_id: TENANT_ID, type: TYPE.name } };
    state.tables.my_tenants = { data: { id: TENANT_ID, slug: SLUG, status: 'suspended' } };
    await expect(requestPublishAction(ENTRY, 3)).resolves.toEqual({ error: 'error' });
    state.tables.my_tenants = { data: null };
    await expect(requestPublishAction(ENTRY, 3)).resolves.toEqual({ error: 'error' });
    expect(state.calls).toEqual([]);
    expect(state.after).toEqual([]);
  });

  it('maps version_conflict, tenant_inactive and auth; everything else is the generic error, never the message', async () => {
    const cases: [Answer, string][] = [
      [{ error: { code: 'P0001', message: 'version_conflict' } }, 'version_conflict'],
      [{ error: { code: 'P0001', message: 'tenant_inactive' } }, 'tenant_inactive'],
      [{ error: { code: 'PGRST303', message: 'JWT expired' }, status: 401 }, 'auth'],
      [{ error: { code: 'P0001', message: 'not_found' } }, 'error'],
      [{ error: { code: '42501', message: 'new row violates row-level security policy' } }, 'error'],
      [{ error: { code: '23503', message: 'fk' } }, 'error'],
      [{ data: 'not-a-uuid' }, 'error'],
      [{ data: null }, 'error'],
    ];
    for (const [answer, code] of cases) {
      state.rpc.request_publish = answer;
      await expect(requestPublishAction(ENTRY, 3)).resolves.toEqual({ error: code });
    }
    expect(state.after).toEqual([]);
  });

  it('a database error reading the entry is the generic error', async () => {
    state.tables.entry_list = { error: { code: 'XX000', message: 'boom' } };
    await expect(requestPublishAction(ENTRY, 3)).resolves.toEqual({ error: 'error' });
  });
});

describe('requestUnpublishAction', () => {
  it('requests withdrawal with the editor\'s session and triggers the worker after the response', async () => {
    await expect(requestUnpublishAction(ENTRY)).resolves.toEqual({ requestId: REQUEST });
    expect(state.calls).toEqual([{ name: 'request_unpublish', args: { p_entry_id: ENTRY } }]);
    await runAfter();
    expect(state.triggered).toEqual([REQUEST]);
  });

  it('rejects a malformed id, a missing session and an entry outside an active tenant', async () => {
    await expect(requestUnpublishAction('x')).resolves.toEqual({ error: 'invalid' });
    await expect(requestUnpublishAction(5 as unknown as string)).resolves.toEqual({ error: 'invalid' });
    state.user = null;
    await expect(requestUnpublishAction(ENTRY)).resolves.toEqual({ error: 'auth' });
    state.user = { id: 'u1' };
    state.tables.my_tenants = { data: { id: TENANT_ID, slug: SLUG, status: 'suspended' } };
    await expect(requestUnpublishAction(ENTRY)).resolves.toEqual({ error: 'error' });
    expect(state.calls).toEqual([]);
  });

  it('maps the database errors as publication does', async () => {
    state.rpc.request_unpublish = { error: { code: 'P0001', message: 'not_found' } };
    await expect(requestUnpublishAction(ENTRY)).resolves.toEqual({ error: 'error' });
    state.rpc.request_unpublish = { error: { code: 'PGRST301', message: 'JWT' }, status: 401 };
    await expect(requestUnpublishAction(ENTRY)).resolves.toEqual({ error: 'auth' });
    expect(state.after).toEqual([]);
  });
});
