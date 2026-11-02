import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '../supabase/types';

const editor = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('../supabase/server', () => ({ createEditorClient: vi.fn(async () => editor.client) }));

const { createEditorClient } = await import('../supabase/server');
const { currentTenant, listMyTenants, resolveTenant } = await import('../tenant');

const TENANT = { id: '00000000-0000-4000-8000-0000000000f1', slug: 'acme', name: 'Acme', status: 'active' };

/** A fake editor client whose `my_tenants` query answers `result`, recording the query. */
function fakeClient(result: { data: unknown; error: unknown }) {
  const calls: Array<[string, ...unknown[]]> = [];
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order']) {
    query[method] = vi.fn((...args: unknown[]) => {
      calls.push([method, ...args]);
      return query;
    });
  }
  query.maybeSingle = vi.fn(async () => result);
  query.then = (resolve: (r: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  const from = vi.fn((relation: string) => {
    calls.push(['from', relation]);
    return query;
  });
  return { client: { from } as unknown as SupabaseClient, calls, from };
}

describe('resolveTenant', () => {
  it('reads the slug from api.my_tenants with the editor client only', async () => {
    const { client, calls } = fakeClient({ data: TENANT, error: null });
    expect(await resolveTenant(client, 'acme')).toEqual(TENANT);
    expect(calls).toEqual([
      ['from', 'my_tenants'],
      ['select', 'id, slug, name, status'],
      ['eq', 'slug', 'acme'],
    ]);
  });

  it('is null when the editor has no membership in the tenant (the view returns no row)', async () => {
    const { client } = fakeClient({ data: null, error: null });
    expect(await resolveTenant(client, 'acme')).toBeNull();
  });

  it.each(['', 'Acme', 'a b', '-acme', 'acme-', 'a--b', '../x', 'a'.repeat(101)])('is null without a query for the malformed slug %j', async (slug) => {
    const { client, from } = fakeClient({ data: TENANT, error: null });
    expect(await resolveTenant(client, slug)).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it('throws on a database error instead of treating it as not found', async () => {
    const { client } = fakeClient({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(resolveTenant(client, 'acme')).rejects.toThrow('42501');
  });

  it('keeps only the error code, never the raw database message (which could reach the browser)', async () => {
    const { client } = fakeClient({ data: null, error: { code: '42501', message: 'permission denied for view my_tenants' } });
    const error = await resolveTenant(client, 'acme').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('my_tenants: 42501');
  });
});

describe('listMyTenants', () => {
  it('lists the editor tenants from api.my_tenants, by name', async () => {
    const { client, calls } = fakeClient({ data: [TENANT], error: null });
    expect(await listMyTenants(client)).toEqual([TENANT]);
    expect(calls).toEqual([
      ['from', 'my_tenants'],
      ['select', 'id, slug, name, status'],
      ['order', 'name'],
    ]);
  });

  it('throws on a database error', async () => {
    const { client } = fakeClient({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(listMyTenants(client)).rejects.toThrow(/^my_tenants: 42501$/);
  });
});

describe('currentTenant', () => {
  it('resolves the slug with the editor client of the request', async () => {
    const { client, calls } = fakeClient({ data: TENANT, error: null });
    editor.client = client;
    expect(await currentTenant('acme')).toEqual(TENANT);
    expect(createEditorClient).toHaveBeenCalled();
    expect(calls).toContainEqual(['eq', 'slug', 'acme']);
  });
});
