import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseEntryMarkers, parseReleaseMarker, signWebhook, type Bundle } from '@litljomi/cms-sdk';
import { FIXTURES_ROOT } from './fixture-server.ts';
import { startSite, WEBHOOK_SECRETS, type RunningSite } from './harness.ts';

const bundle = JSON.parse(readFileSync(join(FIXTURES_ROOT, 'delivery', 'demo', 'releases', '1.json'), 'utf8')) as Bundle;
const events = bundle.entries['event'] ?? [];
const x = events.find((e) => e.slug === 'x'); // the fixture itself is checked in fixtures.test.ts
if (x === undefined) throw new Error('the fixture bundle has no event with slug x');

let site: RunningSite;
beforeAll(async () => {
  site = await startSite();
});
afterAll(async () => {
  await site?.stop();
});

const get = (path: string) => fetch(site.url + path);
function revalidate(o: { body?: string; secret?: string; signature?: string; ts?: number } = {}) {
  const body = o.body ?? '{"release":1}';
  const ts = o.ts ?? Math.floor(Date.now() / 1000);
  const signature = o.signature ?? signWebhook(body, o.secret ?? WEBHOOK_SECRETS[0] ?? '', ts);
  return fetch(`${site.url}/api/cms/revalidate`, {
    method: 'POST',
    body,
    headers: { 'x-cms-timestamp': String(ts), 'x-cms-signature': signature },
  });
}

describe('demo site against the fixture bundle', () => {
  it('/events/x renders a marker with the bundle hash and the content', async () => {
    const res = await get('/events/x');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(parseEntryMarkers(html)).toEqual([{ id: x.id, hash: x.contentHash }]);
    expect(html).toContain(String((x.data as { title: string }).title));
    expect(parseReleaseMarker(html)).toBe(bundle.release);
  });
  it('/events lists every event with its marker', async () => {
    const res = await get('/events');
    expect(res.status).toBe(200);
    const html = await res.text();
    const markers = parseEntryMarkers(html);
    expect(markers).toHaveLength(events.length);
    for (const e of events) {
      expect(markers).toContainEqual({ id: e.id, hash: e.contentHash });
      expect(html).toContain(`/events/${e.slug}`);
    }
    expect(parseReleaseMarker(html)).toBe(bundle.release);
  });
  it('an unknown slug gives 404', async () => {
    expect((await get('/events/no-such-event')).status).toBe(404);
  });
  it('revalidate: a bad signature gives 401, a stale timestamp 401, a valid one (either secret) 200', async () => {
    expect((await revalidate({ signature: 'a'.repeat(64) })).status).toBe(401);
    expect((await revalidate({ secret: 'wrong' })).status).toBe(401);
    expect((await revalidate({ ts: Math.floor(Date.now() / 1000) - 3600 })).status).toBe(401);
    const ok = await revalidate();
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { revalidated: boolean }).revalidated).toBe(true);
    expect((await revalidate({ secret: WEBHOOK_SECRETS[1] ?? '' })).status).toBe(200);
  });
  it('still serves the event pages after revalidation', async () => {
    const res = await get('/events/x');
    expect(res.status).toBe(200);
    expect(parseEntryMarkers(await res.text())).toEqual([{ id: x.id, hash: x.contentHash }]);
  });
});
