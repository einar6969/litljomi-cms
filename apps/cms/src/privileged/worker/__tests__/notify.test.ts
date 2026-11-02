// notifySite (spec §7.3, §7.4, §8.2; plan Task 21, decision 35) against a local fake site.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifyWebhook } from '@litljomi/cms-sdk';
import { notifySite } from '../notify';
import { startFakeSite, type FakeSite } from './fake-site';

let site: FakeSite;
beforeEach(async () => {
  site = await startFakeSite();
  site.pages.set('/api/cms/revalidate', { status: 200, html: '{"revalidated":true}' });
});
afterEach(async () => {
  await site.close();
});

const target = (secrets = ['leynd-1', 'leynd-2']) => ({ revalidate_url: `${site.origin}/api/cms/revalidate`, webhook_secrets: secrets });

describe('notifySite', () => {
  it('POSTs {tenant, release} signed with the first secret; the site verifies it with verifyWebhook', async () => {
    const result = await notifySite(target(), { tenant: 'labak', release: 7 });

    expect(result).toEqual({ ok: true, status: 200 });
    expect(site.requests).toHaveLength(1);
    const call = site.requests[0]!;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/api/cms/revalidate');
    expect(call.headers['content-type']).toBe('application/json');
    expect(JSON.parse(call.body.toString('utf8'))).toEqual({ tenant: 'labak', release: 7 });
    const signature = String(call.headers[SIGNATURE_HEADER]);
    const timestamp = Number(call.headers[TIMESTAMP_HEADER]);
    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(Math.abs(nowSeconds - timestamp)).toBeLessThan(5);
    expect(verifyWebhook({ body: call.body, signature, timestamp, secrets: ['leynd-1'], nowSeconds })).toBe(true);
    // Signed with webhook_secrets[0] only.
    expect(verifyWebhook({ body: call.body, signature, timestamp, secrets: ['leynd-2'], nowSeconds })).toBe(false);
  });

  it('is not ok on a non-2xx answer, with its status', async () => {
    site.pages.set('/api/cms/revalidate', { status: 401, html: '{}' });
    expect(await notifySite(target(), { tenant: 'labak', release: 1 })).toEqual({ ok: false, status: 401 });
  });

  it('refuses an empty secret list without calling the site (recorded as failed by the caller)', async () => {
    expect(await notifySite(target([]), { tenant: 'labak', release: 1 })).toEqual({ ok: false, status: 0 });
    expect(await notifySite(target(['']), { tenant: 'labak', release: 1 })).toEqual({ ok: false, status: 0 });
    expect(site.requests).toHaveLength(0);
  });

  it('gives up after its timeout', async () => {
    site.handler = () => 'hang';
    const started = Date.now();
    expect(await notifySite(target(), { tenant: 'labak', release: 1 }, { timeoutMs: 200 })).toEqual({ ok: false, status: 0 });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('is not ok when the site cannot be reached', async () => {
    const url = target().revalidate_url;
    await site.close();
    expect(await notifySite({ revalidate_url: url, webhook_secrets: ['s'] }, { tenant: 'labak', release: 1 })).toEqual({ ok: false, status: 0 });
    site = await startFakeSite();
  });

  it('does not follow a redirect (the signed request goes only to the revalidate URL)', async () => {
    site.pages.set('/api/cms/revalidate', { status: 307, headers: { location: `${site.origin}/elsewhere` } });
    site.pages.set('/elsewhere', { status: 200 });
    expect(await notifySite(target(), { tenant: 'labak', release: 1 })).toEqual({ ok: false, status: 307 });
    expect(site.hits('/elsewhere')).toBe(0);
  });
});
