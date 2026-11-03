// Singletons against the local stack (plan M2-09; spec §3.2, §10.1). Editors act over the Data
// API with their own sessions, through the same `openSingleton` the editor's server action uses;
// concurrent opens are separate HTTP requests, so separate database sessions, and the interleaved
// case uses two database connections as editor_demo to prove the second open waits on the first.
// Every test uses a fresh type name, so "first open" holds on a database earlier runs used too
// (the database does not know a module's types; it learns a singleton from its entry).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@/lib/supabase/types';
import { editorClient } from '../../../../../../tests/integration/src/clients.ts';
import { TENANT } from '../../../../../../tests/integration/src/fixtures.ts';
import { closeAll, expectBlocked, ownerQuery, pgAs } from '../../../../../../tests/integration/src/sql.ts';
import { openSingleton } from '../singleton';

type Rpc = Pick<SupabaseClient, 'rpc'>;
/** The persona's Data API client on the `api` schema, as the CMS server's editor client is. */
const apiClient = async (persona: 'editor_demo' | 'editor_labak'): Promise<Rpc> => (await editorClient(persona)).schema('api') as unknown as Rpc;

let first: Rpc;
let second: Rpc;
let labak: Rpc;

beforeAll(async () => {
  first = await apiClient('editor_demo');
  second = await apiClient('editor_demo');
  labak = await apiClient('editor_labak');
});
afterAll(closeAll);

const freshType = () => `m209_${randomUUID().slice(0, 8)}`;
const entriesOf = async (type: string) =>
  ownerQuery<{ id: string; singleton: boolean; drafts: number }>(
    `select e.id, e.singleton, (select count(*)::int from cms.drafts d where d.entry_id = e.id) as drafts
     from cms.entries e where e.tenant_id = $1 and e.type = $2`,
    [TENANT.demo, type],
  );

describe('opening a singleton type (M2-09)', () => {
  it('two concurrent first opens end with one entry, and neither editor sees an error', async () => {
    const type = { name: freshType(), version: 1 };
    const results = await Promise.all([openSingleton(first, TENANT.demo, type), openSingleton(second, TENANT.demo, type)]);
    expect(results.every((r) => r.ok)).toBe(true);
    const [a, b] = results as { ok: true; entryId: string }[];
    expect(a!.entryId).toBe(b!.entryId);
    expect(await entriesOf(type.name)).toEqual([{ id: a!.entryId, singleton: true, drafts: 1 }]);
  });

  it('many concurrent first opens: still one entry, the same id for all', async () => {
    const type = { name: freshType(), version: 1 };
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => openSingleton(i % 2 ? first : second, TENANT.demo, type)));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(new Set(results.map((r) => (r.ok ? r.entryId : null))).size).toBe(1);
    expect(await entriesOf(type.name)).toHaveLength(1);
  });

  it('interleaved: the second open waits for the first to commit, then returns its entry without an error', async () => {
    const type = freshType();
    const a = await pgAs('editor_demo');
    const b = await pgAs('editor_demo');
    const { rows: ra } = await a.query<{ id: string }>('select api.create_singleton_entry($1, $2, 1) as id', [TENANT.demo, type]);
    const pending = b.query<{ id: string }>('select api.create_singleton_entry($1, $2, 1) as id', [TENANT.demo, type]);
    await expectBlocked(b);
    await a.query('commit');
    const { rows: rb } = await pending;
    await b.query('commit');
    expect(rb[0]!.id).toBe(ra[0]!.id);
    expect(await entriesOf(type)).toHaveLength(1);
  });

  it('a later open returns the same entry; create_entry of the type is refused with singleton_exists', async () => {
    const type = { name: freshType(), version: 1 };
    const opened = await openSingleton(first, TENANT.demo, type);
    expect(opened.ok).toBe(true);
    expect(await openSingleton(second, TENANT.demo, type)).toEqual(opened);
    const created = await first.rpc('create_entry', { p_tenant_id: TENANT.demo, p_type: type.name });
    expect(created.error).toMatchObject({ code: 'P0001', message: 'singleton_exists' });
    expect(await entriesOf(type.name)).toHaveLength(1);
  });

  it('an editor of another tenant opens nothing and creates nothing', async () => {
    const type = { name: freshType(), version: 1 };
    expect(await openSingleton(labak, TENANT.demo, type)).toEqual({ ok: false, code: 'error' });
    expect(await entriesOf(type.name)).toEqual([]);
  });
});
