// Unit tests of the worker's error paths with a fake admin client (decision 35; spec §6.3). The
// happy paths and the database's outcomes run against the local stack in
// process-request.integration.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineModule, defineType, newsType, type FieldKind } from '@litljomi/cms-schema';

type Call = { fn: string; args: Record<string, unknown> };
type Reply = { data?: unknown; error?: { code: string; message: string } };

const calls: Call[] = [];
let handlers: Record<string, (args: Record<string, unknown>) => Reply> = {};
const fakeClient = {
  rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    const handler = handlers[fn];
    if (!handler) throw new Error(`unexpected rpc ${fn}`);
    const reply = handler(args);
    return { data: reply.data ?? null, error: reply.error ?? null };
  }),
};
vi.mock('../../admin-client', () => ({ createAdminClient: () => fakeClient }));

// A field whose validator overflows the stack, as a ~3,000-level rich-text document did before
// Task 15's depth cap (deferred Minor, Task 14 security r1).
const overflowing: FieldKind<unknown, unknown> = {
  kind: 'text',
  label: 'Djúpt',
  required: true,
  draftSchema: () => z.unknown(),
  publishSchema: () =>
    z.unknown().transform(() => {
      throw new RangeError('Maximum call stack size exceeded');
    }),
  project: (v) => v,
  tsType: () => 'unknown',
  withOptions: () => overflowing,
};
const deepType = defineType({
  name: 'deep',
  version: 1,
  label: 'Deep',
  fields: { title: overflowing },
  preview: { title: 'title' },
  orderBy: 'title',
});
const testModule = defineModule({
  tenant: 'prufa',
  locale: 'is',
  branding: { name: 'Prufa' },
  types: [newsType, deepType],
  structure: [],
  site: {},
});
vi.mock('@/modules/registry', () => ({
  getModule: (slug: string) => (slug === 'prufa' ? testModule : undefined),
  getType: (slug: string, type: string) => (slug === 'prufa' ? testModule.types.find((t) => t.name === type) : undefined),
}));

const { processPendingRequests, processRequestById } = await import('../process-request');

const IMAGE = '11111111-1111-4111-8111-111111111111';
const claimed = (o: Partial<{ id: string; attempts: number; action: string }> = {}) => ({
  id: o.id ?? 'r1',
  tenant_id: 't1',
  entry_id: 'e1',
  action: o.action ?? 'publish',
  draft_version: 2,
  status: 'validating',
  attempts: o.attempts ?? 1,
});
const read = (o: { type?: string; data?: unknown; id?: string; action?: string } = {}) => ({
  request: claimed({ id: o.id, action: o.action }),
  entry: { id: 'e1', tenant_id: 't1', type: o.type ?? 'news', slug: 'frett' },
  tenant: { id: 't1', slug: 'prufa', status: 'active' },
  draft: {
    data: o.data ?? { title: 'T', date: '2026-10-15', image: { _ref: IMAGE, _kind: 'asset', alt: '' } },
    version: 2,
    schema_version: 1,
  },
  refs: [],
});
const dbError = (code: string, message: string): Reply => ({ error: { code, message } });

beforeEach(() => {
  calls.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const called = (fn: string) => calls.filter((c) => c.fn === fn);

describe('processRequestById', () => {
  it('treats a RangeError from validation (stack overflow on deep nesting) as failed validation', async () => {
    handlers = {
      worker_claim_request: () => ({ data: claimed() }),
      worker_read_request: () => ({ data: read({ type: 'deep', data: { title: 'x' } }) }),
      worker_reject_request: () => ({}),
    };

    const outcome = await processRequestById('r1');

    expect(outcome).toMatchObject({ status: 'failed_validation', errors: { code: 'too_deep' } });
    expect(called('worker_reject_request')).toEqual([
      { fn: 'worker_reject_request', args: { p_request_id: 'r1', p_status: 'failed_validation', p_error: { code: 'too_deep' } } },
    ]);
    expect(called('worker_commit_publish')).toEqual([]);
  });

  it('leaves the request validating after an unexpected error below 5 attempts, so the re-claim retries it', async () => {
    handlers = {
      worker_claim_request: () => ({ data: claimed({ attempts: 4 }) }),
      worker_read_request: () => ({ data: read() }),
      worker_commit_publish: () => dbError('XX000', 'connection reset'),
    };

    await expect(processRequestById('r1')).rejects.toThrow('worker_commit_publish: XX000 connection reset');
    expect(called('worker_reject_request')).toEqual([]);
    expect(called('worker_record_alert')).toEqual([]);
  });

  it('fails the request and alerts at the 5th attempt', async () => {
    handlers = {
      worker_claim_request: () => ({ data: claimed({ attempts: 5 }) }),
      worker_read_request: () => ({ data: read() }),
      worker_commit_publish: () => dbError('XX000', 'connection reset'),
      worker_reject_request: () => ({}),
      worker_record_alert: () => ({}),
    };

    const outcome = await processRequestById('r1');

    const error = { code: 'unexpected', attempts: 5, message: 'worker_commit_publish: XX000 connection reset' };
    expect(outcome).toEqual({
      requestId: 'r1',
      tenantId: 't1',
      tenantSlug: 'prufa',
      entryId: 'e1',
      action: 'publish',
      type: 'news',
      status: 'failed',
      errors: error,
    });
    expect(called('worker_reject_request')).toEqual([
      { fn: 'worker_reject_request', args: { p_request_id: 'r1', p_status: 'failed', p_error: error } },
    ]);
    expect(called('worker_record_alert')).toEqual([
      {
        fn: 'worker_record_alert',
        args: {
          p_tenant_id: 't1',
          p_event: 'publish_request.failed',
          p_details: { tenantId: 't1', requestId: 'r1', entryId: 'e1', action: 'publish', ...error },
        },
      },
    ]);
    expect(console.error).toHaveBeenCalledWith('[cms-alert] publish_request.failed', expect.objectContaining({ requestId: 'r1' }));
  });

  it.each(['forbidden', 'not_found'])('reports %s from the commit (a concurrent re-claim) as skipped', async (message) => {
    handlers = {
      worker_claim_request: () => ({ data: claimed() }),
      worker_read_request: () => ({ data: read() }),
      worker_commit_publish: () => dbError('P0001', message),
    };

    const outcome = await processRequestById('r1');

    expect(outcome).toMatchObject({ requestId: 'r1', status: 'skipped' });
    expect(called('worker_reject_request')).toEqual([]);
  });

  it('reports forbidden from the unpublish commit as skipped', async () => {
    handlers = {
      worker_claim_request: () => ({ data: claimed({ action: 'unpublish' }) }),
      worker_read_request: () => ({ data: read({ action: 'unpublish' }) }),
      worker_commit_unpublish: () => dbError('P0001', 'forbidden'),
    };

    expect(await processRequestById('r1')).toMatchObject({ action: 'unpublish', status: 'skipped' });
  });

  it('reports forbidden from a rejection (the request was finished meanwhile) as skipped', async () => {
    handlers = {
      worker_claim_request: () => ({ data: claimed() }),
      worker_read_request: () => ({ data: read({ type: 'unknown' }) }),
      worker_reject_request: () => dbError('P0001', 'forbidden'),
    };

    expect(await processRequestById('r1')).toMatchObject({ status: 'skipped' });
  });

  it('a P0001 error other than forbidden or not_found is unexpected', async () => {
    handlers = {
      worker_claim_request: () => ({ data: claimed() }),
      worker_read_request: () => ({ data: read() }),
      worker_commit_publish: () => dbError('P0001', 'tenant_inactive'),
    };

    await expect(processRequestById('r1')).rejects.toThrow('tenant_inactive');
  });

  it('skips a request the claim did not return (a row of nulls), reading it for the outcome', async () => {
    handlers = {
      worker_claim_request: () => ({
        data: { id: null, tenant_id: null, entry_id: null, action: null, draft_version: null, status: null, attempts: null },
      }),
      worker_read_request: () => ({ data: read() }),
    };

    expect(await processRequestById('r1')).toEqual({
      requestId: 'r1',
      tenantId: 't1',
      tenantSlug: 'prufa',
      entryId: 'e1',
      action: 'publish',
      type: 'news',
      status: 'skipped',
    });
  });

  it('throws for a request that does not exist', async () => {
    handlers = {
      worker_claim_request: () => ({ data: { id: null } }),
      worker_read_request: () => dbError('P0001', 'not_found'),
    };

    await expect(processRequestById('r1')).rejects.toThrow('not_found');
  });

  it('commits with the version and schema version it validated, and queryColumns title and sortAt', async () => {
    handlers = {
      worker_claim_request: () => ({ data: claimed() }),
      worker_read_request: () => ({ data: read() }),
      worker_commit_publish: () => ({ data: 'committed' }),
    };

    expect(await processRequestById('r1')).toMatchObject({ status: 'committed' });
    expect(called('worker_commit_publish')).toEqual([
      {
        fn: 'worker_commit_publish',
        args: { p_request_id: 'r1', p_validated_draft_version: 2, p_validated_schema_version: 1, p_title: 'T', p_sort_at: '2026-10-15' },
      },
    ]);
  });
});

describe('processPendingRequests', () => {
  it('claims up to the limit and processes each; one unexpected error does not stop the others', async () => {
    handlers = {
      worker_claim_requests: () => ({ data: [claimed({ id: 'r1' }), claimed({ id: 'r2' })] }),
      worker_read_request: ({ p_request_id }) => (p_request_id === 'r1' ? dbError('XX000', 'boom') : { data: read({ id: 'r2' }) }),
      worker_commit_publish: () => ({ data: 'committed' }),
    };

    const outcomes = await processPendingRequests(7);

    expect(called('worker_claim_requests')).toEqual([{ fn: 'worker_claim_requests', args: { p_limit: 7 } }]);
    expect(outcomes.map((o) => [o.requestId, o.status])).toEqual([['r2', 'committed']]);
    expect(console.error).toHaveBeenCalledWith('[cms-worker] request r1 failed (attempt 1 of 5); left for retry', expect.any(Error));
  });

  it('claims 10 by default', async () => {
    handlers = { worker_claim_requests: () => ({ data: [] }) };

    expect(await processPendingRequests()).toEqual([]);
    expect(called('worker_claim_requests')).toEqual([{ fn: 'worker_claim_requests', args: { p_limit: 10 } }]);
  });
});
