// Restore from a revision (plan M2-16; spec §5.5): the editor's action reads the revision under the
// editor's own session from api.revision_list, filtered to the entry and its tenant, upcasts it to
// the type's current version and saves it as a normal versioned draft update. The module here is
// a test module (a type at version 3 with transforms 1 → 2 → 3), as in update-draft-schema.test.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineType, text } from '@litljomi/cms-schema';

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

const { restoreRevisionAction } = await import('../actions');

const ENTRY = '00000000-0000-4000-8000-0000000000e1';
const REVISION = '00000000-0000-4000-8000-0000000000d1';
const TENANT_ID = '00000000-0000-4000-8000-0000000000f1';

beforeEach(() => {
  state.user = { id: 'u1' };
  state.calls = [];
  state.queries = [];
  state.tables = {
    my_tenants: { data: { id: TENANT_ID, slug: SLUG, name: 'T', status: 'active' } },
    entry_list: { data: { id: ENTRY, tenant_id: TENANT_ID, type: TYPE.name } },
    revision_list: { data: { data: { heading: 'Lokað á morgun', body: 'Vegna veðurs', stray: 1 }, schema_version: 1 } },
  };
  state.rpc = { save_draft: { data: 6 } };
});

describe('restoreRevisionAction', () => {
  it("upcasts the revision's data and saves it into the draft at the type's version, expecting the editor's version", async () => {
    await expect(restoreRevisionAction(ENTRY, REVISION, 5)).resolves.toEqual({ ok: true, version: 6 });
    expect(state.calls).toEqual([
      {
        name: 'save_draft',
        args: {
          p_entry_id: ENTRY,
          p_expected_version: 5,
          p_data: { title: 'Lokað á morgun', body: 'Vegna veðurs' },
          p_schema_version: 3,
          p_title: 'Lokað á morgun',
          p_sort_at: null,
        },
      },
    ]);
  });

  it("reads the revision from revision_list with the editor's session, as a revision of this entry in its own tenant", async () => {
    await restoreRevisionAction(ENTRY, REVISION, 5);
    expect(state.queries.find((q) => q.table === 'revision_list')).toEqual({
      table: 'revision_list',
      filters: [
        ['id', REVISION],
        ['entry_id', ENTRY],
        ['tenant_id', TENANT_ID],
      ],
    });
  });

  it('a revision at the current version is saved as it is (minus unknown keys)', async () => {
    state.tables.revision_list = { data: { data: { title: 'Opið', stray: true }, schema_version: 3 } };
    await restoreRevisionAction(ENTRY, REVISION, 5);
    expect((state.calls[0]!.args as { p_data: unknown }).p_data).toEqual({ title: 'Opið' });
  });

  it('a draft that moved on since the editor loaded it is a version conflict from save_draft', async () => {
    state.rpc.save_draft = { error: { code: 'P0001', message: 'version_conflict' } };
    await expect(restoreRevisionAction(ENTRY, REVISION, 5)).resolves.toEqual({ ok: false, code: 'version_conflict' });
  });

  it('a failing transform or a revision newer than the type is upcast_failed; refused data is invalid; no save', async () => {
    state.tables.entry_list = { data: { id: ENTRY, tenant_id: TENANT_ID, type: BROKEN.name } };
    await expect(restoreRevisionAction(ENTRY, REVISION, 5)).resolves.toEqual({ ok: false, code: 'upcast_failed' });
    state.tables.entry_list = { data: { id: ENTRY, tenant_id: TENANT_ID, type: TYPE.name } };
    state.tables.revision_list = { data: { data: {}, schema_version: 4 } };
    await expect(restoreRevisionAction(ENTRY, REVISION, 5)).resolves.toEqual({ ok: false, code: 'upcast_failed' });
    state.tables.revision_list = { data: { data: { heading: 12345 }, schema_version: 1 } };
    await expect(restoreRevisionAction(ENTRY, REVISION, 5)).resolves.toEqual({ ok: false, code: 'invalid' });
    expect(state.calls).toEqual([]);
  });

  it('rejects a malformed entry id, revision id or version before any database call', async () => {
    for (const [id, rev, v] of [
      ['not-a-uuid', REVISION, 3],
      [ENTRY, 'not-a-uuid', 3],
      [ENTRY, REVISION, 0],
      [ENTRY, REVISION, 1.5],
      [ENTRY, REVISION, 2 ** 31],
      [ENTRY, {}, 3],
    ] as const) {
      await expect(restoreRevisionAction(id as string, rev as string, v as number)).resolves.toEqual({ ok: false, code: 'invalid' });
    }
    expect(state.queries).toEqual([]);
  });

  it('no session is auth, without a database read; an expired JWT on the save is auth', async () => {
    state.user = null;
    await expect(restoreRevisionAction(ENTRY, REVISION, 5)).resolves.toEqual({ ok: false, code: 'auth' });
    expect(state.queries).toEqual([]);
    state.user = { id: 'u1' };
    state.rpc.save_draft = { error: { code: 'PGRST303', message: 'JWT expired' }, status: 401 };
    await expect(restoreRevisionAction(ENTRY, REVISION, 5)).resolves.toEqual({ ok: false, code: 'auth' });
  });

  it("an entry the editor cannot see, a revision not visible or not this entry's, and a database error are the generic error", async () => {
    state.tables.entry_list = { data: null };
    await expect(restoreRevisionAction(ENTRY, REVISION, 5)).resolves.toEqual({ ok: false, code: 'error' });
    state.tables.entry_list = { data: { id: ENTRY, tenant_id: TENANT_ID, type: TYPE.name } };
    state.tables.revision_list = { data: null };
    await expect(restoreRevisionAction(ENTRY, REVISION, 5)).resolves.toEqual({ ok: false, code: 'error' });
    state.tables.revision_list = { error: { code: 'XX000', message: 'boom' } };
    const result = await restoreRevisionAction(ENTRY, REVISION, 5);
    expect(result).toEqual({ ok: false, code: 'error' });
    expect(JSON.stringify(result)).not.toContain('boom');
    expect(state.calls).toEqual([]);
  });
});
