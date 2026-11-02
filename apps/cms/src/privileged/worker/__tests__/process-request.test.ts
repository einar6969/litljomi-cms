// Unit tests of the worker's error paths with a fake admin client (decision 35; spec §6.3). The
// happy paths and the database's outcomes run against the local stack in
// process-request.integration.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ProjectionError, defineModule, defineType, newsType, type FieldKind } from '@litljomi/cms-schema';

type Call = { fn: string; args: Record<string, unknown> };
type Reply = { data?: unknown; error?: { code: string; message: string } };

const calls: Call[] = [];
let handlers: Record<string, (args: Record<string, unknown>) => Reply> = {};
/** Storage objects the fake client's `exists` finds, as `bucket/path`. */
const stored = new Set<string>();
const fakeClient = {
  rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    const handler = handlers[fn];
    if (!handler) throw new Error(`unexpected rpc ${fn}`);
    const reply = handler(args);
    return { data: reply.data ?? null, error: reply.error ?? null };
  }),
  storage: {
    from: (bucket: string) => ({
      exists: async (path: string) => {
        calls.push({ fn: 'storage.exists', args: { bucket, path } });
        return stored.has(`${bucket}/${path}`) ? { data: true, error: null } : { data: false, error: { message: 'Object not found', status: 404 } };
      },
    }),
  },
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
// Fields that validate but whose projection throws: a ProjectionError (as projectEntry raises when
// its own validation fails) and a RangeError (a projection recursing past the stack).
const projectionIssue: z.core.$ZodIssue = { code: 'custom', path: ['title', 0], message: 'cannot project', input: 'x' };
const throwingProjection = (thrown: () => Error): FieldKind<unknown, unknown> => {
  const field: FieldKind<unknown, unknown> = {
    ...overflowing,
    publishSchema: () => z.unknown(),
    project: () => {
      throw thrown();
    },
    withOptions: () => field,
  };
  return field;
};
const unprojectableType = defineType({
  name: 'unprojectable',
  version: 1,
  label: 'Unprojectable',
  fields: { title: throwingProjection(() => new ProjectionError('unprojectable', [projectionIssue])) },
  preview: { title: 'title' },
  orderBy: 'title',
});
const deepProjectionType = defineType({
  name: 'deep-projection',
  version: 1,
  label: 'Deep projection',
  fields: { title: throwingProjection(() => new RangeError('Maximum call stack size exceeded')) },
  preview: { title: 'title' },
  orderBy: 'title',
});
const testModule = defineModule({
  tenant: 'prufa',
  locale: 'is',
  branding: { name: 'Prufa' },
  types: [newsType, deepType, unprojectableType, deepProjectionType],
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
  stored.clear();
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

  it('stores projection_failed with the issues when the projection throws a ProjectionError, and does not commit', async () => {
    handlers = {
      worker_claim_request: () => ({ data: claimed() }),
      worker_read_request: () => ({ data: read({ type: 'unprojectable', data: { title: 'x' } }) }),
      worker_reject_request: () => ({}),
    };

    const outcome = await processRequestById('r1');

    const error = {
      code: 'projection_failed',
      issues: [{ code: 'custom', path: ['title', 0], message: 'cannot project' }],
    };
    expect(outcome).toMatchObject({ status: 'failed_validation', errors: error });
    expect(called('worker_reject_request')).toEqual([
      { fn: 'worker_reject_request', args: { p_request_id: 'r1', p_status: 'failed_validation', p_error: error } },
    ]);
    expect(called('worker_commit_publish')).toEqual([]);
  });

  it('treats a RangeError from the projection as failed validation too_deep, and does not commit', async () => {
    handlers = {
      worker_claim_request: () => ({ data: claimed() }),
      worker_read_request: () => ({ data: read({ type: 'deep-projection', data: { title: 'x' } }) }),
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

    // Editors can read the stored error: a stable code only. The database message goes only to
    // the log and the alert (service_role and platform admins).
    const error = { code: 'unexpected', attempts: 5 };
    const message = 'worker_commit_publish: XX000 connection reset';
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
          p_details: { tenantId: 't1', requestId: 'r1', entryId: 'e1', action: 'publish', ...error, message },
        },
      },
    ]);
    expect(console.error).toHaveBeenCalledWith('[cms-alert] publish_request.failed', expect.objectContaining({ requestId: 'r1' }));
  });

  it('still returns failed when the alert cannot be recorded', async () => {
    handlers = {
      worker_claim_request: () => ({ data: claimed({ attempts: 5 }) }),
      worker_read_request: () => ({ data: read() }),
      worker_commit_publish: () => dbError('XX000', 'connection reset'),
      worker_reject_request: () => ({}),
      worker_record_alert: () => dbError('XX000', 'audit down'),
    };

    expect(await processRequestById('r1')).toMatchObject({ status: 'failed', errors: { code: 'unexpected', attempts: 5 } });
    expect(console.error).toHaveBeenCalledWith('[cms-alert] could not record publish_request.failed in the audit log', expect.any(Error));
  });

  it('returns the committed status without errors when the re-read for the errors fails', async () => {
    let reads = 0;
    handlers = {
      worker_claim_request: () => ({ data: claimed() }),
      worker_read_request: () => (++reads === 1 ? { data: read() } : dbError('XX000', 'connection reset')),
      worker_commit_publish: () => ({ data: 'superseded' }),
    };

    const outcome = await processRequestById('r1');

    expect(outcome).toEqual({
      requestId: 'r1',
      tenantId: 't1',
      tenantSlug: 'prufa',
      entryId: 'e1',
      action: 'publish',
      type: 'news',
      status: 'superseded',
    });
    expect(called('worker_reject_request')).toEqual([]);
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/^\[cms-worker\] request r1 .*superseded/), expect.any(Error));
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

  it('logs and alerts when the 5th attempt cannot store failed, and continues with the other requests', async () => {
    handlers = {
      worker_claim_requests: () => ({ data: [claimed({ id: 'r1', attempts: 5 }), claimed({ id: 'r2' })] }),
      worker_read_request: ({ p_request_id }) => ({ data: read({ id: p_request_id as string }) }),
      worker_commit_publish: ({ p_request_id }) => (p_request_id === 'r1' ? dbError('XX000', 'connection reset') : { data: 'committed' }),
      worker_reject_request: () => dbError('XX000', 'database down'),
      worker_record_alert: () => ({}),
    };

    const outcomes = await processPendingRequests();

    expect(outcomes.map((o) => [o.requestId, o.status])).toEqual([['r2', 'committed']]);
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/^\[cms-worker\] request r1 /), expect.any(Error));
    expect(called('worker_record_alert')).toEqual([
      {
        fn: 'worker_record_alert',
        args: {
          p_tenant_id: 't1',
          p_event: 'publish_request.failed',
          p_details: {
            tenantId: 't1',
            requestId: 'r1',
            entryId: 'e1',
            action: 'publish',
            code: 'unexpected',
            attempts: 5,
            message: 'worker_commit_publish: XX000 connection reset',
            stored: false,
            storeError: 'worker_reject_request: XX000 database down',
          },
        },
      },
    ]);
  });

  it('claims 10 by default', async () => {
    handlers = { worker_claim_requests: () => ({ data: [] }) };

    expect(await processPendingRequests()).toEqual([]);
    expect(called('worker_claim_requests')).toEqual([{ fn: 'worker_claim_requests', args: { p_limit: 10 } }]);
  });
});

// Task 30 (decision 36.4): before committing a publish, the private original of every asset the
// draft references without a public path must exist in media-private.
describe('processRequestById: private originals', () => {
  const TENANT_ID = '00000000-0000-4000-8000-00000000a001';
  const A1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const A2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
  const A3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
  const A4 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
  const A5 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';
  const assetRef = (id: string, o: Record<string, unknown> = {}) => ({
    path: `$."x${id.slice(-1)}"`,
    kind: 'asset',
    id,
    published: false,
    archived: false,
    filename: 'a.jpg',
    mime: 'image/jpeg',
    width: 800,
    height: 600,
    focal_x: null,
    focal_y: null,
    default_alt: null,
    public_path: null,
    ...o,
  });
  // A1, A2: not public yet (checked); A3: public already; A4: archived; A5: not in the tenant
  // (all null: the commit refuses it as an invalid reference).
  const refs = [
    assetRef(A1),
    assetRef(A2, { filename: 'b.png' }),
    assetRef(A3, { published: true, public_path: `prufa/${A3}/a.jpg` }),
    assetRef(A4, { archived: true }),
    { path: '$."x5"', kind: 'asset', id: A5, published: false, archived: false, filename: null, mime: null, width: null, height: null, focal_x: null, focal_y: null, default_alt: null, public_path: null },
  ];
  const readWithRefs = () => {
    const r = read();
    return { ...r, request: { ...r.request, tenant_id: TENANT_ID }, tenant: { ...r.tenant, id: TENANT_ID }, refs };
  };
  const exists = (...present: string[]) => {
    const asked: string[] = [];
    return {
      asked,
      originalExists: async (path: string) => {
        asked.push(path);
        return present.includes(path);
      },
    };
  };

  beforeEach(() => {
    handlers = {
      worker_claim_request: () => ({ data: claimed() }),
      worker_read_request: () => ({ data: readWithRefs() }),
      worker_reject_request: () => ({}),
      worker_record_alert: () => ({}),
      worker_commit_publish: () => ({ data: 'committed' }),
    };
  });

  it('a missing original fails the request with asset_missing and an alert, and never commits', async () => {
    const check = exists(`${TENANT_ID}/${A2}/b.png`);

    const outcome = await processRequestById('r1', { originalExists: check.originalExists });

    const error = { code: 'asset_missing', assetIds: [A1] };
    expect(outcome).toMatchObject({ status: 'failed_validation', errors: error });
    // Only the assets that are not public yet, not archived and in the tenant are looked up.
    expect(check.asked).toEqual([`${TENANT_ID}/${A1}/a.jpg`, `${TENANT_ID}/${A2}/b.png`]);
    expect(called('worker_reject_request')).toEqual([
      { fn: 'worker_reject_request', args: { p_request_id: 'r1', p_status: 'failed_validation', p_error: error } },
    ]);
    expect(called('worker_commit_publish')).toEqual([]);
    expect(called('worker_record_alert')).toEqual([
      {
        fn: 'worker_record_alert',
        args: {
          p_tenant_id: TENANT_ID,
          p_event: 'publish_request.asset_missing',
          p_details: { tenantId: TENANT_ID, requestId: 'r1', entryId: 'e1', assetIds: [A1] },
        },
      },
    ]);
  });

  it('lists every missing original', async () => {
    const outcome = await processRequestById('r1', { originalExists: exists().originalExists });
    expect(outcome).toMatchObject({ status: 'failed_validation', errors: { code: 'asset_missing', assetIds: [A1, A2] } });
  });

  it('commits when every original is there', async () => {
    const check = exists(`${TENANT_ID}/${A1}/a.jpg`, `${TENANT_ID}/${A2}/b.png`);
    expect(await processRequestById('r1', { originalExists: check.originalExists })).toMatchObject({ status: 'committed' });
    expect(called('worker_reject_request')).toEqual([]);
    expect(called('worker_record_alert')).toEqual([]);
  });

  it('by default looks the originals up in media-private through the admin client', async () => {
    stored.add(`media-private/${TENANT_ID}/${A1}/a.jpg`);

    const outcome = await processRequestById('r1');

    expect(outcome).toMatchObject({ status: 'failed_validation', errors: { code: 'asset_missing', assetIds: [A2] } });
    expect(called('storage.exists').map((c) => c.args)).toEqual([
      { bucket: 'media-private', path: `${TENANT_ID}/${A1}/a.jpg` },
      { bucket: 'media-private', path: `${TENANT_ID}/${A2}/b.png` },
    ]);
  });

  it('a lookup that fails is an unexpected error (retried by the re-claim), not a missing file', async () => {
    const originalExists = async () => {
      throw new Error('storage unavailable');
    };
    await expect(processRequestById('r1', { originalExists })).rejects.toThrow('storage unavailable');
    expect(called('worker_reject_request')).toEqual([]);
    expect(called('worker_commit_publish')).toEqual([]);
  });

  it('an exists() answer that is neither true nor false (an error without a verdict) fails instead of counting as missing', async () => {
    vi.spyOn(fakeClient.storage, 'from').mockReturnValue({
      exists: async () => ({ data: null, error: { message: 'storage down' } }),
    } as unknown as ReturnType<typeof fakeClient.storage.from>);

    await expect(processRequestById('r1')).rejects.toThrow(/storage down/);
    expect(called('worker_reject_request')).toEqual([]);
  });

  it('checks the originals with bounded parallelism and reports the missing ones in reference order', async () => {
    const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    const many = Array.from({ length: 21 }, (_, i) => assetRef(id(i + 1)));
    handlers.worker_read_request = () => ({ data: { ...readWithRefs(), refs: many } });
    let inFlight = 0;
    let peak = 0;
    const originalExists = async (path: string) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight -= 1;
      return !path.includes(id(3)) && !path.includes(id(20));
    };

    const outcome = await processRequestById('r1', { originalExists });

    expect(outcome).toMatchObject({ status: 'failed_validation', errors: { code: 'asset_missing', assetIds: [id(3), id(20)] } });
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(8);
  });

  it('a request whose draft moved on is not checked (the commit records superseded)', async () => {
    handlers.worker_read_request = () => ({ data: { ...readWithRefs(), draft: { ...readWithRefs().draft, version: 3 } } });
    handlers.worker_commit_publish = () => ({ data: 'superseded' });
    const check = exists();
    expect((await processRequestById('r1', { originalExists: check.originalExists })).status).toBe('superseded');
    expect(check.asked).toEqual([]);
  });

  it('processPendingRequests passes the lookup on', async () => {
    handlers.worker_claim_requests = () => ({ data: [claimed()] });
    const outcomes = await processPendingRequests(1, { originalExists: exists().originalExists });
    expect(outcomes.map((o) => o.status)).toEqual(['failed_validation']);
  });
});
