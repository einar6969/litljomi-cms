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
});
