// The demo site's revalidation route (spec §7.3; plan Task 26, decision 48.2). A webhook expires the
// `cms` tag at once ({ expire: 0 }): with 'max' the regeneration after it would still render from
// the cached pointer (Next.js stale-while-revalidate), and one webhook would not be enough.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, signWebhook } from '@litljomi/cms-sdk';

const revalidateTag = vi.fn();
vi.mock('next/cache', () => ({ revalidateTag: (...args: unknown[]) => revalidateTag(...args) }));

const SECRET = 's'.repeat(32);
beforeEach(() => {
  vi.stubEnv('CMS_WEBHOOK_SECRETS', SECRET);
  revalidateTag.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/cms/revalidate', () => {
  it('expires the cms tag immediately on a signed webhook', async () => {
    const { POST } = await import('../route');
    const body = JSON.stringify({ tenant: 'demo', release: 8 });
    const stamp = Math.floor(Date.now() / 1000);
    const res = await POST(
      new Request('https://demo.test/api/cms/revalidate', {
        method: 'POST',
        body,
        headers: { [SIGNATURE_HEADER]: signWebhook(body, SECRET, stamp), [TIMESTAMP_HEADER]: String(stamp) },
      }),
    );
    expect(res.status).toBe(200);
    expect(revalidateTag).toHaveBeenCalledExactlyOnceWith('cms', { expire: 0 });
  });
  it('does not revalidate on a bad signature', async () => {
    const { POST } = await import('../route');
    const res = await POST(
      new Request('https://demo.test/api/cms/revalidate', {
        method: 'POST',
        body: '{}',
        headers: { [SIGNATURE_HEADER]: '0'.repeat(64), [TIMESTAMP_HEADER]: String(Math.floor(Date.now() / 1000)) },
      }),
    );
    expect(res.status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });
  it('reads CMS_WEBHOOK_SECRETS with spaces around the secrets (M3-09)', async () => {
    vi.stubEnv('CMS_WEBHOOK_SECRETS', ` ${'o'.repeat(32)} , ${SECRET} `);
    const { POST } = await import('../route');
    const body = JSON.stringify({ tenant: 'demo', release: 8 });
    const stamp = Math.floor(Date.now() / 1000);
    const res = await POST(
      new Request('https://demo.test/api/cms/revalidate', {
        method: 'POST',
        body,
        headers: { [SIGNATURE_HEADER]: signWebhook(body, SECRET, stamp), [TIMESTAMP_HEADER]: String(stamp) },
      }),
    );
    expect(res.status).toBe(200);
  });
  it('refuses CMS_WEBHOOK_SECRETS with an empty entry with a plain 500 (M3-09)', async () => {
    vi.stubEnv('CMS_WEBHOOK_SECRETS', `${SECRET},`);
    const { POST } = await import('../route');
    const body = '{}';
    const stamp = Math.floor(Date.now() / 1000);
    const res = await POST(
      new Request('https://demo.test/api/cms/revalidate', {
        method: 'POST',
        body,
        headers: { [SIGNATURE_HEADER]: signWebhook(body, SECRET, stamp), [TIMESTAMP_HEADER]: String(stamp) },
      }),
    );
    expect(res.status).toBe(500);
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});
