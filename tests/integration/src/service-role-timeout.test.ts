// Decision 34.1 (Einar, 2026-11-02): `alter role service_role set statement_timeout = '10s'`
// (migration 20261102001100). Proven over the REST API with the secret key, as the worker calls it:
// PostgREST applies the impersonated role's settings to every request, so a service_role request
// runs with 10 s and a statement exceeding it is cancelled with 57014.
//
// No api function exists to sleep or to read a setting, and none is added for this test. The slow
// statement is a real worker call, api.worker_commit_publish, made to wait on row locks held by
// two owner transactions. The login role `authenticator` carries lock_timeout = 8s (and, before
// the migration, statement_timeout = 8s), so a single lock wait would end at 8 s with 55P03; the
// call is made to wait twice instead, about 6 s on the request row and then on the entry row,
// so no single wait reaches 8 s while the statement as a whole passes 10 s. Cancelled at about
// 10 s with 57014, it ran under service_role's 10 s, not the authenticator's 8 s (before the
// migration the same request was cancelled at about 8.2 s) and not without a timeout (then the
// second wait would end at about 14 s with 55P03).
import { afterAll, describe, expect, it } from 'vitest';
import { secretClient } from './clients.ts';
import { PERSONAS, TENANT } from './fixtures.ts';
import { closeAll, closeClient, ownerQuery, pgAs } from './sql.ts';

afterAll(closeAll);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('service_role statement timeout over REST (decision 34.1)', () => {
  it('is a role setting of 10 s', async () => {
    const rows = await ownerQuery<{ setconfig: string[] }>(
      `select setconfig from pg_db_role_setting where setrole = 'service_role'::regrole and setdatabase = 0`,
    );
    expect(rows).toEqual([{ setconfig: ['statement_timeout=10s'] }]);
  });

  it('cancels a secret-key request whose statement runs past 10 s with 57014', async () => {
    const [entry] = await ownerQuery<{ id: string }>(
      `insert into cms.entries (tenant_id, type, created_by) values ($1, 'news', $2) returning id`,
      [TENANT.labak, PERSONAS.editor_labak.id],
    );
    await ownerQuery(`insert into cms.drafts (entry_id, tenant_id, schema_version, updated_by) values ($1, $2, 1, $3)`, [
      entry!.id,
      TENANT.labak,
      PERSONAS.editor_labak.id,
    ]);
    const [request] = await ownerQuery<{ id: string }>(
      `insert into cms.publish_requests (tenant_id, entry_id, action, draft_version, requested_by, status, claimed_at, attempts)
       values ($1, $2, 'publish', 1, $3, 'validating', now(), 1) returning id`,
      [TENANT.labak, entry!.id, PERSONAS.editor_labak.id],
    );

    const holdRequest = await pgAs('owner');
    const holdEntry = await pgAs('owner');
    try {
      await holdRequest.query('select 1 from cms.publish_requests where id = $1 for update', [request!.id]);
      await holdEntry.query('select 1 from cms.entries where id = $1 for update', [entry!.id]);

      const started = Date.now();
      // The query builder sends nothing until it is awaited; Promise.resolve starts it now.
      const call = Promise.resolve(
        secretClient().schema('api').rpc('worker_commit_publish', {
          p_request_id: request!.id,
          p_validated_draft_version: 1,
          p_validated_schema_version: 1,
          p_title: 'T',
          p_sort_at: null,
        }),
      );
      // The request is waiting on the request row before the first lock is released.
      const [waiting] = await waitForRestBackend();
      expect(waiting).toBeDefined();
      await sleep(6000 - (Date.now() - started));
      // Releases the request row; the call now waits on the entry row. closeClient does nothing
      // for a connection it already closed, so the finally below is safe.
      await closeClient(holdRequest);
      const { error } = await call;
      const elapsed = Date.now() - started;

      expect(error?.code).toBe('57014');
      expect(error?.message).toBe('canceling statement due to statement timeout');
      expect(elapsed).toBeGreaterThanOrEqual(9_500);
      expect(elapsed).toBeLessThan(12_000);

      // The cancelled call changed nothing: the request is still validating, with no revision.
      const [after] = await ownerQuery<{ status: string; revision_id: string | null }>(
        'select status, revision_id from cms.publish_requests where id = $1',
        [request!.id],
      );
      expect(after).toEqual({ status: 'validating', revision_id: null });
    } finally {
      await closeClient(holdRequest);
      await closeClient(holdEntry);
      // Leave no validating request for the other suites' claims, even when an assertion failed.
      await ownerQuery(`update cms.publish_requests set status = 'failed', error = '{"code": "timeout_probe"}' where id = $1`, [
        request!.id,
      ]);
    }
  }, 30_000);
});

/** The PostgREST backend (login role authenticator) waiting on a lock; polls for up to 3 s. */
async function waitForRestBackend(): Promise<Array<{ pid: number }>> {
  for (let i = 0; i < 150; i++) {
    const rows = await ownerQuery<{ pid: number }>(
      `select pid from pg_stat_activity where usename = 'authenticator' and wait_event_type = 'Lock'
         and query like '%worker_commit_publish%'`,
    );
    if (rows.length > 0) return rows;
    await sleep(20);
  }
  return [];
}
