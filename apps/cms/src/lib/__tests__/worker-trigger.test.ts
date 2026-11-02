import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `server-only` throws when imported outside a React Server environment; Next.js resolves it for
// server code. In unit tests it is an empty module.
vi.mock('server-only', () => ({}));

const { triggerWorker } = await import('../worker-trigger');

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('CMS_PUBLIC_URL', 'https://cms.example.is');
  vi.stubEnv('CMS_INTERNAL_SECRET', 'innri-leynd');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('triggerWorker', () => {
  it('POSTs only the request ID to the internal worker route, with the internal secret', async () => {
    await triggerWorker('9b2f0a52-3c1e-4c8e-9a43-5f1d2e3b4c5d');

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('https://cms.example.is/api/internal/worker', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cms-internal-secret': 'innri-leynd' },
      body: JSON.stringify({ requestId: '9b2f0a52-3c1e-4c8e-9a43-5f1d2e3b4c5d' }),
      cache: 'no-store',
      redirect: 'manual',
    });
  });

  it('never follows a redirect with the secret: a 3xx answer is a failed trigger (Task 19 security r1)', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 307, headers: { location: 'https://elsewhere.example/' } }));
    await expect(triggerWorker('r')).rejects.toThrow('worker trigger failed: HTTP 307');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('joins the URL without a doubled slash when CMS_PUBLIC_URL ends with one', async () => {
    vi.stubEnv('CMS_PUBLIC_URL', 'https://cms.example.is/');
    await triggerWorker('r');
    expect(fetchMock.mock.calls[0]![0]).toBe('https://cms.example.is/api/internal/worker');
  });

  it('throws when the route does not accept the trigger (the sweep picks the request up later)', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    await expect(triggerWorker('r')).rejects.toThrow('worker trigger failed: HTTP 401');
  });

  it.each(['CMS_PUBLIC_URL', 'CMS_INTERNAL_SECRET'])('throws, naming the variable, when %s is not set', async (name) => {
    vi.stubEnv(name, '');
    await expect(triggerWorker('r')).rejects.toThrow(`${name} is not set`);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
