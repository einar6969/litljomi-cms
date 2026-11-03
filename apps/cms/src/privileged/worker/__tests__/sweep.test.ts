// The sweep's steps with a fake admin client (plan Tasks 21 and 30, decisions 36.2 and 37.1): stale
// building releases are failed first and alerted, and a failing step does not stop the next one
// (Task 21 quality r1, Minor 2). M3-02: the sweep reads the retry schedule at its clock (a fake
// one here) and alerts when a stale failure exhausts the build retries. The steps' database side
// runs in pipeline.integration.test.ts and the pgTAP suites.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Reply = { data?: unknown; error?: { code: string; message: string } };
const order: string[] = [];
const args: Array<{ fn: string; args: Record<string, unknown> }> = [];
let handlers: Record<string, (a: Record<string, unknown>) => Reply> = {};
const fakeClient = {
  rpc: vi.fn(async (fn: string, a: Record<string, unknown>) => {
    order.push(fn);
    args.push({ fn, args: a });
    const handler = handlers[fn];
    if (!handler) throw new Error(`unexpected rpc ${fn}`);
    const reply = handler(a);
    return { data: reply.data ?? null, error: reply.error ?? null };
  }),
};
vi.mock('../../admin-client', () => ({ createAdminClient: () => fakeClient }));
const alertMock = vi.fn(async (_event: string, _details: Record<string, unknown>) => {});
vi.mock('../alerts', () => ({ alert: (event: string, details: Record<string, unknown>) => alertMock(event, details) }));
const processPendingMock = vi.fn(async () => {
  order.push('processPendingRequests');
  return [];
});
vi.mock('../process-request', () => ({ processPendingRequests: () => processPendingMock() }));
const deliverTenantMock = vi.fn(async (tenantId: string) => {
  order.push(`deliverTenant ${tenantId}`);
  return { status: 'delivered', releaseId: `rel-${tenantId}`, omitted: [] };
});
vi.mock('../deliver', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../deliver')>()),
  deliverTenant: (tenantId: string) => deliverTenantMock(tenantId),
}));

const { failStaleReleases, runSweep, STALE_RELEASE_SECONDS } = await import('../sweep');

const STALE = [
  { release_id: 'r1', tenant_id: 't1', number: 4, created_at: '2026-11-02T09:00:00+00:00' },
  { release_id: 'r2', tenant_id: 't2', number: 1, created_at: '2026-11-02T08:00:00+00:00' },
];

/** A fake clock: 2026-11-03 12:00 UTC. */
const clock = { now: () => Date.UTC(2026, 10, 3, 12, 0, 0) };

beforeEach(() => {
  order.length = 0;
  args.length = 0;
  alertMock.mockClear();
  processPendingMock.mockClear();
  deliverTenantMock.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  handlers = {
    worker_fail_stale_releases: () => ({ data: STALE }),
    worker_tenants_to_release: () => ({ data: [{ tenant_id: 't1' }] }),
    worker_deliveries_to_retry: () => ({ data: [] }),
    worker_release_retry: () => ({ data: [{ status: 'failed', next_attempt_at: '2026-11-03T12:01:00Z', retries_exhausted: false }] }),
  };
});
const withoutRetryReads = (fns: string[]) => fns.filter((fn) => fn !== 'worker_release_retry');
afterEach(() => {
  vi.restoreAllMocks();
});

describe('failStaleReleases', () => {
  it('fails stale building releases through the database and alerts once per failed release', async () => {
    const failed = await failStaleReleases(fakeClient as never);

    expect(failed).toEqual(STALE);
    expect(order).toEqual(['worker_fail_stale_releases', 'worker_release_retry', 'worker_release_retry']);
    expect(STALE_RELEASE_SECONDS).toBe(420);
    expect(alertMock.mock.calls).toEqual([
      ['release.stale_failed', { tenantId: 't1', releaseId: 'r1', number: 4, createdAt: STALE[0]!.created_at, maxAgeSeconds: 420 }],
      ['release.stale_failed', { tenantId: 't2', releaseId: 'r2', number: 1, createdAt: STALE[1]!.created_at, maxAgeSeconds: 420 }],
    ]);
  });

  it('alerts release.retries_exhausted for a stale failure that exhausted its tenant\'s build retries (M3-02)', async () => {
    handlers.worker_release_retry = (a) => ({
      data: [{ status: 'failed', next_attempt_at: null, retries_exhausted: a.p_release_id === 'r2' }],
    });

    await failStaleReleases(fakeClient as never);

    expect(args.filter((c) => c.fn === 'worker_release_retry').map((c) => c.args)).toEqual([{ p_release_id: 'r1' }, { p_release_id: 'r2' }]);
    expect(alertMock.mock.calls.map((c) => c[0])).toEqual(['release.stale_failed', 'release.stale_failed', 'release.retries_exhausted']);
    expect(alertMock.mock.calls[2]).toEqual(['release.retries_exhausted', { tenantId: 't2', releaseId: 'r2', number: 1 }]);
  });

  it('alerts nothing when nothing is stale', async () => {
    handlers.worker_fail_stale_releases = () => ({ data: [] });
    expect(await failStaleReleases(fakeClient as never)).toEqual([]);
    expect(alertMock).not.toHaveBeenCalled();
  });
});

describe('runSweep', () => {
  it('fails stale releases first, then builds the tenants and retries the deliveries due', async () => {
    await runSweep();

    expect(withoutRetryReads(order)).toEqual([
      'worker_fail_stale_releases',
      'processPendingRequests',
      'worker_tenants_to_release',
      'deliverTenant t1',
      'worker_deliveries_to_retry',
    ]);
  });

  it('a failing step does not stop the next ones; the sweep then throws an AggregateError with one error per failed step', async () => {
    handlers.worker_fail_stale_releases = () => ({ error: { code: '57014', message: 'canceling statement due to statement timeout' } });
    processPendingMock.mockImplementationOnce(async () => {
      order.push('processPendingRequests');
      throw new Error('claim failed');
    });
    handlers.worker_deliveries_to_retry = () => ({ error: { code: '08006', message: 'connection failure' } });

    const error = await runSweep().then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(AggregateError);
    const errors = (error as AggregateError).errors.map((e: Error) => e.message);
    expect(errors).toEqual([
      'worker_fail_stale_releases: 57014 canceling statement due to statement timeout',
      'claim failed',
      'worker_deliveries_to_retry: 08006 connection failure',
    ]);
    // Steps 2 and 3 still ran after the failures before them.
    expect(withoutRetryReads(order)).toEqual([
      'worker_fail_stale_releases',
      'processPendingRequests',
      'worker_tenants_to_release',
      'deliverTenant t1',
      'worker_deliveries_to_retry',
    ]);
  });

  it('reads the schedule at its clock: both selections get p_now (M3-02)', async () => {
    await runSweep(clock);

    expect(args.find((c) => c.fn === 'worker_tenants_to_release')?.args).toEqual({ p_now: '2026-11-03T12:00:00.000Z' });
    expect(args.find((c) => c.fn === 'worker_deliveries_to_retry')?.args).toEqual({ p_now: '2026-11-03T12:00:00.000Z' });
  });

  it('a later clock is passed as it is: the database decides what is due', async () => {
    await runSweep({ now: () => Date.UTC(2026, 10, 4, 12, 0, 0) });

    expect(args.find((c) => c.fn === 'worker_deliveries_to_retry')?.args).toEqual({ p_now: '2026-11-04T12:00:00.000Z' });
  });

  it('one tenant’s failing release does not stop the others', async () => {
    handlers.worker_tenants_to_release = () => ({ data: [{ tenant_id: 't1' }, { tenant_id: 't2' }] });
    deliverTenantMock.mockRejectedValueOnce(new Error('t1 broke'));

    await expect(runSweep()).rejects.toThrow(AggregateError);
    expect(deliverTenantMock.mock.calls.map((c) => c[0])).toEqual(['t1', 't2']);
  });
});
