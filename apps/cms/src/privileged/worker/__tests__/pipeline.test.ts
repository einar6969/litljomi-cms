// The worker's jobs set the run deadline the pointer poll is bounded by (decision 49.1).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  processRequestById: vi.fn(async (_id: string) => ({ status: 'committed', tenantId: 't1' })),
  deliverTenant: vi.fn(async (_tenantId: string, _options: Record<string, unknown>) => ({ status: 'delivered' })),
  runSweep: vi.fn(async (_options: Record<string, unknown>) => {}),
}));
vi.mock('../process-request', () => ({ processRequestById: (id: string) => mocks.processRequestById(id) }));
vi.mock('../deliver', () => ({ deliverTenant: (id: string, o: Record<string, unknown>) => mocks.deliverTenant(id, o) }));
vi.mock('../sweep', () => ({ runSweep: (o: Record<string, unknown>) => mocks.runSweep(o) }));

const { processAndDeliver, sweep } = await import('../pipeline');
const { WORKER_MAX_DURATION_MS } = await import('../../../lib/delivery');

const NOW = 1_800_000_000_000;
beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  mocks.deliverTenant.mockClear();
  mocks.runSweep.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('processAndDeliver', () => {
  it('sets the run deadline to its start plus the worker’s maximum duration', async () => {
    await processAndDeliver('q', { pollMs: 20 });
    expect(mocks.deliverTenant).toHaveBeenCalledWith('t1', { pollMs: 20, runDeadline: NOW + WORKER_MAX_DURATION_MS });
  });
  it('keeps a run deadline it is given', async () => {
    await processAndDeliver('q', { runDeadline: NOW + 5 });
    expect(mocks.deliverTenant).toHaveBeenCalledWith('t1', { runDeadline: NOW + 5 });
  });
});

describe('sweep', () => {
  it('sets the run deadline to its start plus the worker’s maximum duration', async () => {
    await sweep();
    expect(mocks.runSweep).toHaveBeenCalledWith({ runDeadline: NOW + WORKER_MAX_DURATION_MS });
  });
  it('keeps a run deadline it is given', async () => {
    await sweep({ runDeadline: NOW + 7 });
    expect(mocks.runSweep).toHaveBeenCalledWith({ runDeadline: NOW + 7 });
  });
});
