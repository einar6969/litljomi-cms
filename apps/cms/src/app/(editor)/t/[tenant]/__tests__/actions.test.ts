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
vi.mock('@/lib/supabase/server', () => ({ createEditorClient: vi.fn(async () => fake) }));

const { createEntryAction, openSingletonAction, saveDraftAction, setSlugAction } = await import('../actions');

const ENTRY = '00000000-0000-4000-8000-0000000000e1';
const TENANT_ID = '00000000-0000-4000-8000-0000000000f1';
// Module and type names come from the registry, not from this test (no slug literals in core).
const registry = await import('@/modules/registry');
const module_ = registry.modules[0]!;
const SLUG = module_.tenant;
const TYPE = module_.types[0]!;
// A module that declares a singleton type (M2-09), found through the registry.
const { isSingleton } = await import('@litljomi/cms-schema');
const singletonModule = registry.modules.find((m) => m.types.some((t) => isSingleton(m, t.name)))!;
const SINGLETON = singletonModule.types.find((t) => isSingleton(singletonModule, t.name))!;
const ORDINARY = singletonModule.types.find((t) => !isSingleton(singletonModule, t.name))!;

beforeEach(() => {
  state.user = { id: 'u1' };
  state.calls = [];
  state.queries = [];
  state.tables = {
    my_tenants: { data: { id: TENANT_ID, slug: SLUG, name: 'T', status: 'active' } },
    entry_list: { data: { id: ENTRY, tenant_id: TENANT_ID, type: TYPE.name } },
  };
  state.rpc = { save_draft: { data: 4 }, set_slug: {}, create_entry: { data: ENTRY } };
});

describe('createEntryAction', () => {
  it('creates the entry in the tenant named only through my_tenants, at the type\'s version', async () => {
    await expect(createEntryAction(SLUG, TYPE.name)).resolves.toEqual({ entryId: ENTRY });
    expect(state.queries[0]).toEqual({ table: 'my_tenants', filters: [['slug', SLUG]] });
    expect(state.calls).toEqual([{ name: 'create_entry', args: { p_tenant_id: TENANT_ID, p_type: TYPE.name, p_slug: null, p_schema_version: TYPE.version } }]);
  });

  it('rejects a type that is not in the tenant\'s module, without calling the database', async () => {
    await expect(createEntryAction(SLUG, 'nonexistent')).rejects.toThrow();
    await expect(createEntryAction(SLUG, 'x'.repeat(500))).rejects.toThrow();
    expect(state.calls).toEqual([]);
  });

  it('rejects a tenant the editor is not a member of, and a suspended one', async () => {
    state.tables.my_tenants = { data: null };
    await expect(createEntryAction(SLUG, TYPE.name)).rejects.toThrow();
    state.tables.my_tenants = { data: { id: TENANT_ID, slug: SLUG, name: 'T', status: 'suspended' } };
    await expect(createEntryAction(SLUG, TYPE.name)).rejects.toThrow();
    expect(state.calls).toEqual([]);
  });

  it('rejects arguments that are not strings', async () => {
    await expect(createEntryAction({} as unknown as string, TYPE.name)).rejects.toThrow();
    await expect(createEntryAction(SLUG, 7 as unknown as string)).rejects.toThrow();
  });
});

describe('createEntryAction and singletons (M2-09)', () => {
  it('refuses a singleton type without calling the database: it is opened, never created as a new entry', async () => {
    state.tables.my_tenants = { data: { id: TENANT_ID, slug: singletonModule.tenant, name: 'T', status: 'active' } };
    await expect(createEntryAction(singletonModule.tenant, SINGLETON.name)).rejects.toThrow();
    expect(state.calls).toEqual([]);
  });
});

describe('openSingletonAction (M2-09)', () => {
  beforeEach(() => {
    state.tables.my_tenants = { data: { id: TENANT_ID, slug: singletonModule.tenant, name: 'T', status: 'active' } };
    state.rpc.create_singleton_entry = { data: ENTRY };
  });

  it('opens the singleton type in the tenant named only through my_tenants, at the type\'s version', async () => {
    await expect(openSingletonAction(singletonModule.tenant, SINGLETON.name)).resolves.toEqual({ ok: true, entryId: ENTRY });
    expect(state.queries[0]).toEqual({ table: 'my_tenants', filters: [['slug', singletonModule.tenant]] });
    expect(state.calls).toEqual([
      { name: 'create_singleton_entry', args: { p_tenant_id: TENANT_ID, p_type: SINGLETON.name, p_schema_version: SINGLETON.version } },
    ]);
  });

  it('refuses a type that is not a singleton, not in the module, or an invalid argument, without calling the database', async () => {
    await expect(openSingletonAction(singletonModule.tenant, ORDINARY.name)).resolves.toEqual({ ok: false, code: 'error' });
    await expect(openSingletonAction(singletonModule.tenant, 'nonexistent')).resolves.toEqual({ ok: false, code: 'error' });
    await expect(openSingletonAction(singletonModule.tenant, 'x'.repeat(500))).resolves.toEqual({ ok: false, code: 'error' });
    await expect(openSingletonAction({} as unknown as string, SINGLETON.name)).resolves.toEqual({ ok: false, code: 'error' });
    expect(state.calls).toEqual([]);
  });

  it('refuses a tenant the editor is not a member of, and a suspended one', async () => {
    state.tables.my_tenants = { data: null };
    await expect(openSingletonAction(singletonModule.tenant, SINGLETON.name)).resolves.toEqual({ ok: false, code: 'error' });
    state.tables.my_tenants = { data: { id: TENANT_ID, slug: singletonModule.tenant, name: 'T', status: 'suspended' } };
    await expect(openSingletonAction(singletonModule.tenant, SINGLETON.name)).resolves.toEqual({ ok: false, code: 'error' });
    expect(state.calls).toEqual([]);
  });

  it('maps no session and an expired JWT to auth, and every database error to the generic error', async () => {
    state.user = null;
    await expect(openSingletonAction(singletonModule.tenant, SINGLETON.name)).resolves.toEqual({ ok: false, code: 'auth' });
    expect(state.calls).toEqual([]);
    state.user = { id: 'u1' };
    state.rpc.create_singleton_entry = { error: { code: 'PGRST303', message: 'JWT expired' }, status: 401 };
    await expect(openSingletonAction(singletonModule.tenant, SINGLETON.name)).resolves.toEqual({ ok: false, code: 'auth' });
    for (const error of [{ code: 'P0001', message: 'singleton_mismatch' }, { code: 'P0001', message: 'not_found' }, { code: '23505', message: 'dup' }]) {
      state.rpc.create_singleton_entry = { error };
      await expect(openSingletonAction(singletonModule.tenant, SINGLETON.name)).resolves.toEqual({ ok: false, code: 'error' });
    }
    state.rpc.create_singleton_entry = { data: null };
    await expect(openSingletonAction(singletonModule.tenant, SINGLETON.name)).resolves.toEqual({ ok: false, code: 'error' });
  });
});

describe('saveDraftAction', () => {
  const title = Object.entries(TYPE.fields).find(([, f]) => (f as { kind: string }).kind === 'text')![0];

  it('validates, strips unknown keys, computes the query columns and saves at the type\'s version', async () => {
    const data = { [title]: 'Brauð ársins 2025', notAField: 'x', __proto__x: 1 };
    await expect(saveDraftAction(ENTRY, 3, data)).resolves.toEqual({ ok: true, version: 4 });
    const [call] = state.calls;
    expect(call!.name).toBe('save_draft');
    const args = call!.args as Record<string, unknown>;
    expect(args).toMatchObject({ p_entry_id: ENTRY, p_expected_version: 3, p_schema_version: TYPE.version });
    expect(args.p_data).toEqual({ [title]: 'Brauð ársins 2025' });
    expect(args.p_title).toBe(TYPE.queryColumns({ [title]: 'Brauð ársins 2025' }).title);
  });

  it('answers invalid, with paths and messages but no values, and does not call save_draft', async () => {
    const result = await saveDraftAction(ENTRY, 3, { [title]: 12345 });
    expect(result).toMatchObject({ ok: false, code: 'invalid' });
    expect(JSON.stringify(result)).not.toContain('12345');
    await expect(saveDraftAction(ENTRY, 3, null)).resolves.toMatchObject({ code: 'invalid' });
    await expect(saveDraftAction(ENTRY, 3, [1])).resolves.toMatchObject({ code: 'invalid' });
    expect(state.calls).toEqual([]);
  });

  it('rejects a malformed entry id or version before any database call', async () => {
    for (const [id, v] of [['not-a-uuid', 3], [ENTRY, 0], [ENTRY, 1.5], [ENTRY, 2 ** 31], [ENTRY, '3'], [{}, 3]] as const) {
      await expect(saveDraftAction(id as string, v as number, {})).resolves.toMatchObject({ ok: false, code: 'invalid' });
    }
    expect(state.queries).toEqual([]);
  });

  it('maps version_conflict', async () => {
    state.rpc.save_draft = { error: { code: 'P0001', message: 'version_conflict' } };
    await expect(saveDraftAction(ENTRY, 3, {})).resolves.toEqual({ ok: false, code: 'version_conflict' });
  });

  it('review focus 1: no session, an expired JWT and a 401 are auth', async () => {
    state.user = null;
    await expect(saveDraftAction(ENTRY, 3, {})).resolves.toEqual({ ok: false, code: 'auth' });
    expect(state.calls).toEqual([]);
    state.user = { id: 'u1' };
    state.rpc.save_draft = { error: { code: 'PGRST303', message: 'JWT expired' }, status: 401 };
    await expect(saveDraftAction(ENTRY, 3, {})).resolves.toEqual({ ok: false, code: 'auth' });
    state.rpc.save_draft = { error: { code: '42501', message: 'permission denied' }, status: 401 };
    await expect(saveDraftAction(ENTRY, 3, {})).resolves.toEqual({ ok: false, code: 'auth' });
  });

  it('maps integrity SQLSTATEs, not_found and a thrown error to the generic error, never echoing the message', async () => {
    for (const error of [
      { code: '23514', message: 'new row violates check constraint "drafts_data_object"' },
      { code: '23503', message: 'fk' },
      { code: '22P02', message: 'bad ref' },
      { code: '54000', message: 'too many references' },
      { code: 'P0001', message: 'not_found' },
      { code: 'P0001', message: 'forbidden' },
    ]) {
      state.rpc.save_draft = { error };
      const result = await saveDraftAction(ENTRY, 3, {});
      expect(result).toEqual({ ok: false, code: 'error' });
    }
    state.rpc.save_draft = {};
    state.tables.entry_list = { error: { code: 'XX000' } };
    await expect(saveDraftAction(ENTRY, 3, {})).resolves.toEqual({ ok: false, code: 'error' });
  });

  it('rejects an entry that is not visible, in a suspended tenant, or of a type outside the module', async () => {
    state.tables.entry_list = { data: null };
    await expect(saveDraftAction(ENTRY, 3, {})).resolves.toEqual({ ok: false, code: 'error' });
    state.tables.entry_list = { data: { id: ENTRY, tenant_id: TENANT_ID, type: 'nonexistent' } };
    await expect(saveDraftAction(ENTRY, 3, {})).resolves.toEqual({ ok: false, code: 'error' });
    state.tables.entry_list = { data: { id: ENTRY, tenant_id: TENANT_ID, type: TYPE.name } };
    state.tables.my_tenants = { data: { id: TENANT_ID, slug: SLUG, name: 'T', status: 'suspended' } };
    await expect(saveDraftAction(ENTRY, 3, {})).resolves.toEqual({ ok: false, code: 'error' });
    expect(state.calls).toEqual([]);
  });

  it('keeps an unedited image value unchanged', async () => {
    const image = Object.entries(TYPE.fields).find(([, f]) => (f as { kind: string }).kind === 'image')![0];
    const value = { _ref: '00000000-0000-4000-8000-0000000000a1', _kind: 'asset', alt: 'Brauð' };
    await saveDraftAction(ENTRY, 3, { [image]: value });
    expect((state.calls[0]!.args as { p_data: Record<string, unknown> }).p_data[image]).toEqual(value);
  });
});

describe('setSlugAction', () => {
  it('sets a valid slug', async () => {
    await expect(setSlugAction(ENTRY, 'braud-arsins-2025')).resolves.toEqual({ ok: true, slug: 'braud-arsins-2025' });
    expect(state.calls).toEqual([{ name: 'set_slug', args: { p_entry_id: ENTRY, p_slug: 'braud-arsins-2025' } }]);
  });

  it('rejects malformed slugs and ids without a database call', async () => {
    for (const slug of ['', 'Braud', 'braud arsins', '-a', 'a--b', 'brauð', 'a'.repeat(201), '../x']) {
      await expect(setSlugAction(ENTRY, slug)).resolves.toEqual({ ok: false, code: 'invalid' });
    }
    await expect(setSlugAction('x', 'ok')).resolves.toEqual({ ok: false, code: 'invalid' });
    await expect(setSlugAction(ENTRY, 5 as unknown as string)).resolves.toEqual({ ok: false, code: 'invalid' });
    expect(state.calls).toEqual([]);
  });

  it('maps slug_taken, slug_locked, auth and the rest', async () => {
    state.rpc.set_slug = { error: { code: 'P0001', message: 'slug_taken' } };
    await expect(setSlugAction(ENTRY, 'a')).resolves.toEqual({ ok: false, code: 'slug_taken' });
    state.rpc.set_slug = { error: { code: 'P0001', message: 'slug_locked' } };
    await expect(setSlugAction(ENTRY, 'a')).resolves.toEqual({ ok: false, code: 'slug_locked' });
    state.rpc.set_slug = { error: { code: '23514', message: 'check' } };
    await expect(setSlugAction(ENTRY, 'a')).resolves.toEqual({ ok: false, code: 'error' });
    state.user = null;
    await expect(setSlugAction(ENTRY, 'a')).resolves.toEqual({ ok: false, code: 'auth' });
  });
});
