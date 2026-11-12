// `provision --local` (enhancement A4): the same commands against a local stack, so a new tenant can
// be rehearsed before production. --local accepts exactly the local stacks' own addresses
// (tools/stack/slot.ts) and nothing else; every other check is the hosted one.
import { afterEach, describe, expect, it } from 'vitest';
import { stackSlot } from '../../../stack/slot.ts';
import { runCli } from '../cli.ts';
import { LOCAL_ORIGINS } from '../local.ts';
import type { ProvisionDeps } from '../provision.ts';

// Test values only: the local stack's well-known key form, no real key or secret.
const SLOT_1 = 'http://127.0.0.1:54321';
const SLOT_2 = 'http://127.0.0.1:54331';
const KEY = 'sb_secret_TESTONLYlocal-0123456789_abc';
const SECRET = 'TestOnlyWebhookSecret+0123456789/abcdefgh=';
const PREVIEW_SECRET = 'TestOnlyPreviewSecret+0123456789/abcdefgh=';
const ENV_FILE = '/test/.env.local-provision';
const TENANT = '11111111-1111-4111-8111-111111111111';
const SITE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';

const envFor = (url: string) => [`NEXT_PUBLIC_SUPABASE_URL=${url}`, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test', `SUPABASE_SECRET_KEY=${KEY}`, ''].join('\n');

interface Call {
  url: string;
  init: RequestInit;
  body: unknown;
}
interface Run {
  code: number;
  out: string[];
  err: string[];
  calls: Call[];
  fileReads: number;
  origin: string;
}
const runs: Run[] = [];
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function run(args: string[], o: { url?: string; stdin?: string; handler?: (c: Call) => Response } = {}): Promise<Run> {
  const origin = o.url ?? SLOT_2;
  const r: Run = { code: -1, out: [], err: [], calls: [], fileReads: 0, origin };
  const deps: ProvisionDeps = {
    fetch: async (url, init) => {
      const call = { url, init, body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined };
      r.calls.push(call);
      if (!o.handler) throw new Error('no request expected');
      return o.handler(call);
    },
    readTextFile: async (path) => {
      r.fileReads += 1;
      if (path !== ENV_FILE) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return envFor(origin);
    },
    readStdin: async () => o.stdin ?? '',
  };
  r.code = await runCli(args, { log: (l) => r.out.push(l), error: (l) => r.err.push(l), provision: deps });
  runs.push(r);
  return r;
}

// Every run: no key or secret in the output, every request to the stack's own origin, no redirect.
afterEach(() => {
  for (const r of runs.splice(0)) {
    const text = [...r.out, ...r.err].join('\n');
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(PREVIEW_SECRET);
    for (const c of r.calls) {
      expect(new URL(c.url).origin).toBe(r.origin);
      expect(c.init.redirect).toBe('error');
    }
  }
});

const local = ['--local', `--env-file=${ENV_FILE}`];
const path = (c: Call) => new URL(c.url).pathname;

describe('the local stacks', () => {
  it('are exactly the API addresses of the two stack slots', () => {
    expect([...LOCAL_ORIGINS]).toEqual([stackSlot({}).apiUrl, stackSlot({ CMS_STACK_SLOT: '2' }).apiUrl]);
  });
});

describe('provision --local: arguments', () => {
  it.each([
    ['--local with --expect-ref', ['provision', 'tenant', 'acme', '--name', 'Acme', '--expect-ref', 'abcdefghij0123456789', ...local]],
    ['--local without --env-file (the default is the production env file)', ['provision', 'tenant', 'acme', '--name', 'Acme', '--local']],
    ['--local with a value', ['provision', 'tenant', 'acme', '--name', 'Acme', '--local=yes', `--env-file=${ENV_FILE}`]],
    ['--local twice', ['provision', 'tenant', 'acme', '--name', 'Acme', ...local, '--local']],
    ['an http base URL to a public host', ['provision', 'site', '--tenant-id', TENANT, '--base-url', 'http://site.example.is', '--revalidate-path', '/api/cms/revalidate', ...local]],
    ['an http base URL to a private address', ['provision', 'site', '--tenant-id', TENANT, '--base-url', 'http://10.0.0.5:3111', '--revalidate-path', '/api/cms/revalidate', ...local]],
    ['an http base URL with a path', ['provision', 'site', '--tenant-id', TENANT, '--base-url', 'http://localhost:3111/x', '--revalidate-path', '/r', ...local]],
    ['an http base URL with user info', ['provision', 'site', '--tenant-id', TENANT, '--base-url', 'http://u@localhost:3111', '--revalidate-path', '/r', ...local]],
    ['a malformed slug', ['provision', 'tenant', 'Acme_1', '--name', 'Acme', ...local]],
    ['an http preview URL to a public host', ['provision', 'preview-url', '--site-id', SITE_ID, '--preview-url', 'http://site.example.is/api/cms/preview', ...local]],
  ])('refuses %s with usage, before reading anything', async (_name, args) => {
    const r = await run(args);
    expect(r.code).toBe(2);
    expect(r.err.join('\n')).toContain('usage:');
    expect(r.calls).toHaveLength(0);
    expect(r.fileReads).toBe(0);
  });

  it('a hosted run still refuses an http base URL to a loopback host', async () => {
    const r = await run(['provision', 'site', '--tenant-id', TENANT, '--base-url', 'http://localhost:3111', '--revalidate-path', '/r', '--expect-ref', 'abcdefghij0123456789', `--env-file=${ENV_FILE}`]);
    expect(r.code).toBe(2);
    expect(r.fileReads).toBe(0);
  });
});

describe('provision --local: the target', () => {
  it.each([
    ['a hosted project', 'https://abcdefghij0123456789.supabase.co'],
    ['a hosted project over http', 'http://abcdefghij0123456789.supabase.co'],
    ['another loopback port', 'http://127.0.0.1:54322'],
    ['localhost by name', 'http://localhost:54321'],
    ['https on loopback', 'https://127.0.0.1:54321'],
    ['a private address', 'http://10.0.0.1:54321'],
    ['a trailing slash', 'http://127.0.0.1:54321/'],
  ])('refuses %s in the env file and sends nothing', async (_name, url) => {
    const r = await run(['provision', 'tenant', 'acme', '--name', 'Acme', ...local], { url });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('FAILED: NEXT_PUBLIC_SUPABASE_URL');
    expect(r.err.join('\n')).toContain('nothing was sent');
    expect(r.calls).toHaveLength(0);
  });

  it.each([
    ['slot 1', SLOT_1],
    ['slot 2', SLOT_2],
  ])('creates a tenant on %s, naming the local target first', async (_name, url) => {
    const r = await run(['provision', 'tenant', 'acme', '--name', 'Acme ehf.', ...local], { url, handler: () => json(200, TENANT) });
    expect(r.code).toBe(0);
    expect(r.out).toEqual([`target: ${url.slice('http://'.length)} (local stack)`, `tenant acme: ${TENANT}`]);
    const [c] = r.calls as [Call];
    expect(c.url).toBe(`${url}/rest/v1/rpc/admin_create_tenant`);
    expect(c.body).toEqual({ p_slug: 'acme', p_name: 'Acme ehf.' });
    expect(new Headers(c.init.headers).get('apikey')).toBe(KEY);
  });
});

describe('provision --local: site, editor and preview', () => {
  it('creates a site at a local address, with the webhook secret from standard input', async () => {
    const r = await run(['provision', 'site', '--tenant-id', TENANT, '--base-url', 'http://localhost:3111', '--revalidate-path', '/api/cms/revalidate', '--preview-url', 'http://localhost:3111/api/cms/preview', ...local], {
      stdin: `${SECRET}\n`,
      handler: (c) => (path(c).endsWith('/worker_sites') ? json(200, []) : json(200, SITE_ID)),
    });
    expect(r.code).toBe(0);
    expect(r.out.at(-1)).toBe(`site: ${SITE_ID}`);
    expect(r.calls.map(path)).toEqual(['/rest/v1/rpc/worker_sites', '/rest/v1/rpc/admin_create_site']);
    expect(r.calls[1]!.body).toEqual({
      p_tenant_id: TENANT,
      p_base_url: 'http://localhost:3111',
      p_revalidate_url: 'http://localhost:3111/api/cms/revalidate',
      p_preview_url: 'http://localhost:3111/api/cms/preview',
      p_webhook_secret: SECRET,
    });
  });

  it('accepts an https base URL too, as a hosted run does', async () => {
    const r = await run(['provision', 'site', '--tenant-id', TENANT, '--base-url', 'https://site.example.is', '--revalidate-path', '/r', ...local], {
      stdin: SECRET,
      handler: (c) => (path(c).endsWith('/worker_sites') ? json(200, []) : json(200, SITE_ID)),
    });
    expect(r.code).toBe(0);
  });

  it('accepts 127.0.0.1 as the site host', async () => {
    const r = await run(['provision', 'site', '--tenant-id', TENANT, '--base-url', 'http://127.0.0.1:3111', '--revalidate-path', '/r', ...local], {
      stdin: SECRET,
      handler: (c) => (path(c).endsWith('/worker_sites') ? json(200, []) : json(200, SITE_ID)),
    });
    expect(r.code).toBe(0);
  });

  it('invites an editor and adds the membership', async () => {
    const r = await run(['provision', 'editor', '--email', 'editor@example.is', '--tenant-id', TENANT, ...local], {
      handler: (c) => (path(c) === '/auth/v1/invite' ? json(200, { id: USER_ID }) : json(200, null)),
    });
    expect(r.code).toBe(0);
    expect(r.out).toContain(`invited editor@example.is: user ${USER_ID}`);
    expect(r.out).toContain(`membership ${TENANT}: ok`);
  });

  it('prints a finish command that targets the same local stack', async () => {
    const r = await run(['provision', 'editor', '--user-id', USER_ID, '--tenant-id', TENANT, ...local], {
      handler: () => json(500, { code: 'XX000', message: 'boom' }),
    });
    expect(r.code).toBe(1);
    const text = r.err.join('\n');
    expect(text).toContain(`--tenant-id ${TENANT} --local --env-file=${ENV_FILE}`);
    expect(text).not.toContain('--expect-ref');
  });

  it('sets the preview URL and the preview secret', async () => {
    const url = await run(['provision', 'preview-url', '--site-id', SITE_ID, '--preview-url', 'http://localhost:3111/api/cms/preview', ...local], { handler: () => json(200, null) });
    expect(url.code).toBe(0);
    expect(url.out.at(-1)).toBe(`site ${SITE_ID}: preview URL set to http://localhost:3111/api/cms/preview`);
    const secret = await run(['provision', 'preview-secret', '--site-id', SITE_ID, ...local], { stdin: PREVIEW_SECRET, handler: () => json(200, null) });
    expect(secret.code).toBe(0);
    expect(secret.calls[0]!.body).toEqual({ p_site_id: SITE_ID, p_preview_secret: PREVIEW_SECRET });
  });
});
