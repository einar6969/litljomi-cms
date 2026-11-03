import { describe, expect, it } from 'vitest';
import { runCli } from '../cli.ts';
import { PAGE_SIZE } from '../migrate-drafts.ts';

// Test values only: no real project or key. The demo module's `notice` type is at version 2 with
// a transform 1 -> 2 (heading -> title).
const REF = 'abcdefghij0123456789';
const ORIGIN = `https://${REF}.supabase.co`;
const KEY = 'sb_secret_TESTONLYkey-0123456789_abc.def';
const ENV_FILE = '/test/.env.staging.local';
const goodEnv = [`NEXT_PUBLIC_SUPABASE_URL=${ORIGIN}`, `SUPABASE_SECRET_KEY=${KEY}`, ''].join('\n');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ARGS = ['migrate-drafts', '--tenant', 'demo', '--type', 'notice', '--expect-ref', REF, `--env-file=${ENV_FILE}`];

interface Call {
  fn: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}
type Handler = (call: Call) => Response;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const conflict = () => json(400, { code: 'P0001', message: 'version_conflict' });
const draft = (n: number, version = 3, heading = `Fyrirsögn ${n}`) => ({ entry_id: id(n), version, schema_version: 1, data: { heading, gamalt: true } });

async function run(handler?: Handler, opts: { env?: string; args?: string[] } = {}) {
  const calls: Call[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(opts.args ?? ARGS, {
    log: (l) => out.push(l),
    error: (l) => err.push(l),
    migrateDrafts: {
      fetch: async (url, init) => {
        const fn = new URL(url).pathname.replace('/rest/v1/rpc/', '');
        expect(new URL(url).origin).toBe(ORIGIN);
        const call = { fn, body: JSON.parse(init.body as string) as Record<string, unknown>, headers: init.headers as Record<string, string> };
        calls.push(call);
        if (!handler) throw new Error('no request expected');
        return handler(call);
      },
      readTextFile: async () => opts.env ?? goodEnv,
    },
  });
  return { code, out, err, calls, text: [...out, ...err].join('\n') };
}

/** Lists `pages` in turn for admin_outdated_drafts without p_entry_id; `reread` answers a re-read. */
function server(pages: unknown[][], save: (call: Call, attempt: number) => Response, reread: (call: Call) => unknown[] = () => []): Handler {
  let page = 0;
  const attempts = new Map<string, number>();
  return (call) => {
    if (call.fn === 'admin_outdated_drafts') return json(200, call.body.p_entry_id === null ? (pages[page++] ?? []) : reread(call));
    if (call.fn === 'admin_migrate_draft') {
      const n = (attempts.get(call.body.p_entry_id as string) ?? 0) + 1;
      attempts.set(call.body.p_entry_id as string, n);
      return save(call, n);
    }
    throw new Error(`unexpected ${call.fn}`);
  };
}

describe('migrate-drafts', () => {
  it('upcasts each outdated draft, strips unknown keys and saves it as a versioned update', async () => {
    const r = await run(server([[draft(1), draft(2, 7)]], (c) => json(200, (c.body.p_expected_version as number) + 1)));

    expect(r.code, r.text).toBe(0);
    expect(r.calls.map((c) => c.fn)).toEqual(['admin_outdated_drafts', 'admin_migrate_draft', 'admin_migrate_draft']);
    expect(r.calls[0]!.body).toEqual({ p_tenant_slug: 'demo', p_type: 'notice', p_current_version: 2, p_after: null, p_limit: PAGE_SIZE, p_entry_id: null });
    expect(r.calls[1]!.body).toEqual({
      p_entry_id: id(1),
      p_expected_version: 3,
      p_from_schema_version: 1,
      p_data: { title: 'Fyrirsögn 1' },
      p_schema_version: 2,
      p_title: 'Fyrirsögn 1',
      // notice is ordered by its date field, which the draft has none of.
      p_sort_at: null,
    });
    expect(r.calls[2]!.body).toMatchObject({ p_entry_id: id(2), p_expected_version: 7 });
    expect(r.calls[1]!.headers).toMatchObject({ apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Profile': 'api' });
    expect(r.out).toContain(`migrated ${id(1)}: schema version 1 -> 2, draft version 3 -> 4`);
    expect(r.out.at(-1)).toBe('demo/notice at schema version 2: 2 migrated, 0 already current, 0 reported');
    expect(r.text).not.toContain(KEY);
    expect(r.text).not.toContain('Fyrirsögn');
  });

  it('finds nothing to do on a second run', async () => {
    const r = await run(server([[]], () => json(500, {})));
    expect(r.code).toBe(0);
    expect(r.calls.map((c) => c.fn)).toEqual(['admin_outdated_drafts']);
    expect(r.out.at(-1)).toBe('demo/notice at schema version 2: 0 migrated, 0 already current, 0 reported');
  });

  it('pages through the drafts by entry id', async () => {
    const full = Array.from({ length: PAGE_SIZE }, (_, i) => draft(i + 1));
    const r = await run(server([full, [draft(PAGE_SIZE + 1)]], (c) => json(200, (c.body.p_expected_version as number) + 1)));
    expect(r.code).toBe(0);
    const lists = r.calls.filter((c) => c.fn === 'admin_outdated_drafts');
    expect(lists.map((c) => c.body.p_after)).toEqual([null, id(PAGE_SIZE)]);
    expect(r.out.at(-1)).toContain(`${PAGE_SIZE + 1} migrated`);
  });

  it('re-reads a draft changed meanwhile and retries it once', async () => {
    const r = await run(
      server([[draft(1, 3)]], (c, n) => (n === 1 ? conflict() : json(200, 5)), () => [draft(1, 4, 'Breytt')]),
    );
    expect(r.code, r.text).toBe(0);
    const reread = r.calls[2]!;
    expect(reread).toMatchObject({ fn: 'admin_outdated_drafts', body: { p_entry_id: id(1), p_after: null } });
    expect(r.calls[3]!.body).toMatchObject({ p_expected_version: 4, p_data: { title: 'Breytt' } });
    expect(r.out).toContain(`retrying ${id(1)}: changed since it was read (draft version 3 -> 4)`);
    expect(r.out.at(-1)).toContain('1 migrated, 0 already current, 0 reported');
  });

  it('reports a draft that changes again during the retry, and exits 1', async () => {
    const r = await run(server([[draft(1, 3), draft(2)]], (c) => (c.body.p_entry_id === id(1) ? conflict() : json(200, 4)), () => [draft(1, 4)]));
    expect(r.code).toBe(1);
    expect(r.calls.filter((c) => c.fn === 'admin_migrate_draft' && c.body.p_entry_id === id(1))).toHaveLength(2);
    expect(r.err).toContain(`REPORTED ${id(1)}: changed during the migration twice (version_conflict); draft left as it is`);
    expect(r.out.at(-1)).toContain('1 migrated, 0 already current, 1 reported');
  });

  it('skips a draft saved at the current version meanwhile', async () => {
    const r = await run(server([[draft(1)]], () => conflict(), () => []));
    expect(r.code).toBe(0);
    expect(r.calls.filter((c) => c.fn === 'admin_migrate_draft')).toHaveLength(1);
    expect(r.out.at(-1)).toContain('0 migrated, 1 already current, 0 reported');
  });

  it('reports a draft whose transform fails or whose upcast data is invalid, without saving it', async () => {
    const bad = { entry_id: id(1), version: 2, schema_version: 1, data: { heading: 42 } };
    const r = await run(server([[bad]], () => json(500, {})));
    expect(r.code).toBe(1);
    expect(r.calls.map((c) => c.fn)).toEqual(['admin_outdated_drafts']);
    expect(r.err).toContain(`REPORTED ${id(1)}: invalid after upcast (title); draft left at schema version 1`);
  });

  it('stops on an unexpected server error, naming only status, code and message', async () => {
    const r = await run(server([[draft(1)]], () => json(500, { code: 'XX000', message: `boom ${KEY}` })));
    expect(r.code).toBe(1);
    expect(r.err.at(-1)).toBe(`FAILED: saving draft ${id(1)}: HTTP 500 XX000 boom [redacted]`);
  });

  it('names a tenant missing on the target', async () => {
    const r = await run(() => json(400, { code: 'P0001', message: 'not_found' }));
    expect(r.code).toBe(1);
    expect(r.err.at(-1)).toBe('FAILED: tenant demo does not exist on the target (not_found); nothing was changed');
  });

  it.each([
    ['no --tenant', ['migrate-drafts', '--type', 'notice', '--expect-ref', REF]],
    ['no --type', ['migrate-drafts', '--tenant', 'demo', '--expect-ref', REF]],
    ['no --expect-ref', ['migrate-drafts', '--tenant', 'demo', '--type', 'notice']],
    ['a malformed slug', ['migrate-drafts', '--tenant', '../demo', '--type', 'notice', '--expect-ref', REF]],
    ['an unknown option', [...ARGS, '--all']],
  ])('refuses %s as a usage error, sending nothing', async (_, args) => {
    const r = await run(undefined, { args });
    expect(r.code).toBe(2);
    expect(r.calls).toEqual([]);
  });

  it.each([
    ['an unknown type', ['migrate-drafts', '--tenant', 'demo', '--type', 'nope', '--expect-ref', REF], 'tenant demo has no type nope'],
    ['an unknown tenant', ['migrate-drafts', '--tenant', 'nope', '--type', 'notice', '--expect-ref', REF], 'no module for tenant nope'],
  ])('refuses %s before reading the env file', async (_, args, message) => {
    const r = await run(undefined, { args });
    expect(r.code).toBe(1);
    expect(r.err.at(-1)).toContain(message);
    expect(r.calls).toEqual([]);
  });

  it('refuses a loopback URL in the env file, as provision does', async () => {
    const r = await run(undefined, { env: goodEnv.replace(ORIGIN, 'http://127.0.0.1:54321') });
    expect(r.code).toBe(1);
    expect(r.err.at(-1)).toContain('NEXT_PUBLIC_SUPABASE_URL');
    expect(r.calls).toEqual([]);
  });

  it('refuses to run without injected network access', async () => {
    const err: string[] = [];
    expect(await runCli(ARGS, { log: () => {}, error: (l) => err.push(l) })).toBe(1);
    expect(err[0]).toContain('migrate-drafts: no network or file access was given');
  });
});
