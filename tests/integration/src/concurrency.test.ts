// Concurrency of the commit with real Postgres sessions (spec §5.5, §6.2, §7.1,
// §8.5; plan Task 12, decision 8, "Exactness: what M1 proves"). Each pgAs()
// connection holds one open transaction impersonating a role the way PostgREST
// does, so two of them can interleave: expectBlocked() proves that the second
// one is waiting on a lock before the first commits.
import type pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { TENANT } from './fixtures.ts';
import { closeAll, draftVersion, expectBlocked, ownerQuery, pgAs, revisionData, withTx } from './sql.ts';

const one = async <T>(c: pg.Client, text: string, params: unknown[] = []): Promise<T> => {
  const { rows } = await c.query(text, params);
  return Object.values(rows[0] as Record<string, unknown>)[0] as T;
};

// An entry of labak whose draft has gone through `versions` saves, the last
// with `data`: version 1 + versions.length. Committed as editor_labak.
const entryWithDraft = (versions: object[]) =>
  withTx('editor_labak', async (e) => {
    const id = await one<string>(e, `select api.create_entry($1, 'news')`, [TENANT.labak]);
    let v = 1;
    for (const data of versions) v = await one<number>(e, `select api.save_draft($1, $2, $3, 1, 'T', null)`, [id, v, data]);
    return { id, version: v };
  });

// A publish or unpublish request by editor_labak, claimed by the worker so it
// is validating. Claims every pending request (leftovers from earlier runs
// included) so the claim is deterministic.
const claimedRequest = async (entryId: string, action: 'publish' | 'unpublish', version?: number) => {
  const requestId = await withTx('editor_labak', (e) =>
    action === 'publish'
      ? one<string>(e, 'select api.request_publish($1, $2)', [entryId, version])
      : one<string>(e, 'select api.request_unpublish($1)', [entryId]),
  );
  await withTx('service', (w) => w.query('select api.worker_claim_requests(1000)'));
  const [row] = await ownerQuery<{ status: string }>('select status from cms.publish_requests where id = $1', [requestId]);
  expect(row?.status).toBe('validating');
  return requestId;
};

const publishNow = async (entryId: string, version: number) => {
  const r = await claimedRequest(entryId, 'publish', version);
  expect(await withTx('service', (w) => one<string>(w, `select api.worker_commit_publish($1, $2, 1, 'T', now())`, [r, version]))).toBe('committed');
};

const requestStatus = async (id: string) =>
  (await ownerQuery<{ status: string; error: unknown }>('select status, error from cms.publish_requests where id = $1', [id]))[0];
const publishedRev = async (entryId: string) =>
  (await ownerQuery<{ published_rev_id: string | null }>('select published_rev_id from cms.entries where id = $1', [entryId]))[0]
    ?.published_rev_id;

afterAll(closeAll);

describe('exactness under concurrency (consideration 1)', () => {
  it('save_draft waits for an in-flight commit; the revision holds the validated data', async () => {
    const validatedData = { title: 'validated', body: 'v3' };
    const { id: entryId } = await entryWithDraft([{ title: 'v2' }, validatedData]);
    const requestId = await claimedRequest(entryId, 'publish', 3);

    const w = await pgAs('service');
    const e = await pgAs('editor_labak');
    expect(await one(w, `select api.worker_commit_publish($1, 3, 1, 'T', now())`, [requestId])).toBe('committed'); // tx open, locks held
    const pending = e.query(`select api.save_draft($1, 3, '{"title":"new"}', 1, 'new', null)`, [entryId]);
    await expectBlocked(e); // pg_stat_activity shows e waiting on a lock
    await w.query('commit');
    const saved = await pending;
    await e.query('commit');

    expect(Object.values(saved.rows[0])[0]).toBe(4);
    expect(await revisionData(requestId)).toEqual(validatedData);
    expect(await draftVersion(entryId)).toBe(4);
    const [rev] = await ownerQuery<{ draft_version: number; schema_version: number }>(
      `select r.draft_version, r.schema_version from cms.revisions r
       join cms.publish_requests p on p.revision_id = r.id where p.id = $1`,
      [requestId],
    );
    expect(rev).toEqual({ draft_version: 3, schema_version: 1 });
  });

  it('commit A (refs B) holds B; a concurrent unpublish of B waits, then succeeds', async () => {
    const b = await entryWithDraft([{ title: 'B' }]);
    await publishNow(b.id, b.version);
    const a = await entryWithDraft([{ title: 'A', link: { _ref: b.id, _kind: 'entry' } }]);
    const publishA = await claimedRequest(a.id, 'publish', a.version);
    const unpublishB = await claimedRequest(b.id, 'unpublish');

    const w1 = await pgAs('service');
    const w2 = await pgAs('service');
    expect(await one(w1, `select api.worker_commit_publish($1, $2, 1, 'T', now())`, [publishA, a.version])).toBe('committed');
    const pending = w2.query('select api.worker_commit_unpublish($1) as status', [unpublishB]);
    await expectBlocked(w2);
    await w1.query('commit');
    expect((await pending).rows[0].status).toBe('committed');
    await w2.query('commit');

    expect(await publishedRev(a.id)).not.toBeNull();
    expect(await publishedRev(b.id)).toBeNull();
    expect((await requestStatus(publishA))?.status).toBe('committed');
    expect((await requestStatus(unpublishB))?.status).toBe('committed');
  });

  it('unpublish B first; a concurrent commit of A referencing B ends failed_validation', async () => {
    const b = await entryWithDraft([{ title: 'B' }]);
    await publishNow(b.id, b.version);
    const a = await entryWithDraft([{ title: 'A', link: { _ref: b.id, _kind: 'entry' } }]);
    const publishA = await claimedRequest(a.id, 'publish', a.version);
    const unpublishB = await claimedRequest(b.id, 'unpublish');

    const w1 = await pgAs('service');
    const w2 = await pgAs('service');
    expect(await one(w2, 'select api.worker_commit_unpublish($1)', [unpublishB])).toBe('committed'); // holds B FOR UPDATE
    const pending = w1.query(`select api.worker_commit_publish($1, $2, 1, 'T', now()) as status`, [publishA, a.version]);
    await expectBlocked(w1);
    await w2.query('commit');
    expect((await pending).rows[0].status).toBe('failed_validation');
    await w1.query('commit');

    expect(await publishedRev(a.id)).toBeNull();
    expect(await publishedRev(b.id)).toBeNull();
    expect((await requestStatus(publishA))?.error).toMatchObject({
      code: 'invalid_reference',
      refs: [{ path: '$."link"', kind: 'entry', id: b.id, reason: 'unpublished' }],
    });
  });

  it('a tenant suspension waits for an in-flight commit (decision 33: the commit holds the tenant FOR SHARE)', async () => {
    const { id: entryId, version } = await entryWithDraft([{ title: 'tenant lock' }]);
    const requestId = await claimedRequest(entryId, 'publish', version);

    const w = await pgAs('service');
    const s = await pgAs('service'); // the CLI's suspension, as service_role (UPDATE (name, status))
    expect(await one(w, `select api.worker_commit_publish($1, $2, 1, 'T', now())`, [requestId, version])).toBe('committed');
    const pending = s.query(`update cms.tenants set status = 'suspended' where id = $1`, [TENANT.labak]);
    await expectBlocked(s); // without the tenant lock the update would not wait
    await w.query('commit');
    expect((await pending).rowCount).toBe(1);
    await s.query('rollback'); // labak stays active for the other tests

    expect(await publishedRev(entryId)).not.toBeNull();
    const [tenant] = await ownerQuery<{ status: string }>('select status from cms.tenants where id = $1', [TENANT.labak]);
    expect(tenant?.status).toBe('active');
  });

  it('a draft saved between worker_read_request and commit makes the request superseded', async () => {
    const { id: entryId, version } = await entryWithDraft([{ title: 'read' }]);
    const requestId = await claimedRequest(entryId, 'publish', version);

    const w = await pgAs('service');
    const read = await one<{ draft: { version: number; data: unknown } }>(w, 'select api.worker_read_request($1)', [requestId]);
    expect(read.draft).toMatchObject({ version, data: { title: 'read' } });
    await w.query('commit');

    await withTx('editor_labak', (e) => e.query(`select api.save_draft($1, $2, '{"title":"later"}', 1, 'later', null)`, [entryId, version]));

    expect(await withTx('service', (c) => one<string>(c, `select api.worker_commit_publish($1, $2, 1, 'T', now())`, [requestId, version]))).toBe('superseded');
    expect(await publishedRev(entryId)).toBeNull();
    expect(await ownerQuery('select 1 from cms.revisions where entry_id = $1', [entryId])).toEqual([]);
  });

  // Security fix, Thread A (§7.1 "withdrawal always wins"): an older publish still validating
  // must not commit over a newer unpublish that committed meanwhile.
  it('P1 validating, U1 commits (P1 waits on its lock), then P1 is superseded and does not commit', async () => {
    const { id: entryId, version } = await entryWithDraft([{ title: 'live' }]);
    await publishNow(entryId, version);
    const live = await publishedRev(entryId);
    expect(live).not.toBeNull();
    const p1 = await claimedRequest(entryId, 'publish', version);
    const u1 = await claimedRequest(entryId, 'unpublish');

    const wu = await pgAs('service');
    const wp = await pgAs('service');
    expect(await one(wu, 'select api.worker_commit_unpublish($1)', [u1])).toBe('committed'); // tx open, entry locked
    const pending = wp.query(`select api.worker_commit_publish($1, $2, 1, 'T', now())`, [p1, version]);
    await expectBlocked(wp);
    await wu.query('commit');
    const result = await pending;
    await wp.query('commit');

    expect(Object.values(result.rows[0] as Record<string, unknown>)[0]).toBe('superseded');
    expect(await requestStatus(p1)).toEqual({ status: 'superseded', error: { code: 'superseded', newer_request_id: u1 } });
    expect(await requestStatus(u1)).toMatchObject({ status: 'committed' });
    expect(await publishedRev(entryId)).toBeNull();
    expect(await ownerQuery<{ n: number }>('select count(*)::int as n from cms.revisions where entry_id = $1', [entryId])).toEqual([{ n: 1 }]);
  });

  it('two worker_begin_release calls for one tenant: one row, one null', async () => {
    // A building release left by an earlier run would make both calls null.
    const leftovers = await ownerQuery<{ id: string }>(`select id from cms.releases where tenant_id = $1 and status = 'building'`, [TENANT.labak]);
    for (const { id } of leftovers) {
      await withTx('service', (w) => w.query(`select api.worker_finish_release($1, 'failed', null, '{"test":"cleanup"}', '{}', '[]')`, [id]));
    }

    const w1 = await pgAs('service');
    const w2 = await pgAs('service');
    const first = await one<string | null>(w1, 'select r.id from api.worker_begin_release($1) r', [TENANT.labak]);
    expect(first).not.toBeNull();
    const pending = w2.query('select r.id from api.worker_begin_release($1) r', [TENANT.labak]);
    await expectBlocked(w2); // the tenant row lock serialises the two
    await w1.query('commit');
    expect((await pending).rows[0].id).toBeNull();
    await w2.query('commit');

    const building = await ownerQuery<{ id: string }>(`select id from cms.releases where tenant_id = $1 and status = 'building'`, [TENANT.labak]);
    expect(building).toEqual([{ id: first }]);
    await withTx('service', (w) => w.query(`select api.worker_finish_release($1, 'failed', null, '{"test":"cleanup"}', '{}', '[]')`, [first]));
  });
});
