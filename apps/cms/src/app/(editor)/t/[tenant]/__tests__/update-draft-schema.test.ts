// The outdated-draft update (plan M2-14; spec §5.3): the editor's action reads the draft under the
// editor's own session, upcasts it to the type's current version and saves it as a normal
// versioned draft update. The module here is a test module (a type at version 3 with transforms
// 1 → 2 → 3), so the test does not depend on a tenant module's current versions.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineType, text } from '@litljomi/cms-schema';

type Answer = { data?: unknown; error?: { code?: string; message?: string } | null; status?: number };

const state = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  tables: {} as Record<string, Answer>,
  rpc: {} as Record<string, Answer>,
  calls: [] as { name: string; args: unknown }[],
  reads: [] as { name: string; args: unknown }[],
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
    (name.endsWith('_by_id') ? state.reads : state.calls).push({ name, args });
    return { data: null, error: null, status: 200, ...state.rpc[name] };
  },
};
vi.mock('@/lib/supabase/server', () => ({ createEditorClient: vi.fn(async () => fake) }));

const SLUG = 'acme';
const TYPE = defineType({
  name: 'sign',
  version: 3,
  label: 'Sign',
  fields: {
    title: text({ label: 'Title', required: true }),
    body: text({ label: 'Body', multiline: true }),
  },
  preview: { title: 'title' },
  orderBy: 'title',
  transforms: {
    1: (data) => {
      const { heading, ...rest } = data as Record<string, unknown>;
      return { ...rest, name: heading };
    },
    2: (data) => {
      const { name, ...rest } = data as Record<string, unknown>;
      return { ...rest, title: name };
    },
  },
});
const BROKEN = defineType({
  name: 'broken',
  version: 2,
  label: 'Broken',
  fields: { title: text({ label: 'Title' }) },
  preview: { title: 'title' },
  orderBy: 'title',
  transforms: {
    1: () => {
      throw new Error('cannot');
    },
  },
});
vi.mock('@/modules/registry', () => ({
  getType: (slug: string, type: string) => (slug === SLUG ? [TYPE, BROKEN].find((x) => x.name === type) : undefined),
}));

const { updateDraftSchemaAction } = await import('../actions');

const ENTRY = '00000000-0000-4000-8000-0000000000e1';
const TENANT_ID = '00000000-0000-4000-8000-0000000000f1';

beforeEach(() => {
  state.user = { id: 'u1' };
  state.calls = [];
  state.reads = [];
  state.queries = [];
  state.tables = {
    my_tenants: { data: { id: TENANT_ID, slug: SLUG, name: 'T', status: 'active' } },
    entry_list: { data: { id: ENTRY, tenant_id: TENANT_ID, type: TYPE.name } },
  };
  state.rpc = {
    save_draft: { data: 6 },
    entry_detail_by_id: { data: { tenant_id: TENANT_ID, data: { heading: 'Lokað á morgun', body: 'Vegna veðurs', stray: 1 }, schema_version: 1, draft_version: 5 } },
  };
});

describe('updateDraftSchemaAction', () => {
  it("upcasts the stored draft through every transform and saves it at the type's version, expecting the editor's version", async () => {
    await expect(updateDraftSchemaAction(ENTRY, 5)).resolves.toEqual({ ok: true, version: 6 });
    expect(state.calls).toEqual([
      {
        name: 'save_draft',
        args: {
          p_entry_id: ENTRY,
          p_expected_version: 5,
          // Unknown keys are stripped on save (§5.3) by the type's draft validator.
          p_data: { title: 'Lokað á morgun', body: 'Vegna veðurs' },
          p_schema_version: 3,
          p_title: 'Lokað á morgun',
          // Ordered by a text field: no sort_at (a timestamp column).
          p_sort_at: null,
        },
      },
    ]);
  });

  it("reads the draft by id with the editor's session, and refuses a row of another tenant", async () => {
    await updateDraftSchemaAction(ENTRY, 5);
    expect(state.reads).toEqual([{ name: 'entry_detail_by_id', args: { p_entry_id: ENTRY } }]);
    state.calls = [];
    state.rpc.entry_detail_by_id = { data: { tenant_id: 'another', data: {}, schema_version: 1, draft_version: 5 } };
    await expect(updateDraftSchemaAction(ENTRY, 5)).resolves.toEqual({ ok: false, code: 'error' });
    expect(state.calls).toEqual([]);
  });

  it('upcasts from an intermediate version too', async () => {
    state.rpc.entry_detail_by_id = { data: { tenant_id: TENANT_ID, data: { name: 'Opið' }, schema_version: 2, draft_version: 5 } };
    await updateDraftSchemaAction(ENTRY, 5);
    expect((state.calls[0]!.args as { p_data: unknown }).p_data).toEqual({ title: 'Opið' });
  });

  it('a draft already at the current version (updated in another tab) is not saved again', async () => {
    state.rpc.entry_detail_by_id = { data: { tenant_id: TENANT_ID, data: { title: 'x' }, schema_version: 3, draft_version: 5 } };
    await expect(updateDraftSchemaAction(ENTRY, 5)).resolves.toEqual({ ok: true, version: 5 });
    expect(state.calls).toEqual([]);
  });

  it('a draft that moved on since the editor loaded it is a version conflict, without a save', async () => {
    state.rpc.entry_detail_by_id = { data: { tenant_id: TENANT_ID, data: { heading: 'x' }, schema_version: 1, draft_version: 7 } };
    await expect(updateDraftSchemaAction(ENTRY, 5)).resolves.toEqual({ ok: false, code: 'version_conflict' });
    expect(state.calls).toEqual([]);
    // And one that moves on between the read and the save is refused by save_draft.
    state.rpc.entry_detail_by_id = { data: { tenant_id: TENANT_ID, data: { heading: 'x' }, schema_version: 1, draft_version: 5 } };
    state.rpc.save_draft = { error: { code: 'P0001', message: 'version_conflict' } };
    await expect(updateDraftSchemaAction(ENTRY, 5)).resolves.toEqual({ ok: false, code: 'version_conflict' });
  });

  it('a failing transform, a gap or a draft newer than the type is upcast_failed, without a save', async () => {
    state.tables.entry_list = { data: { id: ENTRY, tenant_id: TENANT_ID, type: BROKEN.name } };
    await expect(updateDraftSchemaAction(ENTRY, 5)).resolves.toEqual({ ok: false, code: 'upcast_failed' });
    state.tables.entry_list = { data: { id: ENTRY, tenant_id: TENANT_ID, type: TYPE.name } };
    state.rpc.entry_detail_by_id = { data: { tenant_id: TENANT_ID, data: {}, schema_version: 4, draft_version: 5 } };
    await expect(updateDraftSchemaAction(ENTRY, 5)).resolves.toEqual({ ok: false, code: 'upcast_failed' });
    expect(state.calls).toEqual([]);
  });

  it('upcast data the draft validator refuses is invalid, without a save', async () => {
    state.rpc.entry_detail_by_id = { data: { tenant_id: TENANT_ID, data: { heading: 12345 }, schema_version: 1, draft_version: 5 } };
    const result = await updateDraftSchemaAction(ENTRY, 5);
    expect(result).toEqual({ ok: false, code: 'invalid' });
    expect(state.calls).toEqual([]);
  });

  it('rejects a malformed entry id or version before any database call', async () => {
    for (const [id, v] of [['not-a-uuid', 3], [ENTRY, 0], [ENTRY, 1.5], [ENTRY, 2 ** 31], [ENTRY, '3'], [{}, 3]] as const) {
      await expect(updateDraftSchemaAction(id as string, v as number)).resolves.toEqual({ ok: false, code: 'invalid' });
    }
    expect(state.queries).toEqual([]);
  });

  it('no session is auth, without a database read; an expired JWT on the save is auth', async () => {
    state.user = null;
    await expect(updateDraftSchemaAction(ENTRY, 5)).resolves.toEqual({ ok: false, code: 'auth' });
    expect(state.queries).toEqual([]);
    state.user = { id: 'u1' };
    state.rpc.save_draft = { error: { code: 'PGRST303', message: 'JWT expired' }, status: 401 };
    await expect(updateDraftSchemaAction(ENTRY, 5)).resolves.toEqual({ ok: false, code: 'auth' });
  });

  it('an entry the editor cannot see, a missing draft row, a database error and an integrity error are the generic error', async () => {
    state.tables.entry_list = { data: null };
    await expect(updateDraftSchemaAction(ENTRY, 5)).resolves.toEqual({ ok: false, code: 'error' });
    state.tables.entry_list = { data: { id: ENTRY, tenant_id: TENANT_ID, type: TYPE.name } };
    state.rpc.entry_detail_by_id = { data: null };
    await expect(updateDraftSchemaAction(ENTRY, 5)).resolves.toEqual({ ok: false, code: 'error' });
    state.rpc.entry_detail_by_id = { error: { code: 'XX000', message: 'boom' } };
    await expect(updateDraftSchemaAction(ENTRY, 5)).resolves.toEqual({ ok: false, code: 'error' });
    expect(state.calls).toEqual([]);
    state.rpc.entry_detail_by_id = { data: { tenant_id: TENANT_ID, data: { heading: 'x' }, schema_version: 1, draft_version: 5 } };
    state.rpc.save_draft = { error: { code: '23514', message: 'new row violates check constraint' } };
    const result = await updateDraftSchemaAction(ENTRY, 5);
    expect(result).toEqual({ ok: false, code: 'error' });
    expect(JSON.stringify(result)).not.toContain('constraint');
  });
});
