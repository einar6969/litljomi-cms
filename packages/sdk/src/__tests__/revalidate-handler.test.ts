import { describe, expect, it, vi } from 'vitest';
import { createRevalidateHandler, signWebhook } from '../index.ts';

const NOW = 1_800_000_000;
const body = '{"release":3}';
function req(o: { body?: string; secret?: string; ts?: number | string; sig?: string | null } = {}) {
  const ts = o.ts ?? NOW;
  const sig = o.sig === undefined ? signWebhook(o.body ?? body, o.secret ?? 's1', Number(ts)) : o.sig;
  const headers: Record<string, string> = { 'x-cms-timestamp': String(ts) };
  if (sig !== null) headers['x-cms-signature'] = sig;
  return new Request('https://site.example/api/revalidate', { method: 'POST', body: o.body ?? body, headers });
}
function setup(secrets = ['s1']) {
  const revalidate = vi.fn();
  const handler = createRevalidateHandler({ secrets: () => secrets, revalidate, now: () => NOW * 1000 });
  return { revalidate, handler };
}

describe('createRevalidateHandler', () => {
  it('revalidates the cms tag once on a valid request and returns 200', async () => {
    const { revalidate, handler } = setup();
    const res = await handler(req());
    expect(res.status).toBe(200);
    const j = (await res.json()) as { revalidated: boolean; at: string };
    expect(j.revalidated).toBe(true);
    expect(j.at).toBe(new Date(NOW * 1000).toISOString());
    expect(revalidate).toHaveBeenCalledTimes(1);
    expect(revalidate).toHaveBeenCalledWith('cms');
  });
  it('awaits an async revalidate', async () => {
    let done = false;
    const handler = createRevalidateHandler({ secrets: () => ['s1'], revalidate: async () => { await Promise.resolve(); done = true; }, now: () => NOW * 1000 });
    await handler(req());
    expect(done).toBe(true);
  });
  it('401 on a tampered body, wrong secret, stale timestamp, missing or malformed headers', async () => {
    const { revalidate, handler } = setup();
    const bad = [
      new Request('https://s/x', { method: 'POST', body: body + 'x', headers: req().headers }),
      req({ secret: 'nope' }),
      req({ ts: NOW - 301 }),
      req({ sig: null }),
      req({ sig: 'zz' }),
      req({ ts: 'abc', sig: 'a'.repeat(64) }),
      req({ ts: '1e9', sig: 'a'.repeat(64) }),
    ];
    for (const r of bad) expect((await handler(r)).status).toBe(401);
    expect(revalidate).not.toHaveBeenCalled();
  });
  it('accepts either rotation secret', async () => {
    const { revalidate, handler } = setup(['old', 'new']);
    expect((await handler(req({ secret: 'old' }))).status).toBe(200);
    expect((await handler(req({ secret: 'new' }))).status).toBe(200);
    expect(revalidate).toHaveBeenCalledTimes(2);
  });
  it('does not echo secrets or signatures in the response', async () => {
    const { handler } = setup();
    const r = req({ secret: 'nope' });
    const sig = r.headers.get('x-cms-signature') ?? '';
    const text = await (await handler(r)).text();
    expect(text).not.toContain(sig);
    expect(text).not.toContain('s1');
  });

  it('verifies the raw bytes, not the decoded text (a BOM prefix or invalid UTF-8 is rejected)', async () => {
    const { revalidate, handler } = setup();
    const signed = signWebhook(body, 's1', NOW);
    const headers = { 'x-cms-timestamp': String(NOW), 'x-cms-signature': signed };
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(body)]);
    expect((await handler(new Request('https://s/x', { method: 'POST', body: bom, headers }))).status).toBe(401);
    // Signed over the replacement character; sent as an invalid byte that decodes to U+FFFD.
    const badText = '\uFFFD';
    const badHeaders = { 'x-cms-timestamp': String(NOW), 'x-cms-signature': signWebhook(badText, 's1', NOW) };
    const invalid = new Uint8Array([0xff]);
    expect((await handler(new Request('https://s/x', { method: 'POST', body: invalid, headers: badHeaders }))).status).toBe(401);
    // The same bytes signed as bytes are accepted.
    const okHeaders = { 'x-cms-timestamp': String(NOW), 'x-cms-signature': signWebhook(invalid, 's1', NOW) };
    expect((await handler(new Request('https://s/x', { method: 'POST', body: invalid, headers: okHeaders }))).status).toBe(200);
    expect(revalidate).toHaveBeenCalledTimes(1);
  });
  it('rejects a stale timestamp or a malformed signature without reading the body or the secrets', async () => {
    const secrets = vi.fn(() => ['s1']);
    const handler = createRevalidateHandler({ secrets, revalidate: vi.fn(), now: () => NOW * 1000 });
    for (const r of [req({ ts: NOW - 301 }), req({ sig: 'zz' }), req({ sig: null })]) {
      const text = vi.spyOn(r, 'text');
      const buffer = vi.spyOn(r, 'arrayBuffer');
      expect((await handler(r)).status).toBe(401);
      expect(text).not.toHaveBeenCalled();
      expect(buffer).not.toHaveBeenCalled();
      expect(r.bodyUsed).toBe(false);
    }
    expect(secrets).not.toHaveBeenCalled();
  });
  it('answers a controlled 500 when secrets() throws, without detail', async () => {
    const revalidate = vi.fn();
    const handler = createRevalidateHandler({
      secrets: () => { throw new Error('env CMS_WEBHOOK_SECRETS missing'); },
      revalidate,
      now: () => NOW * 1000,
    });
    const res = await handler(req());
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ revalidated: false });
    expect(text).not.toContain('CMS_WEBHOOK_SECRETS');
    expect(revalidate).not.toHaveBeenCalled();
  });
  it('answers 401 when secrets() returns nothing usable', async () => {
    const { handler } = setup([]);
    expect((await handler(req())).status).toBe(401);
  });
  it('413 on a declared content-length above 64 KiB, before reading the body or the secrets (Task 26 F2)', async () => {
    const secrets = vi.fn(() => ['s1']);
    const revalidate = vi.fn();
    const handler = createRevalidateHandler({ secrets, revalidate, now: () => NOW * 1000 });
    const big = 'x'.repeat(64 * 1024 + 1);
    const headers = new Headers(req({ body: big }).headers);
    headers.set('content-length', String(big.length));
    const res = await handler(new Request('https://s/x', { method: 'POST', body: big, headers }));
    expect(res.status).toBe(413);
    expect(secrets).not.toHaveBeenCalled();
    expect(revalidate).not.toHaveBeenCalled();
  });
  it('413 on a streamed body that passes 64 KiB without a content-length, and stops reading it', async () => {
    const { revalidate, handler } = setup();
    let pulled = 0;
    const chunk = new Uint8Array(16 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        if (pulled > 1000) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const ts = NOW;
    const headers = { 'x-cms-timestamp': String(ts), 'x-cms-signature': 'a'.repeat(64) };
    const res = await handler(new Request('https://s/x', { method: 'POST', body: stream, headers, duplex: 'half' } as RequestInit));
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThan(10);
    expect(revalidate).not.toHaveBeenCalled();
  });
  it('still accepts a body of exactly 64 KiB', async () => {
    const { handler } = setup();
    const exact = '"' + 'x'.repeat(64 * 1024 - 2) + '"';
    expect((await handler(req({ body: exact }))).status).toBe(200);
  });
});

// M3-09: verification hardening (spec §7.3 item 2; deferred Minor, Task 27 security; decision 50.5).
describe('createRevalidateHandler: M3-09 hardening', () => {
  it('trims spaces around the secrets it is given', async () => {
    const { revalidate, handler } = setup([' old ', '\tnew\n']);
    expect((await handler(req({ secret: 'old' }))).status).toBe(200);
    expect((await handler(req({ secret: 'new' }))).status).toBe(200);
    expect(revalidate).toHaveBeenCalledTimes(2);
  });
  it.each([[['s1', '']], [['', 's1']], [['s1', '  ']]])('refuses a secret list with an empty entry (%j) with a plain 500, even for a valid signature', async (secrets) => {
    const { revalidate, handler } = setup(secrets);
    const res = await handler(req());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ revalidated: false });
    expect(revalidate).not.toHaveBeenCalled();
  });
  it('refuses an expired timestamp: 300 s old is accepted, 301 s old is not, nor 301 s ahead', async () => {
    const { revalidate, handler } = setup();
    expect((await handler(req({ ts: NOW - 300 }))).status).toBe(200);
    expect((await handler(req({ ts: NOW - 301 }))).status).toBe(401);
    expect((await handler(req({ ts: NOW + 301 }))).status).toBe(401);
    expect(revalidate).toHaveBeenCalledTimes(1);
  });
  it('refuses a wrong signature: another secret, another timestamp, or a well-formed but made-up value', async () => {
    const { revalidate, handler } = setup();
    expect((await handler(req({ secret: 's2' }))).status).toBe(401);
    expect((await handler(req({ sig: signWebhook(body, 's1', NOW - 1) }))).status).toBe(401);
    expect((await handler(req({ sig: 'f'.repeat(64) }))).status).toBe(401);
    expect(revalidate).not.toHaveBeenCalled();
  });
  it('accepts a replay of the same signed request within the window as harmless (decision 50.5: no nonce store)', async () => {
    const { revalidate, handler } = setup();
    const signed = req();
    const replay = new Request(signed.url, { method: 'POST', body, headers: signed.headers });
    expect((await handler(signed)).status).toBe(200);
    expect((await handler(replay)).status).toBe(200);
    // Each one only expires the cms tag again: the same call, with nothing taken from the body.
    expect(revalidate.mock.calls).toEqual([['cms'], ['cms']]);
  });
});
