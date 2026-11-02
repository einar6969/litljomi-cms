// Direct database connections for the integration tests (plan Task 12,
// decision 8). pgAs() opens a dedicated connection with one open transaction
// that impersonates a role the way PostgREST does: set_config('role') and
// request.jwt.claims, both transaction-local. The caller commits or rolls back;
// closeAll() rolls back and closes whatever is left. ownerQuery() runs one
// autocommit statement as the owner (postgres), for arranging and reading back.
import pg from 'pg';
import { env } from './env.ts';
import { PERSONAS, type PersonaName } from './fixtures.ts';

export type Actor = PersonaName | 'anon' | 'service' | 'owner';

const open = new Set<pg.Client>();
const pids = new WeakMap<pg.Client, number>();
let pool: pg.Pool | null = null;

const claimsFor = (as: Exclude<Actor, 'owner'>) =>
  as === 'anon'
    ? { role: 'anon' }
    : as === 'service'
      ? { role: 'service_role' }
      : { sub: PERSONAS[as].id, role: 'authenticated', aal: 'aal1' };

export async function pgAs(as: Actor): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: env.dbUrl });
  client.on('error', () => {}); // a terminated backend is reported by the failing query
  open.add(client);
  try {
    await client.connect();
    const { rows } = await client.query('select pg_backend_pid() as pid');
    pids.set(client, rows[0].pid);
    await client.query('begin');
    if (as !== 'owner') {
      const claims = claimsFor(as);
      await client.query(`select set_config('role', $1, true), set_config('request.jwt.claims', $2, true)`, [
        claims.role,
        JSON.stringify(claims),
      ]);
    }
  } catch (e) {
    await closeClient(client); // a failed setup leaves no open connection behind
    throw e;
  }
  return client;
}

/** Runs fn inside a pgAs() transaction and commits it; rolls back if fn throws. */
export async function withTx<T>(as: Actor, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = await pgAs(as);
  try {
    const result = await fn(c);
    await c.query('commit');
    return result;
  } finally {
    await closeClient(c);
  }
}

/** Rolls back and closes one pgAs() connection; does nothing if it is already closed. */
export async function closeClient(c: pg.Client) {
  if (!open.delete(c)) return;
  try {
    await c.query('rollback');
  } catch {
    // already gone
  }
  await c.end().catch(() => {});
}

export async function ownerQuery<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  pool ??= new pg.Pool({ connectionString: env.dbUrl, max: 2 });
  return (await pool.query(text, params)).rows as T[];
}

/** Rolls back and closes every pgAs() connection still open, and the owner pool. */
export async function closeAll() {
  await Promise.all([...open].map(closeClient));
  const p = pool;
  pool = null;
  await p?.end();
}

/**
 * Resolves once the client's backend waits on a lock (pg_stat_activity
 * wait_event_type = 'Lock'); fails after 5 s (generous, so a slow machine does
 * not fail it; a real block shows within milliseconds). Proves the interleaving
 * a concurrency test relies on instead of assuming it from timing.
 */
export async function expectBlocked(client: pg.Client, timeoutMs = 5000): Promise<void> {
  const pid = pids.get(client);
  if (pid === undefined) throw new Error('expectBlocked: not a pgAs() client');
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    const rows = await ownerQuery<{ wait_event_type: string | null }>(
      'select wait_event_type from pg_stat_activity where pid = $1',
      [pid],
    );
    last = rows[0]?.wait_event_type;
    if (last === 'Lock') return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`expectBlocked: backend ${pid} not waiting on a lock after ${timeoutMs} ms (last wait_event_type: ${String(last)})`);
}

export const countDraftRefs = async (entryId: string) =>
  (await ownerQuery<{ n: number }>('select count(*)::int as n from cms.draft_refs where entry_id = $1', [entryId]))[0]!.n;

export const revisionData = async (requestId: string) =>
  (
    await ownerQuery<{ data: unknown }>(
      `select r.data from cms.revisions r join cms.publish_requests p on p.revision_id = r.id where p.id = $1`,
      [requestId],
    )
  )[0]?.data;

export const draftVersion = async (entryId: string) =>
  (await ownerQuery<{ version: number }>('select version from cms.drafts where entry_id = $1', [entryId]))[0]?.version;
