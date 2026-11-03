import { beforeEach, describe, expect, it, vi } from 'vitest';

type Answer = { data?: unknown; error?: { code?: string; message?: string } | null };

const state = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  tenant: null as Answer | null,
  list: null as Answer | null,
  queries: [] as { table: string; columns: string; calls: [string, ...unknown[]][] }[],
}));

const fake = {
  auth: { getUser: async () => ({ data: { user: state.user }, error: state.user ? null : { name: 'AuthSessionMissingError' } }) },
  from(table: string) {
    const query = { table, columns: '', calls: [] as [string, ...unknown[]][] };
    state.queries.push(query);
    const answer = () => ({ data: null, error: null, ...(table === 'my_tenants' ? state.tenant : state.list) });
    const chain = {
      select: (columns: string) => ((query.columns = columns), chain),
      eq: (...a: unknown[]) => (query.calls.push(['eq', ...a]), chain),
      in: (...a: unknown[]) => (query.calls.push(['in', ...a]), chain),
      is: (...a: unknown[]) => (query.calls.push(['is', ...a]), chain),
      order: (...a: unknown[]) => (query.calls.push(['order', ...a]), chain),
      limit: async (...a: unknown[]) => (query.calls.push(['limit', ...a]), answer()),
      maybeSingle: async () => answer(),
    };
    return chain;
  },
};
vi.mock('@/lib/supabase/server', () => ({ createEditorClient: vi.fn(async () => fake) }));

const { referenceOptionsAction } = await import('../reference-actions');
const { MAX_REFERENCE_OPTIONS } = await import('@/editor/server/reference-options');

const TENANT_ID = '00000000-0000-4000-8000-0000000000f1';
const SLUG = 'acme';
const row = (n: number) => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, type: 'event', title: `Viðburður ${n}`, status: 'published' });

beforeEach(() => {
  state.user = { id: 'u1' };
  state.queries = [];
  state.tenant = { data: { id: TENANT_ID, slug: SLUG, name: 'Acme', status: 'active' } };
  state.list = { data: [row(1), { ...row(2), title: null, status: 'draft' }] };
});

describe('referenceOptionsAction', () => {
  it('lists the entries of the allowed types in the tenant from api.my_tenants, archived left out, by title', async () => {
    await expect(referenceOptionsAction(SLUG, ['event', 'news'])).resolves.toEqual({
      ok: true,
      options: [row(1), { ...row(2), title: null, status: 'draft' }],
      truncated: false,
    });
    expect(state.queries.map((q) => q.table)).toEqual(['my_tenants', 'entry_list']);
    expect(state.queries[1]).toEqual({
      table: 'entry_list',
      columns: 'id, type, title, status',
      calls: [
        ['eq', 'tenant_id', TENANT_ID],
        ['in', 'type', ['event', 'news']],
        ['is', 'archived_at', null],
        ['order', 'title', { ascending: true, nullsFirst: false }],
        ['order', 'id', { ascending: true }],
        ['limit', MAX_REFERENCE_OPTIONS + 1],
      ],
    });
  });

  it('returns at most the limit and says when there were more', async () => {
    state.list = { data: Array.from({ length: MAX_REFERENCE_OPTIONS + 1 }, (_, i) => row(i)) };
    const result = await referenceOptionsAction(SLUG, ['event']);
    expect(result.ok && result.options.length).toBe(MAX_REFERENCE_OPTIONS);
    expect(result.ok && result.truncated).toBe(true);
  });

  it('lists nothing for a tenant the editor is not a member of, or one that is suspended', async () => {
    state.tenant = { data: null };
    await expect(referenceOptionsAction(SLUG, ['event'])).resolves.toEqual({ ok: false, code: 'invalid' });
    state.tenant = { data: { id: TENANT_ID, slug: SLUG, name: 'Acme', status: 'suspended' } };
    await expect(referenceOptionsAction(SLUG, ['event'])).resolves.toEqual({ ok: false, code: 'invalid' });
    expect(state.queries.map((q) => q.table)).toEqual(['my_tenants', 'my_tenants']);
  });

  it('answers auth without a session and reads nothing', async () => {
    state.user = null;
    await expect(referenceOptionsAction(SLUG, ['event'])).resolves.toEqual({ ok: false, code: 'auth' });
    expect(state.queries).toEqual([]);
  });

  it('maps a database error to the generic error, never its message', async () => {
    state.list = { data: null, error: { code: '42501', message: 'permission denied for view entry_list' } };
    await expect(referenceOptionsAction(SLUG, ['event'])).resolves.toEqual({ ok: false, code: 'error' });
  });

  it.each([
    ['no types', SLUG, []],
    ['a type that is not a kebab name', SLUG, ['Event']],
    ['a type that is not a string', SLUG, [7]],
    ['types that are not an array', SLUG, 'event'],
    ['too many types', SLUG, Array.from({ length: 21 }, (_, i) => `t${i}`)],
    ['a tenant slug that is not a string', {}, ['event']],
  ])('rejects %s before reading anything', async (_name, slug, types) => {
    await expect(referenceOptionsAction(slug as string, types as string[])).resolves.toEqual({ ok: false, code: 'invalid' });
    expect(state.queries).toEqual([]);
  });
});
