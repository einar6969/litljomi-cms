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
/** The bundles the fake delivery bucket serves to a retry, by path. */
const bundles = new Map<string, unknown>();
const fakeClient = {
  storage: {
    from: (_bucket: string) => ({
      download: async (path: string) =>
        bundles.has(path) ? { data: new Blob([JSON.stringify(bundles.get(path))]), error: null } : { data: null, error: new Error(`no ${path}`) },
    }),
  },
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
const deliverTenantMock = vi.fn(async (tenantId: string): Promise<{ status: string; releaseId?: string; omitted: string[] }> => {
  order.push(`deliverTenant ${tenantId}`);
  return { status: 'delivered', releaseId: `rel-${tenantId}`, omitted: [] };
});
const confirmReleaseMock = vi.fn(async (_db: unknown, release: { tenantId: string; number: number }, _o: unknown, retry?: ReadonlySet<string>) => {
  order.push(`confirmRelease ${release.tenantId} #${release.number} [${[...(retry ?? [])].join(',')}]`);
});
const confirmWithdrawalRetryMock = vi.fn(
  async (_db: unknown, release: { tenantId: string; number: number; notifyRelease: number }, states: ReadonlyMap<string, unknown>, _o: unknown) => {
    order.push(`confirmWithdrawalRetry ${release.tenantId} #${release.number}→#${release.notifyRelease} [${[...states.keys()].join(',')}]`);
  },
);
vi.mock('../deliver', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../deliver')>()),
  deliverTenant: (tenantId: string) => deliverTenantMock(tenantId),
  confirmWithdrawalRetry: (db: unknown, release: { tenantId: string; number: number; notifyRelease: number }, states: ReadonlyMap<string, unknown>, o: unknown) =>
    confirmWithdrawalRetryMock(db, release, states, o),
  confirmRelease: (db: unknown, release: { tenantId: string; number: number }, o: unknown, retry?: ReadonlySet<string>) =>
    confirmReleaseMock(db, release, o, retry),
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
  confirmReleaseMock.mockClear();
  confirmWithdrawalRetryMock.mockClear();
  bundles.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  handlers = {
    worker_fail_stale_releases: () => ({ data: STALE }),
    worker_tenants_to_release: () => ({ data: [{ tenant_id: 't1' }] }),
    worker_deliveries_to_retry: () => ({ data: [] }),
    worker_private_orphans: () => ({ data: [] }),
    worker_claim_release_cleanup: () => ({ data: [] }),
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
      'worker_deliveries_to_retry',
      'deliverTenant t1',
      'worker_private_orphans',
      'worker_claim_release_cleanup',
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
    // Steps 2 to 5 still ran after the failures before them.
    expect(withoutRetryReads(order)).toEqual([
      'worker_fail_stale_releases',
      'processPendingRequests',
      'worker_tenants_to_release',
      'worker_deliveries_to_retry',
      'deliverTenant t1',
      'worker_private_orphans',
      'worker_claim_release_cleanup',
    ]);
  });

  // Security fix, Thread A (§8.4): every failed step alerts, once per step and sweep, with an hour
  // bucket of the sweep's clock for the email's incident key.
  it('alerts worker.step_failed once per failed step, with the step, its failure count and the hour', async () => {
    handlers.worker_fail_stale_releases = () => ({ error: { code: '57014', message: 'canceling statement due to statement timeout' } });
    handlers.worker_tenants_to_release = () => ({ data: [{ tenant_id: 't1' }, { tenant_id: 't2' }] });
    deliverTenantMock.mockRejectedValueOnce(new Error('t1 broke')).mockRejectedValueOnce(new Error('t2 broke'));

    await expect(runSweep(clock)).rejects.toThrow(AggregateError);

    expect(alertMock.mock.calls.filter((c) => c[0] === 'worker.step_failed')).toEqual([
      ['worker.step_failed', { step: 'stale_releases', failures: 1, bucket: '2026-11-03T12' }],
      ['worker.step_failed', { step: 'release', failures: 2, bucket: '2026-11-03T12' }],
    ]);
  });

  it('alerts no step failure when every step succeeds', async () => {
    handlers.worker_fail_stale_releases = () => ({ data: [] });

    await runSweep(clock);

    expect(alertMock.mock.calls.filter((c) => c[0] === 'worker.step_failed')).toEqual([]);
  });

  it('a failing orphan removal is reported like any other step', async () => {
    handlers.worker_private_orphans = () => ({ error: { code: '57014', message: 'canceling statement due to statement timeout' } });

    const error = await runSweep().then(
      () => null,
      (e: unknown) => e,
    );

    expect((error as AggregateError).errors.map((e: Error) => e.message)).toEqual([
      'worker_private_orphans: 57014 canceling statement due to statement timeout',
    ]);
  });

  it('a failing retention step is reported like any other step (M3-06)', async () => {
    handlers.worker_claim_release_cleanup = () => ({ error: { code: '57014', message: 'canceling statement due to statement timeout' } });

    const error = await runSweep().then(
      () => null,
      (e: unknown) => e,
    );

    expect((error as AggregateError).errors.map((e: Error) => e.message)).toEqual([
      'worker_claim_release_cleanup: 57014 canceling statement due to statement timeout',
    ]);
  });

  it('reads retention at its clock: the hour after delivery is the database\'s to decide (M3-06)', async () => {
    await runSweep(clock);

    expect(args.find((c) => c.fn === 'worker_claim_release_cleanup')?.args).toEqual({ p_now: '2026-11-03T12:00:00.000Z', p_limit: 20 });
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

  // Task 29 security r1, Minor 1: one tenant's build (and its pointer poll) no longer delays
  // another tenant's notify retries.
  describe('builds and retries per tenant', () => {
    const row = (tenant: string, release: number, site: string) => ({
      release_id: `rel-${tenant}-${release}`,
      tenant_id: tenant,
      tenant_slug: tenant,
      release_number: release,
      bundle_path: `${tenant}/releases/${release}.json`,
      previous_bundle_path: null,
      site_id: site,
      notify_status: 'failed',
      notify_attempts: 1,
      live_status: 'pending',
      requests: [],
    });
    const bundle = (tenant: string, release: number) => ({ format: 1, tenant, release, generatedAt: 'x', entries: {} });
    beforeEach(() => {
      for (const [t, n] of [['prufa', 3], ['demo', 8]] as const) bundles.set(`${t}/releases/${n}.json`, bundle(t, n));
    });

    it('a tenant with nothing to build retries at once, without waiting for another tenant’s build', async () => {
      handlers.worker_tenants_to_release = () => ({ data: [{ tenant_id: 'prufa' }] });
      handlers.worker_deliveries_to_retry = () => ({ data: [row('demo', 8, 'sd1'), row('demo', 8, 'sd2')] });
      let finishBuild!: () => void;
      deliverTenantMock.mockImplementationOnce(async (tenantId: string) => {
        order.push(`deliverTenant ${tenantId}`);
        await new Promise<void>((resolve) => (finishBuild = resolve));
        order.push(`delivered ${tenantId}`);
        return { status: 'delivered', releaseId: 'rel-prufa-4', omitted: [] };
      });

      const sweep = runSweep();
      await vi.waitFor(() => expect(confirmReleaseMock).toHaveBeenCalled());
      expect(order).toContain('confirmRelease demo #8 [sd1,sd2]');
      expect(order).not.toContain('delivered prufa');
      finishBuild();
      await sweep;

      expect(order.indexOf('confirmRelease demo #8 [sd1,sd2]')).toBeLessThan(order.indexOf('delivered prufa'));
    });

    it('a tenant whose build delivered a release drops the retries of the release it superseded', async () => {
      handlers.worker_tenants_to_release = () => ({ data: [{ tenant_id: 'prufa' }] });
      handlers.worker_deliveries_to_retry = () => ({ data: [row('prufa', 3, 'sp1')] });

      await runSweep();

      expect(order).toContain('deliverTenant prufa');
      expect(confirmReleaseMock).not.toHaveBeenCalled();
    });

    it('a tenant whose build did not deliver (busy, failed, nothing to build) retries after it', async () => {
      handlers.worker_tenants_to_release = () => ({ data: [{ tenant_id: 'prufa' }] });
      handlers.worker_deliveries_to_retry = () => ({ data: [row('prufa', 3, 'sp1')] });
      deliverTenantMock.mockImplementationOnce(async (tenantId: string) => {
        order.push(`deliverTenant ${tenantId}`);
        return { status: 'busy', omitted: [] };
      });

      await runSweep();

      expect(order.indexOf('deliverTenant prufa')).toBeLessThan(order.indexOf('confirmRelease prufa #3 [sp1]'));
    });

    it('a tenant whose build threw leaves its retries to the next sweep, and the error is reported', async () => {
      handlers.worker_tenants_to_release = () => ({ data: [{ tenant_id: 'prufa' }] });
      handlers.worker_deliveries_to_retry = () => ({ data: [row('prufa', 3, 'sp1'), row('demo', 8, 'sd1')] });
      deliverTenantMock.mockRejectedValueOnce(new Error('prufa broke'));

      const error = await runSweep().then(
        () => null,
        (e: unknown) => e,
      );

      expect((error as AggregateError).errors.map((e: Error) => e.message)).toEqual(['prufa broke']);
      expect(confirmReleaseMock.mock.calls.map((c) => c[1].tenantId)).toEqual(['demo']);
    });

    // W1: a superseded release's unconfirmed withdrawals.
    const withdrawalRow = (tenant: string, release: number, site: string, latest: number) => ({
      ...row(tenant, release, site),
      bundle_path: null,
      notify_status: 'ok',
      live_status: 'not_confirmed',
      notify_release_number: latest,
      withdrawal: { pending: [{ entryId: 'e1', requestIds: ['u1'], checks: [{ path: '/x', expect: 'absent' }], ownPath: '/x' }], withdrawn: [], others: false, alerted: false, hourOver: false },
    });

    it('checks a superseded release\'s withdrawals per site, without reading its bundles, while the tenant builds', async () => {
      handlers.worker_tenants_to_release = () => ({ data: [{ tenant_id: 'prufa' }] });
      handlers.worker_deliveries_to_retry = () => ({ data: [withdrawalRow('prufa', 2, 'sp1', 3), withdrawalRow('prufa', 2, 'sp2', 3), row('prufa', 3, 'sp1')] });

      await runSweep();

      expect(order).toContain('confirmWithdrawalRetry prufa #2→#3 [sp1,sp2]');
      const [, release, states] = confirmWithdrawalRetryMock.mock.calls[0]!;
      expect(release).toMatchObject({ tenantId: 'prufa', tenantSlug: 'prufa', releaseId: 'rel-prufa-2', number: 2, notifyRelease: 3 });
      expect(states.get('sp1')).toEqual(withdrawalRow('prufa', 2, 'sp1', 3).withdrawal);
      // The build delivered, so the latest release's own retry is dropped as before; the
      // withdrawal check is not (it is about an older release the build does not re-check).
      expect(confirmReleaseMock).not.toHaveBeenCalled();
      expect(order.filter((o) => o.startsWith('storage'))).toEqual([]);
    });

    it('a withdrawal check failing is reported like any other retry', async () => {
      handlers.worker_tenants_to_release = () => ({ data: [] });
      handlers.worker_deliveries_to_retry = () => ({ data: [withdrawalRow('demo', 7, 'sd1', 9)] });
      confirmWithdrawalRetryMock.mockRejectedValueOnce(new Error('demo site broke'));

      const error = await runSweep().then(
        () => null,
        (e: unknown) => e,
      );
      expect((error as AggregateError).errors.map((e: Error) => e.message)).toEqual(['demo site broke']);
      expect(alertMock).toHaveBeenCalledWith('worker.step_failed', expect.objectContaining({ step: 'delivery_retry' }));
    });

    it('when the tenants cannot be listed, the retries still run', async () => {
      handlers.worker_tenants_to_release = () => ({ error: { code: '08006', message: 'connection failure' } });
      handlers.worker_deliveries_to_retry = () => ({ data: [row('prufa', 3, 'sp1')] });

      await expect(runSweep()).rejects.toThrow(AggregateError);
      expect(deliverTenantMock).not.toHaveBeenCalled();
      expect(confirmReleaseMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('a withdrawal whose housekeeping hold ended unconfirmed (Thread E)', () => {
    const row = (over: Record<string, unknown> = {}) => ({
      tenant_id: 'prufa',
      unconfirmed_release_id: null,
      unconfirmed_release_number: null,
      unconfirmed_site_ids: null,
      ...over,
    });

    it('raises one delivery.withdrawal_unconfirmed alert per site the hold left unconfirmed, then builds', async () => {
      handlers.worker_fail_stale_releases = () => ({ data: [] });
      handlers.worker_tenants_to_release = () => ({
        data: [row({ unconfirmed_release_id: 'rel-7', unconfirmed_release_number: 7, unconfirmed_site_ids: ['s1', 's2'] })],
      });
      alertMock.mockImplementation(async (event: string) => {
        order.push(`alert ${event}`);
      });

      await runSweep(clock);

      expect(alertMock.mock.calls).toEqual([
        ['delivery.withdrawal_unconfirmed', { tenantId: 'prufa', releaseId: 'rel-7', number: 7, siteId: 's1' }],
        ['delivery.withdrawal_unconfirmed', { tenantId: 'prufa', releaseId: 'rel-7', number: 7, siteId: 's2' }],
      ]);
      // The alerts come first; the housekeeping release is built either way.
      const at = (step: string) => order.indexOf(step);
      expect(at('alert delivery.withdrawal_unconfirmed')).toBeGreaterThan(-1);
      expect(at('alert delivery.withdrawal_unconfirmed')).toBeLessThan(at('deliverTenant prufa'));
      alertMock.mockImplementation(async () => {});
    });

    it('marks each alerted site on its delivery, so the alert is not raised again (W1)', async () => {
      handlers.worker_fail_stale_releases = () => ({ data: [] });
      handlers.worker_tenants_to_release = () => ({
        data: [row({ unconfirmed_release_id: 'rel-7', unconfirmed_release_number: 7, unconfirmed_site_ids: ['s1', 's2'] })],
      });
      handlers.worker_record_delivery = () => ({ data: [] });

      await runSweep(clock);

      expect(args.filter((a) => a.fn === 'worker_record_delivery').map((a) => a.args)).toEqual(
        ['s1', 's2'].map((siteId) => ({
          p_release_id: 'rel-7',
          p_site_id: siteId,
          p_notify_status: null,
          p_live_status: null,
          p_error: { withdrawal_alerted: '2026-11-03T12:00:00.000Z' },
          p_now: '2026-11-03T12:00:00.000Z',
        })),
      );
    });

    it('raises nothing for a tenant listed without unconfirmed sites', async () => {
      handlers.worker_fail_stale_releases = () => ({ data: [] });
      handlers.worker_tenants_to_release = () => ({ data: [row(), row({ tenant_id: 'labak', unconfirmed_site_ids: [] })] });

      await runSweep(clock);

      expect(alertMock).not.toHaveBeenCalled();
      expect(deliverTenantMock.mock.calls.map((c) => c[0]).sort()).toEqual(['labak', 'prufa']);
    });
  });

  it('one tenant’s failing release does not stop the others', async () => {
    handlers.worker_tenants_to_release = () => ({ data: [{ tenant_id: 't1' }, { tenant_id: 't2' }] });
    deliverTenantMock.mockRejectedValueOnce(new Error('t1 broke'));

    await expect(runSweep()).rejects.toThrow(AggregateError);
    expect(deliverTenantMock.mock.calls.map((c) => c[0])).toEqual(['t1', 't2']);
  });
});
