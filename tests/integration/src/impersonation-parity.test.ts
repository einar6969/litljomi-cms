// A14: pgTAP impersonation (role plus request.jwt.claims inside a transaction,
// spec §8.5) reproduces PostgREST (spec §11.1; plan Task 12). Twelve
// representative allow and deny cases from Tasks 5–11 run twice: through the
// Data API with a real session or key, and through a database connection
// impersonating the same role the way the pgTAP helpers and PostgREST do. Both
// outcomes are reduced to the same shape and must be equal. The SQL side rolls
// back; the REST side commits (it creates throwaway entries).
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anonClient, editorClient, secretClient } from './clients.ts';
import { TENANT, type PersonaName } from './fixtures.ts';
import { closeAll, pgAs } from './sql.ts';

type Caller = PersonaName | 'anon' | 'service';
type Outcome = { ok: true; value: unknown } | { ok: false; code: string | undefined; message: string | undefined };
type Context = { labakEntry: string; demoEntry: string };
type Case = {
  name: string;
  as: Caller;
  expected: Outcome;
} & (
  | { rpc: string; args: (ctx: Context) => Record<string, unknown>; shape?: (value: unknown) => unknown }
  | { view: string; column: string }
);

const denied = (code: string, message: string): Outcome => ({ ok: false, code, message });
const uuidShape = (v: unknown) => (typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v) ? 'uuid' : v);
const draftArgs = (entry: string) => ({
  p_entry_id: entry, p_expected_version: 1, p_data: { title: 'x' }, p_schema_version: 1, p_title: 'x', p_sort_at: null,
});

const PARITY_CASES: Case[] = [
  { name: 'editor creates an entry in its tenant', as: 'editor_labak', rpc: 'create_entry',
    args: () => ({ p_tenant_id: TENANT.labak, p_type: 'news' }), shape: uuidShape, expected: { ok: true, value: 'uuid' } },
  { name: 'editor creates an entry in another tenant', as: 'editor_labak', rpc: 'create_entry',
    args: () => ({ p_tenant_id: TENANT.demo, p_type: 'news' }), expected: denied('P0001', 'not_found') },
  { name: 'outsider creates an entry', as: 'outsider', rpc: 'create_entry',
    args: () => ({ p_tenant_id: TENANT.labak, p_type: 'news' }), expected: denied('P0001', 'not_found') },
  { name: 'revoked member saves a draft', as: 'revoked', rpc: 'save_draft',
    args: (c) => draftArgs(c.labakEntry), expected: denied('P0001', 'not_found') },
  { name: 'editor of demo requests publication of a labak entry', as: 'editor_demo', rpc: 'request_publish',
    args: (c) => ({ p_entry_id: c.labakEntry, p_expected_draft_version: 1 }), expected: denied('P0001', 'not_found') },
  { name: 'editor registers an asset outside its path', as: 'editor_labak', rpc: 'register_asset',
    args: () => {
      const id = randomUUID();
      return { p_asset_id: id, p_tenant_id: TENANT.labak, p_original_path: `${TENANT.labak}/${randomUUID()}/a.jpg`,
        p_filename: 'a.jpg', p_mime: 'image/jpeg', p_bytes: 1, p_width: 1, p_height: 1, p_sha256: 'a'.repeat(64) };
    }, expected: denied('P0001', 'forbidden') },
  { name: 'editor calls a worker function', as: 'editor_labak', rpc: 'worker_claim_requests',
    args: () => ({ p_limit: 1 }), expected: denied('42501', 'permission denied for function worker_claim_requests') },
  { name: 'anon calls an editor function', as: 'anon', rpc: 'create_entry',
    args: () => ({ p_tenant_id: TENANT.labak, p_type: 'news' }), expected: denied('42501', 'permission denied for function create_entry') },
  { name: 'secret key reads the sites through Vault', as: 'service', rpc: 'worker_sites',
    args: () => ({ p_tenant_id: TENANT.demo }),
    shape: (v) => (v as { base_url: string }[]).map((s) => s.base_url).sort(), expected: { ok: true, value: ['http://localhost:3101'] } },
  { name: 'editor lists entries: own tenant only', as: 'editor_labak', view: 'entry_list', column: 'tenant_id',
    expected: { ok: true, value: [TENANT.labak] } },
  { name: 'platform admin without membership sees no tenants', as: 'platform_admin', view: 'my_tenants', column: 'id',
    expected: { ok: true, value: [] } },
  { name: 'anon reads an editor view', as: 'anon', view: 'entry_list', column: 'tenant_id',
    expected: denied('42501', 'permission denied for view entry_list') },
];

const restClient = async (as: Caller): Promise<SupabaseClient> =>
  as === 'anon' ? anonClient() : as === 'service' ? secretClient() : editorClient(as);

const distinctSorted = (values: unknown[]) => [...new Set(values)].sort();

async function viaRest(c: Case, ctx: Context): Promise<Outcome> {
  const api = (await restClient(c.as)).schema('api');
  if ('view' in c) {
    const { data, error } = await api.from(c.view).select(c.column);
    if (error) return { ok: false, code: error.code, message: error.message };
    return { ok: true, value: distinctSorted((data as unknown as Record<string, unknown>[]).map((r) => r[c.column])) };
  }
  const { data, error } = await api.rpc(c.rpc, c.args(ctx));
  if (error) return { ok: false, code: error.code, message: error.message };
  return { ok: true, value: c.shape ? c.shape(data) : data };
}

async function viaSql(c: Case, ctx: Context): Promise<Outcome> {
  const db = await pgAs(c.as);
  try {
    if ('view' in c) {
      const { rows } = await db.query(`select "${c.column}" as v from api."${c.view}"`);
      return { ok: true, value: distinctSorted(rows.map((r) => r.v)) };
    }
    const args = Object.entries(c.args(ctx));
    const named = args.map(([k], i) => `${k} => $${i + 1}`).join(', ');
    const values = args.map(([, v]) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v));
    // A set-returning function is read as rows, a scalar one as its value: the
    // same shapes PostgREST returns.
    const { rows } = await db.query(`select to_jsonb(r) as v from api."${c.rpc}"(${named}) r`, values);
    const value = rows.length === 1 && c.rpc !== 'worker_sites' ? unwrap(rows[0].v) : rows.map((r) => r.v);
    return { ok: true, value: c.shape ? c.shape(value) : value };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return { ok: false, code: err.code, message: err.message };
  } finally {
    await db.query('rollback');
  }
}

// to_jsonb of a scalar function's single column row: {"<function name>": value}.
const unwrap = (v: Record<string, unknown>) => {
  const values = Object.values(v);
  return values.length === 1 ? values[0] : v;
};

describe('A14: SQL impersonation and PostgREST agree', () => {
  const ctx = {} as Context;
  beforeAll(async () => {
    const labak = await (await editorClient('editor_labak')).schema('api').rpc('create_entry', { p_tenant_id: TENANT.labak, p_type: 'news' });
    const demo = await (await editorClient('editor_demo')).schema('api').rpc('create_entry', { p_tenant_id: TENANT.demo, p_type: 'news' });
    expect(labak.error).toBeNull();
    expect(demo.error).toBeNull();
    ctx.labakEntry = labak.data as string;
    ctx.demoEntry = demo.data as string;
  });
  afterAll(closeAll);

  it('has 12 cases', () => {
    expect(PARITY_CASES).toHaveLength(12);
  });

  it.each(PARITY_CASES.map((c) => [c.name, c] as const))('SQL impersonation and REST agree: %s', async (_name, c) => {
    const rest = await viaRest(c, ctx);
    const sql = await viaSql(c, ctx);
    expect(rest).toEqual(c.expected);
    expect(sql).toEqual(rest);
  });
});
