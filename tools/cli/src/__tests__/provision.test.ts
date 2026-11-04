import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../cli.ts';
import type { ProvisionDeps } from '../provision.ts';

// Test values only: no real project, key or secret.
const REF = 'abcdefghij0123456789';
const ORIGIN = `https://${REF}.supabase.co`;
const KEY = 'sb_secret_TESTONLYkey-0123456789_abc.def';
const SECRET = 'TestOnlyWebhookSecret+0123456789/abcdefgh=';
const ENV_FILE = '/test/.env.staging.local';
const DEFAULT_ENV_FILE = '/Users/einarzoega/litljomi-cms/.env.staging.local';
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const SITE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const NEW_TENANT = '55555555-5555-4555-8555-555555555555';

const goodEnv = [
  '# staging',
  `NEXT_PUBLIC_SUPABASE_URL=${ORIGIN}`,
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test',
  `SUPABASE_SECRET_KEY=${KEY}`,
  '',
].join('\n');

interface Call {
  url: string;
  init: RequestInit;
  body: unknown;
}

type Handler = (call: Call) => Response | Promise<Response>;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface Run {
  code: number;
  out: string[];
  err: string[];
  lines: string[];
  calls: Call[];
  fileReads: number;
  stdinReads: number;
}

const runs: Run[] = [];

async function run(
  args: string[],
  opts: { env?: string | null; stdin?: string | null; stdinError?: Error; handler?: Handler } = {},
): Promise<Run> {
  const result: Run = { code: -1, out: [], err: [], lines: [], calls: [], fileReads: 0, stdinReads: 0 };
  const deps: ProvisionDeps = {
    fetch: async (url, init) => {
      const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
      const call = { url, init, body };
      result.calls.push(call);
      if (!opts.handler) throw new Error('no request expected');
      return opts.handler(call);
    },
    readTextFile: async (path) => {
      result.fileReads += 1;
      if (opts.env === null || (path !== ENV_FILE && path !== DEFAULT_ENV_FILE)) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
      return opts.env ?? goodEnv;
    },
    readStdin: async () => {
      result.stdinReads += 1;
      if (opts.stdinError) throw opts.stdinError;
      return opts.stdin === undefined ? '' : opts.stdin;
    },
  };
  result.code = await runCli(args, {
    log: (l) => {
      result.out.push(l);
      result.lines.push(l);
    },
    error: (l) => {
      result.err.push(l);
      result.lines.push(l);
    },
    provision: deps,
  });
  runs.push(result);
  return result;
}

// Every run, whatever its outcome: the key and the webhook secret appear in no output, and every
// request went to the target origin only.
afterEach(() => {
  for (const r of runs.splice(0)) {
    const text = r.lines.join('\n');
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(SECRET);
    for (const c of r.calls) {
      expect(new URL(c.url).origin).toBe(ORIGIN);
      expect(c.init.redirect).toBe('error');
    }
  }
});

const common = ['--expect-ref', REF, '--env-file', ENV_FILE];
const tenantArgs = ['provision', 'tenant', 'acme', '--name', 'Acme ehf.', ...common];
const siteArgs = [
  'provision', 'site', '--tenant-id', TENANT_A, '--base-url', 'https://site.example.is',
  '--revalidate-path', '/api/cms/revalidate', ...common,
];
const previewArgs = ['provision', 'preview-secret', '--site-id', SITE_ID, ...common];
const PREVIEW_SECRET = 'TestOnlyPreviewSecret+0123456789/abcdefgh=';
const editorArgs = ['provision', 'editor', '--email', 'editor@example.is', '--tenant-id', TENANT_A, '--tenant-id', TENANT_B, ...common];

const path = (c: Call) => new URL(c.url).pathname + new URL(c.url).search;
const header = (c: Call, name: string) => new Headers(c.init.headers).get(name);

describe('provision: argument parsing', () => {
  it.each([
    ['no subcommand', ['provision']],
    ['an unknown subcommand', ['provision', 'nope', ...common]],
    ['tenant without --name', ['provision', 'tenant', 'acme', ...common]],
    ['tenant without a slug', ['provision', 'tenant', '--name', 'Acme', ...common]],
    ['a malformed slug', ['provision', 'tenant', 'Acme_1', '--name', 'Acme', ...common]],
    ['an empty name', ['provision', 'tenant', 'acme', '--name', '', ...common]],
    ['a missing --expect-ref', ['provision', 'tenant', 'acme', '--name', 'Acme', '--env-file', ENV_FILE]],
    ['a flag without a value', ['provision', 'tenant', 'acme', '--name', '--expect-ref', REF]],
    ['a repeated flag', [...tenantArgs, '--name', 'Other']],
    ['an unknown flag', [...tenantArgs, '--local']],
    ['the secret as an argument', [...siteArgs, '--webhook-secret', SECRET]],
    ['an extra positional argument', [...siteArgs, SECRET]],
    ['a relative --env-file', ['provision', 'tenant', 'acme', '--name', 'Acme', '--expect-ref', REF, '--env-file', '.env.staging.local']],
    ['a malformed tenant id', ['provision', 'site', '--tenant-id', 'nope', '--base-url', 'https://a.is', '--revalidate-path', '/r', ...common]],
    ['an http base URL', ['provision', 'site', '--tenant-id', TENANT_A, '--base-url', 'http://a.is', '--revalidate-path', '/r', ...common]],
    ['a base URL with a path', ['provision', 'site', '--tenant-id', TENANT_A, '--base-url', 'https://a.is/x', '--revalidate-path', '/r', ...common]],
    ['a base URL with a trailing slash', ['provision', 'site', '--tenant-id', TENANT_A, '--base-url', 'https://a.is/', '--revalidate-path', '/r', ...common]],
    ['a revalidate path without a leading slash', ['provision', 'site', '--tenant-id', TENANT_A, '--base-url', 'https://a.is', '--revalidate-path', 'api/r', ...common]],
    ['a revalidate path with a query', ['provision', 'site', '--tenant-id', TENANT_A, '--base-url', 'https://a.is', '--revalidate-path', '/r?x=1', ...common]],
    ['site without --revalidate-path', ['provision', 'site', '--tenant-id', TENANT_A, '--base-url', 'https://a.is', ...common]],
    ['preview-secret without --site-id', ['provision', 'preview-secret', ...common]],
    ['preview-secret with a malformed site id', ['provision', 'preview-secret', '--site-id', 'nope', ...common]],
    ['the preview secret as an argument', [...previewArgs, '--preview-secret', PREVIEW_SECRET]],
    ['the preview secret as a positional argument', [...previewArgs, PREVIEW_SECRET]],
    ['editor with both --email and --user-id', [...editorArgs, '--user-id', USER_ID]],
    ['editor with neither --email nor --user-id', ['provision', 'editor', '--tenant-id', TENANT_A, ...common]],
    ['editor without --tenant-id', ['provision', 'editor', '--email', 'editor@example.is', ...common]],
    ['editor with a malformed email', ['provision', 'editor', '--email', 'not-an-email', '--tenant-id', TENANT_A, ...common]],
    ['editor with a malformed user id', ['provision', 'editor', '--user-id', 'x', '--tenant-id', TENANT_A, ...common]],
  ])('refuses %s with usage, before reading anything', async (_name, args) => {
    const r = await run(args);
    expect(r.code).toBe(2);
    expect(r.err.join('\n')).toContain('usage:');
    expect(r.calls).toHaveLength(0);
    expect(r.fileReads).toBe(0);
    expect(r.stdinReads).toBe(0);
  });

  it('never echoes a refused argument value that could be a secret', async () => {
    const r = await run([...siteArgs, '--webhook-secret', SECRET]);
    expect(r.err.join('\n')).toContain('--webhook-secret');
  });
});

describe('provision: the target project', () => {
  it.each([['short'], ['ABCDEFGHIJ0123456789'], ['abcdefghij0123456789x'], ['']])('refuses --expect-ref %j before reading the env file', async (ref) => {
    const r = await run(['provision', 'tenant', 'acme', '--name', 'Acme', '--expect-ref', ref, '--env-file', ENV_FILE]);
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('FAILED: --expect-ref');
    expect(r.calls).toHaveLength(0);
    expect(r.fileReads).toBe(0);
  });

  it('refuses a URL for another project, naming the hosts, and sends nothing', async () => {
    const env = goodEnv.replace(ORIGIN, 'https://zzzzzzzzzz0123456789.supabase.co');
    const r = await run(tenantArgs, { env });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toMatch(/FAILED: .*zzzzzzzzzz0123456789\.supabase\.co, not abcdefghij0123456789\.supabase\.co; nothing was sent/);
    expect(r.calls).toHaveLength(0);
  });

  it.each([
    ['a loopback URL', goodEnv.replace(ORIGIN, 'http://127.0.0.1:54321'), 'NEXT_PUBLIC_SUPABASE_URL', 'unexpected form'],
    ['a URL with a path', goodEnv.replace(ORIGIN, `${ORIGIN}/x`), 'NEXT_PUBLIC_SUPABASE_URL', 'unexpected form'],
    ['another host', goodEnv.replace(ORIGIN, `https://${REF}.example.com`), 'NEXT_PUBLIC_SUPABASE_URL', 'unexpected form'],
    ['a duplicate URL line', `${goodEnv}NEXT_PUBLIC_SUPABASE_URL=${ORIGIN}\n`, 'NEXT_PUBLIC_SUPABASE_URL', 'found 2'],
    ['a duplicate key line (a later one would win when sourced)', `${goodEnv}SUPABASE_SECRET_KEY=${KEY}x\n`, 'SUPABASE_SECRET_KEY', 'found 2'],
    ['an export line', goodEnv.replace('SUPABASE_SECRET_KEY=', 'export SUPABASE_SECRET_KEY='), 'SUPABASE_SECRET_KEY', 'exactly one plain'],
    ['spaces around =', goodEnv.replace('SUPABASE_SECRET_KEY=', 'SUPABASE_SECRET_KEY = '), 'SUPABASE_SECRET_KEY', 'exactly one plain'],
    ['a missing key', goodEnv.replace(`SUPABASE_SECRET_KEY=${KEY}`, ''), 'SUPABASE_SECRET_KEY', 'found 0'],
    ['a quoted key', goodEnv.replace(`SUPABASE_SECRET_KEY=${KEY}`, `SUPABASE_SECRET_KEY="${KEY}"`), 'SUPABASE_SECRET_KEY', 'unexpected form'],
    ['a key with a carriage return', goodEnv.replace(`SUPABASE_SECRET_KEY=${KEY}`, `SUPABASE_SECRET_KEY=${KEY}\r`), 'SUPABASE_SECRET_KEY', 'unexpected form'],
    ['a key with a $', goodEnv.replace(`SUPABASE_SECRET_KEY=${KEY}`, `SUPABASE_SECRET_KEY=${KEY}$X`), 'SUPABASE_SECRET_KEY', 'unexpected form'],
  ])('refuses %s, naming the variable and not its value', async (_name, env, variable, reason) => {
    const r = await run(tenantArgs, { env });
    expect(r.code).toBe(1);
    const text = r.err.join('\n');
    expect(text).toContain(`FAILED: ${variable}`);
    expect(text).toContain(reason);
    expect(text).toContain('nothing was sent');
    expect(text).not.toContain('127.0.0.1');
    expect(r.calls).toHaveLength(0);
    expect(r.out).toHaveLength(0);
  });

  it('ignores comment lines that mention a name', async () => {
    const env = `# SUPABASE_SECRET_KEY=old\n${goodEnv}`;
    const r = await run(tenantArgs, { env, handler: () => json(200, NEW_TENANT) });
    expect(r.code).toBe(0);
  });

  it('refuses a missing env file', async () => {
    const r = await run(tenantArgs, { env: null });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain(`FAILED: ${ENV_FILE} could not be read; nothing was sent`);
    expect(r.calls).toHaveLength(0);
  });

  it('prints the target host before anything else', async () => {
    const r = await run(tenantArgs, { handler: () => json(200, NEW_TENANT) });
    expect(r.lines[0]).toBe(`target: ${REF}.supabase.co`);
  });
});

describe('provision tenant', () => {
  it('creates the tenant through api.admin_create_tenant with the key in headers only', async () => {
    const r = await run(tenantArgs, { handler: () => json(200, NEW_TENANT) });
    expect(r.code).toBe(0);
    expect(r.out).toEqual([`target: ${REF}.supabase.co`, `tenant acme: ${NEW_TENANT}`]);
    expect(r.calls).toHaveLength(1);
    const [c] = r.calls as [Call];
    expect(c.url).toBe(`${ORIGIN}/rest/v1/rpc/admin_create_tenant`);
    expect(c.init.method).toBe('POST');
    expect(header(c, 'apikey')).toBe(KEY);
    expect(header(c, 'Authorization')).toBe(`Bearer ${KEY}`);
    expect(header(c, 'Content-Profile')).toBe('api');
    expect(c.body).toEqual({ p_slug: 'acme', p_name: 'Acme ehf.' });
    expect(c.url).not.toContain(KEY);
  });

  it('refuses an existing slug cleanly (slug_taken)', async () => {
    const r = await run(tenantArgs, { handler: () => json(400, { code: 'P0001', message: 'slug_taken', details: null, hint: null }) });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('FAILED: tenant acme already exists (slug_taken); nothing was created');
    expect(r.calls).toHaveLength(1);
  });

  it('reports another server error as status, code and message only', async () => {
    const r = await run(tenantArgs, {
      handler: () => json(403, { code: '42501', message: 'permission denied for function admin_create_tenant', details: 'echo Acme ehf.', hint: 'h' }),
    });
    expect(r.code).toBe(1);
    const text = r.err.join('\n');
    expect(text).toContain('HTTP 403 42501 permission denied for function admin_create_tenant');
    expect(text).not.toContain('echo Acme');
  });

  it('reports a network failure without the error text', async () => {
    const r = await run(tenantArgs, {
      handler: () => {
        throw Object.assign(new TypeError(`fetch failed ${KEY}`), { cause: { code: 'ENOTFOUND' } });
      },
    });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('network error (ENOTFOUND)');
  });

  it('refuses a response that is not a tenant id', async () => {
    const r = await run(tenantArgs, { handler: () => json(200, { id: 'x' }) });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('unexpected response');
  });
});

describe('provision site', () => {
  const siteHandler = (existing: { id: string; base_url: string }[] = []): Handler => (c) => {
    if (path(c) === '/rest/v1/rpc/worker_sites?select=id,base_url') return json(200, existing);
    if (path(c) === '/rest/v1/rpc/admin_create_site') return json(200, SITE_ID);
    return json(404, {});
  };

  it('checks for an existing site, then creates it with the secret from stdin', async () => {
    const r = await run(siteArgs, { stdin: `${SECRET}\n`, handler: siteHandler([{ id: SITE_ID, base_url: 'https://other.example.is' }]) });
    expect(r.code).toBe(0);
    expect(r.out).toEqual([`target: ${REF}.supabase.co`, `site: ${SITE_ID}`]);
    expect(r.calls.map(path)).toEqual(['/rest/v1/rpc/worker_sites?select=id,base_url', '/rest/v1/rpc/admin_create_site']);
    const [check, create] = r.calls as [Call, Call];
    expect(check.body).toEqual({ p_tenant_id: TENANT_A });
    expect(header(check, 'Content-Profile')).toBe('api');
    expect(create.body).toEqual({
      p_tenant_id: TENANT_A,
      p_base_url: 'https://site.example.is',
      p_revalidate_url: 'https://site.example.is/api/cms/revalidate',
      p_preview_url: null,
      p_webhook_secret: SECRET,
    });
  });

  it('strips one trailing newline only', async () => {
    const r = await run(siteArgs, { stdin: `${SECRET}\n\n`, handler: siteHandler() });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('the webhook secret on standard input has an unexpected form (value not shown)');
    expect(r.calls).toHaveLength(0);
  });

  it('accepts a secret with no trailing newline', async () => {
    const r = await run(siteArgs, { stdin: SECRET, handler: siteHandler() });
    expect(r.code).toBe(0);
    expect((r.calls[1] as Call).body).toMatchObject({ p_webhook_secret: SECRET });
  });

  it('refuses a terminal on stdin', async () => {
    const r = await run(siteArgs, { stdin: null, handler: siteHandler() });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('standard input is a terminal');
    expect(r.calls).toHaveLength(0);
  });

  it.each([[''], ['\n']])('refuses empty stdin %j', async (stdin) => {
    const r = await run(siteArgs, { stdin, handler: siteHandler() });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('standard input is empty');
    expect(r.calls).toHaveLength(0);
  });

  it.each([
    ['a comma (it would split CMS_WEBHOOK_SECRETS)', `${SECRET},x`],
    ['a space', `${SECRET} x`],
    ['fewer than 32 characters', 'short-secret'],
    ['a carriage return', `${SECRET}\r\n`],
  ])('refuses a secret with %s', async (_name, stdin) => {
    const r = await run(siteArgs, { stdin, handler: siteHandler() });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('unexpected form (value not shown)');
    expect(r.calls).toHaveLength(0);
  });

  it('refuses a site the tenant already has, creating nothing', async () => {
    const r = await run(siteArgs, { stdin: SECRET, handler: siteHandler([{ id: SITE_ID, base_url: 'https://site.example.is' }]) });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain(
      `FAILED: tenant ${TENANT_A} already has a site at https://site.example.is (site ${SITE_ID}); nothing was created`,
    );
    expect(r.calls.map(path)).toEqual(['/rest/v1/rpc/worker_sites?select=id,base_url']);
  });

  it('creates nothing when the existing-site check fails', async () => {
    const r = await run(siteArgs, { stdin: SECRET, handler: () => json(401, { code: 'PGRST301', message: 'bad key' }) });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('checking existing sites: HTTP 401 PGRST301 bad key; nothing was created');
    expect(r.calls).toHaveLength(1);
  });

  it('creates nothing when the existing-site check returns something unexpected', async () => {
    const r = await run(siteArgs, { stdin: SECRET, handler: () => json(200, { not: 'a list' }) });
    expect(r.code).toBe(1);
    expect(r.calls).toHaveLength(1);
  });

  it('reports not_found for an unknown tenant', async () => {
    const r = await run(siteArgs, {
      stdin: SECRET,
      handler: (c) => (path(c).startsWith('/rest/v1/rpc/worker_sites') ? json(200, []) : json(400, { code: 'P0001', message: 'not_found' })),
    });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain(`FAILED: creating the site: HTTP 400 P0001 not_found`);
  });

  it('never prints the secret, even when the server echoes it', async () => {
    const r = await run(siteArgs, {
      stdin: SECRET,
      handler: (c) =>
        path(c).startsWith('/rest/v1/rpc/worker_sites') ? json(200, []) : json(400, { code: 'XX000', message: `bad value ${SECRET} ${KEY}` }),
    });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('[redacted]');
  });
});

// Security review B5: a site's preview secret is set from standard input only, 32 characters or more.
describe('provision preview-secret', () => {
  const handler: Handler = (c) => (path(c) === '/rest/v1/rpc/admin_set_preview_secret' ? new Response(null, { status: 204 }) : json(404, {}));

  it('sets the site\'s preview secret through api.admin_set_preview_secret with the secret from stdin', async () => {
    const r = await run(previewArgs, { stdin: `${PREVIEW_SECRET}\n`, handler });
    expect(r.code).toBe(0);
    expect(r.out).toEqual([`target: ${REF}.supabase.co`, `site ${SITE_ID}: preview secret set`]);
    expect(r.calls.map(path)).toEqual(['/rest/v1/rpc/admin_set_preview_secret']);
    const [call] = r.calls as [Call];
    expect(call.body).toEqual({ p_site_id: SITE_ID, p_preview_secret: PREVIEW_SECRET });
    expect(header(call, 'Content-Profile')).toBe('api');
    expect(header(call, 'apikey')).toBe(KEY);
    expect(r.lines.join('\n')).not.toContain(PREVIEW_SECRET);
  });

  it('refuses a terminal on stdin, sending nothing', async () => {
    const r = await run(previewArgs, { stdin: null, handler });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('standard input is a terminal; pipe the preview secret in');
    expect(r.calls).toHaveLength(0);
  });

  it.each([
    ['empty', ''],
    ['fewer than 32 characters', 'x'.repeat(31)],
    ['a comma (it would split CMS_PREVIEW_SECRETS)', `${PREVIEW_SECRET},x`],
    ['a space', `${PREVIEW_SECRET} x`],
    ['two trailing newlines', `${PREVIEW_SECRET}\n\n`],
  ])('refuses a secret that is %s, sending nothing', async (_name, stdin) => {
    const r = await run(previewArgs, { stdin, handler });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toMatch(/standard input is empty|the preview secret on standard input has an unexpected form \(value not shown\)/);
    expect(r.calls).toHaveLength(0);
  });

  it('accepts exactly 32 characters', async () => {
    const r = await run(previewArgs, { stdin: 'y'.repeat(32), handler });
    expect(r.code).toBe(0);
  });

  it('reports an unknown site, and never prints the secret even when the server echoes it', async () => {
    let r = await run(previewArgs, { stdin: PREVIEW_SECRET, handler: () => json(400, { code: 'P0001', message: 'not_found' }) });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain(`FAILED: setting the preview secret of site ${SITE_ID}: HTTP 400 P0001 not_found`);
    r = await run(previewArgs, { stdin: PREVIEW_SECRET, handler: () => json(400, { code: 'XX000', message: `bad ${PREVIEW_SECRET} ${KEY}` }) });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('[redacted]');
    expect(r.lines.join('\n')).not.toContain(PREVIEW_SECRET);
  });
});

describe('provision editor', () => {
  const editorHandler = (failTenant?: string): Handler => (c) => {
    if (path(c) === '/auth/v1/invite') return json(200, { id: USER_ID, email: 'editor@example.is' });
    if (path(c) === '/rest/v1/rpc/admin_add_membership') {
      const body = c.body as { p_tenant_id: string };
      return body.p_tenant_id === failTenant ? json(400, { code: 'P0001', message: 'not_found' }) : new Response(null, { status: 204 });
    }
    return json(404, {});
  };

  it('sends one invitation, then adds a membership per tenant', async () => {
    const r = await run(editorArgs, { handler: editorHandler() });
    expect(r.code).toBe(0);
    expect(r.calls.map(path)).toEqual(['/auth/v1/invite', '/rest/v1/rpc/admin_add_membership', '/rest/v1/rpc/admin_add_membership']);
    const [invite, m1, m2] = r.calls as [Call, Call, Call];
    expect(invite.body).toEqual({ email: 'editor@example.is' });
    expect(header(invite, 'apikey')).toBe(KEY);
    expect(header(invite, 'Content-Profile')).toBeNull();
    expect(m1.body).toEqual({ p_tenant_id: TENANT_A, p_user_id: USER_ID });
    expect(m2.body).toEqual({ p_tenant_id: TENANT_B, p_user_id: USER_ID });
    expect(r.out).toEqual([
      `target: ${REF}.supabase.co`,
      `invited editor@example.is: user ${USER_ID}`,
      `membership ${TENANT_A}: ok`,
      `membership ${TENANT_B}: ok`,
    ]);
  });

  it('adds each tenant once when it is given twice', async () => {
    const r = await run([...editorArgs, '--tenant-id', TENANT_A], { handler: editorHandler() });
    expect(r.code).toBe(0);
    expect(r.calls).toHaveLength(3);
  });

  it('after the invitation, prints the user id and exactly the memberships still missing', async () => {
    const r = await run(editorArgs, { handler: editorHandler(TENANT_A) });
    expect(r.code).toBe(1);
    expect(r.out).toContain(`invited editor@example.is: user ${USER_ID}`);
    expect(r.out).toContain(`membership ${TENANT_B}: ok`);
    const text = r.err.join('\n');
    expect(text).toContain(`membership ${TENANT_A}: FAILED: HTTP 400 P0001 not_found`);
    expect(text).toContain(`FAILED: user ${USER_ID} is still missing memberships in: ${TENANT_A}`);
    expect(text).toContain(
      `finish with: pnpm --silent --filter @litljomi/cli cli provision editor --user-id ${USER_ID} --tenant-id ${TENANT_A} --expect-ref ${REF} --env-file=${ENV_FILE}`,
    );
    expect(text).not.toContain(`--tenant-id ${TENANT_B}`);
  });

  it('lists every missing membership when all fail', async () => {
    const r = await run(editorArgs, {
      handler: (c) => (path(c) === '/auth/v1/invite' ? json(200, { id: USER_ID }) : json(503, { code: 'PGRST000', message: 'down' })),
    });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain(`still missing memberships in: ${TENANT_A} ${TENANT_B}`);
  });

  it('accepts --env-file=<path> and --flag=value forms', async () => {
    const args = ['provision', 'editor', `--email=editor@example.is`, `--tenant-id=${TENANT_A}`, `--expect-ref=${REF}`, `--env-file=${ENV_FILE}`];
    const r = await run(args, { handler: editorHandler(TENANT_A) });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain(`--env-file=${ENV_FILE}`);
    expect(r.err.join('\n')).not.toContain(`--env-file ${ENV_FILE}`);
  });

  it.each([
    ['an empty --env-file=', ['--env-file=']],
    ['a relative --env-file=', ['--env-file=.env']],
    ['an unknown --flag=value', ['--bogus=1']],
  ])('refuses %s', async (_name, extra) => {
    const r = await run(['provision', 'tenant', 'acme', '--name', 'Acme', '--expect-ref', REF, ...extra]);
    expect(r.code).toBe(2);
    expect(r.calls).toHaveLength(0);
  });

  it('prints only the kind of an unexpected error, never its text', async () => {
    const stdinError = Object.assign(new Error(`boom ${KEY}`), { name: 'OddError' });
    const r = await run(
      ['provision', 'site', '--tenant-id', TENANT_A, '--base-url', 'https://site.example.is', '--revalidate-path', '/api/cms/revalidate', ...common],
      { stdinError },
    );
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('FAILED: unexpected error (OddError)');
    expect(r.err.join('\n')).not.toContain('boom');
    expect(r.calls).toHaveLength(0);
  });

  it('reads the default env file, and leaves --env-file out of the finish command', async () => {
    const args = editorArgs.filter((a, i) => a !== '--env-file' && editorArgs[i - 1] !== '--env-file');
    const r = await run(args, { handler: editorHandler(TENANT_B) });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain(
      `finish with: pnpm --silent --filter @litljomi/cli cli provision editor --user-id ${USER_ID} --tenant-id ${TENANT_B} --expect-ref ${REF}`,
    );
    expect(r.err.join('\n')).not.toContain('--env-file');
  });

  it.each([
    ['email_exists', { code: 422, error_code: 'email_exists', msg: 'A user with this email address has already been registered' }],
    ['user_already_exists', { code: 422, error_code: 'user_already_exists', msg: 'User already registered' }],
  ])('refuses an existing user (%s) and changes nothing', async (_name, body) => {
    const r = await run(editorArgs, { handler: () => json(422, body) });
    expect(r.code).toBe(1);
    const text = r.err.join('\n');
    expect(text).toContain('FAILED: a user with email editor@example.is already exists; no invitation was sent and nothing was changed');
    expect(text).toContain('--user-id <user-id>');
    expect(r.calls.map(path)).toEqual(['/auth/v1/invite']);
  });

  it('reports a failed invitation as status, code and message, and adds no membership', async () => {
    const r = await run(editorArgs, { handler: () => json(500, { code: 500, error_code: 'unexpected_failure', msg: 'Error sending invite email' }) });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('FAILED: invitation: HTTP 500 unexpected_failure Error sending invite email');
    expect(r.calls).toHaveLength(1);
  });

  it('refuses an invitation response without a user id', async () => {
    const r = await run(editorArgs, { handler: () => json(200, { email: 'editor@example.is' }) });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('unexpected response');
    expect(r.calls).toHaveLength(1);
  });

  it('with --user-id, adds the memberships of an existing user without an invitation', async () => {
    const r = await run(['provision', 'editor', '--user-id', USER_ID, '--tenant-id', TENANT_B, ...common], { handler: editorHandler() });
    expect(r.code).toBe(0);
    expect(r.calls.map(path)).toEqual(['/rest/v1/rpc/admin_add_membership']);
    expect(r.out).toEqual([`target: ${REF}.supabase.co`, `user ${USER_ID}`, `membership ${TENANT_B}: ok`]);
  });
});

describe('provision: dependencies', () => {
  it('refuses to run without injected dependencies', async () => {
    const errors: string[] = [];
    const code = await runCli(tenantArgs, { log: () => {}, error: (l) => errors.push(l) });
    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('provision');
  });
});
