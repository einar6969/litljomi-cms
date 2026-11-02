import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The jobs are faked: the real pipeline is Task 21's. The fakes are hoisted rather than imported,
// because only the two route files may import from privileged/.
const pipeline = vi.hoisted(() => ({
  processAndDeliver: vi.fn<(requestId: string) => Promise<void>>(),
  sweep: vi.fn<() => Promise<void>>(),
}));
vi.mock('@/privileged/worker/pipeline', () => pipeline);
// after() needs a Next.js request scope; the fake records the callback so a test can run it.
const scheduled: Array<() => unknown> = [];
vi.mock('next/server', () => ({
  after: vi.fn((task: () => unknown) => {
    scheduled.push(task);
  }),
}));

const { after } = await import('next/server');
const worker = await import('../internal/worker/route');
const cron = await import('../cron/sweep/route');

const INTERNAL = 'internal-secret-0123456789';
const CRON = 'cron-secret-0123456789';
const REQUEST_ID = '0b5d4c1e-2f3a-4b5c-8d7e-9f0a1b2c3d4e';

/** `secret: null` sends no secret header. */
const workerRequest = (body: unknown, secret: string | null = INTERNAL) =>
  new Request('http://localhost/api/internal/worker', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(secret === null ? {} : { 'x-cms-internal-secret': secret }) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

/** A request whose URL, query and body throw when read: the cron route must need none of them. */
class HeadersOnlyRequest extends Request {
  override get url(): string {
    throw new Error('the cron route read the URL');
  }
  override get body(): Request['body'] {
    throw new Error('the cron route read the body');
  }
  override json(): Promise<unknown> {
    throw new Error('the cron route read the body');
  }
  override text(): Promise<string> {
    throw new Error('the cron route read the body');
  }
  override formData(): Promise<FormData> {
    throw new Error('the cron route read the body');
  }
  override arrayBuffer(): ReturnType<Request['arrayBuffer']> {
    throw new Error('the cron route read the body');
  }
}
const cronRequest = (authorization?: string) =>
  new HeadersOnlyRequest(`http://localhost/api/cron/sweep?requestId=${REQUEST_ID}`, {
    headers: authorization === undefined ? {} : { authorization },
  });

beforeEach(() => {
  vi.stubEnv('CMS_INTERNAL_SECRET', INTERNAL);
  vi.stubEnv('CRON_SECRET', CRON);
  scheduled.length = 0;
  vi.mocked(after).mockClear();
  pipeline.processAndDeliver.mockReset().mockResolvedValue(undefined);
  pipeline.sweep.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/internal/worker', () => {
  it('sets maxDuration to 300', () => {
    expect(worker.maxDuration).toBe(300);
  });
  it('returns 202 and runs processAndDeliver(requestId) after the response', async () => {
    const res = await worker.POST(workerRequest({ requestId: REQUEST_ID }));
    expect(res.status).toBe(202);
    expect(after).toHaveBeenCalledTimes(1);
    expect(pipeline.processAndDeliver).not.toHaveBeenCalled();
    await scheduled[0]!();
    expect(pipeline.processAndDeliver).toHaveBeenCalledExactlyOnceWith(REQUEST_ID);
  });
  it.each([
    ['without the header', null],
    ['with a wrong secret', INTERNAL.slice(0, -1) + 'x'],
    ['with a secret of another length', 'short'],
    ['with the cron secret', CRON],
  ])('returns 401 %s and schedules nothing', async (_label, secret) => {
    const res = await worker.POST(workerRequest({ requestId: REQUEST_ID }, secret));
    expect(res.status).toBe(401);
    expect(after).not.toHaveBeenCalled();
    expect(pipeline.processAndDeliver).not.toHaveBeenCalled();
  });
  it('returns 401 when CMS_INTERNAL_SECRET is not set', async () => {
    vi.stubEnv('CMS_INTERNAL_SECRET', undefined);
    const res = await worker.POST(workerRequest({ requestId: REQUEST_ID }, ''));
    expect(res.status).toBe(401);
    expect(after).not.toHaveBeenCalled();
  });
  // Raw request bodies.
  it.each([
    ['malformed JSON', '{"requestId":'],
    ['an empty body', ''],
    ['a JSON array', JSON.stringify([REQUEST_ID])],
    ['a bare string', JSON.stringify(REQUEST_ID)],
    ['null', 'null'],
    ['a missing requestId', '{}'],
    ['a non-string requestId', JSON.stringify({ requestId: 42 })],
    ['a non-UUID requestId', JSON.stringify({ requestId: 'not-a-uuid' })],
    ['an upper-case UUID', JSON.stringify({ requestId: REQUEST_ID.toUpperCase() })],
    ['an extra key', JSON.stringify({ requestId: REQUEST_ID, tenantId: REQUEST_ID })],
  ])('returns 400 for %s and schedules nothing', async (_label, body) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await worker.POST(workerRequest(body));
    expect(res.status).toBe(400);
    expect(after).not.toHaveBeenCalled();
    // Logged without the body (Task 17 quality r1).
    expect(warn).toHaveBeenCalledOnce();
    if (body !== '') expect(JSON.stringify(warn.mock.calls)).not.toContain(body);
  });
  it('checks the secret before reading the body', async () => {
    const res = await worker.POST(workerRequest('{"requestId":', 'wrong'));
    expect(res.status).toBe(401);
  });
  it('logs a [cms-alert] instead of throwing when the job fails after the response', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    pipeline.processAndDeliver.mockRejectedValue(new Error('boom'));
    const res = await worker.POST(workerRequest({ requestId: REQUEST_ID }));
    expect(res.status).toBe(202);
    await expect(Promise.resolve(scheduled[0]!())).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/^\[cms-alert\]/), expect.objectContaining({ requestId: REQUEST_ID }), expect.any(Error));
  });
});

describe('GET /api/cron/sweep', () => {
  it('sets maxDuration to 300', () => {
    expect(cron.maxDuration).toBe(300);
  });
  it('returns 200 and runs sweep() with no arguments, reading neither the URL nor the body', async () => {
    const res = await cron.GET(cronRequest(`Bearer ${CRON}`));
    expect(res.status).toBe(200);
    expect(pipeline.sweep).toHaveBeenCalledExactlyOnceWith();
    expect(pipeline.processAndDeliver).not.toHaveBeenCalled();
  });
  it.each([
    ['without Authorization', undefined],
    ['with a wrong secret', `Bearer ${CRON.slice(0, -1)}x`],
    ['with a secret of another length', 'Bearer short'],
    ['with the internal secret', `Bearer ${INTERNAL}`],
    ['with the bare secret', CRON],
  ])('returns 401 %s and does not sweep', async (_label, authorization) => {
    const res = await cron.GET(cronRequest(authorization));
    expect(res.status).toBe(401);
    expect(pipeline.sweep).not.toHaveBeenCalled();
  });
  it('returns 401 when CRON_SECRET is not set', async () => {
    vi.stubEnv('CRON_SECRET', undefined);
    const res = await cron.GET(cronRequest('Bearer undefined'));
    expect(res.status).toBe(401);
    expect(pipeline.sweep).not.toHaveBeenCalled();
  });
  it('returns 500 and logs a [cms-alert] when the sweep fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    pipeline.sweep.mockRejectedValue(new Error('boom'));
    const res = await cron.GET(cronRequest(`Bearer ${CRON}`));
    expect(res.status).toBe(500);
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/^\[cms-alert\]/), expect.any(Error));
  });
});

describe('vercel.json', () => {
  it('schedules the sweep every minute', () => {
    const config = JSON.parse(readFileSync(new URL('../../../../vercel.json', import.meta.url), 'utf8'));
    expect(config).toEqual({ crons: [{ path: '/api/cron/sweep', schedule: '* * * * *' }] });
  });
});
