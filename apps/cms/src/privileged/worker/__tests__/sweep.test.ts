// The sweep's steps with a fake admin client (plan Tasks 21 and 30, decisions 36.2 and 37.1): stale
// building releases are failed first and alerted, and a failing step does not stop the next one
// (Task 21 quality r1, Minor 2). The steps' database side runs in pipeline.integration.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Reply = { data?: unknown; error?: { code: string; message: string } };
const order: string[] = [];
let handlers: Record<string, () => Reply> = {};
const fakeClient = {
  rpc: vi.fn(async (fn: string) => {
    order.push(fn);
    const handler = handlers[fn];
    if (!handler) throw new Error(`unexpected rpc ${fn}`);
    const reply = handler();
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

beforeEach(() => {
  order.length = 0;
  alertMock.mockClear();
  processPendingMock.mockClear();
  deliverTenantMock.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  handlers = {
    worker_fail_stale_releases: () => ({ data: STALE }),
    worker_tenants_to_release: () => ({ data: [{ tenant_id: 't1' }] }),
    worker_deliveries_to_retry: () => ({ data: [] }),
  };
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('failStaleReleases', () => {
  it('fails stale building releases through the database and alerts once per failed release', async () => {
    const failed = await failStaleReleases(fakeClient as never);

    expect(failed).toEqual(STALE);
    expect(order).toEqual(['worker_fail_stale_releases']);
    expect(STALE_RELEASE_SECONDS).toBe(420);
    expect(alertMock.mock.calls).toEqual([
      ['release.stale_failed', { tenantId: 't1', releaseId: 'r1', number: 4, createdAt: STALE[0]!.created_at, maxAgeSeconds: 420 }],
      ['release.stale_failed', { tenantId: 't2', releaseId: 'r2', number: 1, createdAt: STALE[1]!.created_at, maxAgeSeconds: 420 }],
    ]);
  });

  it('alerts nothing when nothing is stale', async () => {
    handlers.worker_fail_stale_releases = () => ({ data: [] });
    expect(await failStaleReleases(fakeClient as never)).toEqual([]);
    expect(alertMock).not.toHaveBeenCalled();
  });
});

describe('runSweep', () => {
  it('fails stale releases first, so a tenant blocked by one is built in the same sweep', async () => {
    await runSweep();

    expect(order).toEqual([
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
    expect(order).toEqual([
      'worker_fail_stale_releases',
      'processPendingRequests',
      'worker_tenants_to_release',
      'deliverTenant t1',
      'worker_deliveries_to_retry',
    ]);
  });

  it('one tenant’s failing release does not stop the others', async () => {
    handlers.worker_tenants_to_release = () => ({ data: [{ tenant_id: 't1' }, { tenant_id: 't2' }] });
    deliverTenantMock.mockRejectedValueOnce(new Error('t1 broke'));

    await expect(runSweep()).rejects.toThrow(AggregateError);
    expect(deliverTenantMock.mock.calls.map((c) => c[0])).toEqual(['t1', 't2']);
  });
});
