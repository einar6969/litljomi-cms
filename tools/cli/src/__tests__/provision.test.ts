import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../cli.ts';
import { isAllowedPreviewUrl, type ProvisionDeps } from '../provision.ts';

// Test values only: no real project, key or secret.
const REF = 'abcdefghij0123456789';
const ORIGIN = `https://${REF}.supabase.co`;
const KEY = 'sb_secret_TESTONLYkey-0123456789_abc.def';
const SECRET = 'TestOnlyWebhookSecret+0123456789/abcdefgh=';
const ENV_FILE = '/test/.env.production.local';
const DEFAULT_ENV_FILE = '/Users/einarzoega/litljomi-cms/.env.production.local';
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const SITE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const NEW_TENANT = '55555555-5555-4555-8555-555555555555';

const goodEnv = [
  '# production',
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

// Every run, whatever its outcome: the key and both secrets appear in no output, and every request
// went to the target origin only.
afterEach(() => {
  for (const r of runs.splice(0)) {
    const text = r.lines.join('\n');
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(PREVIEW_SECRET);
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
const PREVIEW_URL = 'https://site.example.is/api/cms/preview';
const previewUrlArgs = (url: string) => ['provision', 'preview-url', '--site-id', SITE_ID, '--preview-url', url, ...common];
const editorArgs = ['provision', 'editor', '--email', 'editor@example.is', '--tenant-id', TENANT_A, '--tenant-id', TENANT_B, ...common];
const webhookArgs = ['provision', 'webhook-secret', '--site-id', SITE_ID, ...common];
const statusArgs = (status: string) => ['provision', 'tenant-status', '--tenant-id', TENANT_A, '--status', status, ...common];
const removeArgs = ['provision', 'remove-editor', '--user-id', USER_ID, '--tenant-id', TENANT_A, '--tenant-id', TENANT_B, ...common];

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
    ['an unknown flag', [...tenantArgs, '--locale']],
    ['both --expect-ref and --local', [...tenantArgs, '--local']],
    ['the secret as an argument', [...siteArgs, '--webhook-secret', SECRET]],
    ['an extra positional argument', [...siteArgs, SECRET]],
    ['a relative --env-file', ['provision', 'tenant', 'acme', '--name', 'Acme', '--expect-ref', REF, '--env-file', '.env.production.local']],
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
    ['site with an http preview URL to a public host', [...siteArgs, '--preview-url', 'http://site.example.is/api/cms/preview']],
    ['site with a preview URL carrying a query', [...siteArgs, '--preview-url', `${PREVIEW_URL}?x=1`]],
    ['site with --preview-url none (only preview-url clears)', [...siteArgs, '--preview-url', 'none']],
    ['preview-url without --site-id', ['provision', 'preview-url', '--preview-url', PREVIEW_URL, ...common]],
    ['preview-url with a malformed site id', ['provision', 'preview-url', '--site-id', 'nope', '--preview-url', PREVIEW_URL, ...common]],
    ['preview-url without --preview-url', ['provision', 'preview-url', '--site-id', SITE_ID, ...common]],
    ['preview-url with an http URL to a public host', previewUrlArgs('http://site.example.is/api/cms/preview')],
    ['preview-url with user info', previewUrlArgs('https://localhost@evil.example/preview')],
    ['preview-url with an empty URL', ['provision', 'preview-url', '--site-id', SITE_ID, '--preview-url=', ...common]],
    ['preview-url with the URL as a positional argument', ['provision', 'preview-url', '--site-id', SITE_ID, PREVIEW_URL, ...common]],
    ['editor with both --email and --user-id', [...editorArgs, '--user-id', USER_ID]],
    ['editor with neither --email nor --user-id', ['provision', 'editor', '--tenant-id', TENANT_A, ...common]],
    ['editor without --tenant-id', ['provision', 'editor', '--email', 'editor@example.is', ...common]],
    ['editor with a malformed email', ['provision', 'editor', '--email', 'not-an-email', '--tenant-id', TENANT_A, ...common]],
    ['editor with a malformed user id', ['provision', 'editor', '--user-id', 'x', '--tenant-id', TENANT_A, ...common]],
    ['webhook-secret without --site-id', ['provision', 'webhook-secret', ...common]],
    ['webhook-secret with a malformed site id', ['provision', 'webhook-secret', '--site-id', 'nope', ...common]],
    ['the rotated secret as an argument', [...webhookArgs, '--webhook-secret', SECRET]],
    ['the rotated secret as a positional argument', [...webhookArgs, SECRET]],
    ['tenant-status without --tenant-id', ['provision', 'tenant-status', '--status', 'active', ...common]],
    ['tenant-status with a malformed tenant id', ['provision', 'tenant-status', '--tenant-id', 'nope', '--status', 'active', ...common]],
    ['tenant-status without --status', ['provision', 'tenant-status', '--tenant-id', TENANT_A, ...common]],
    ['tenant-status with another status', statusArgs('deleted')],
    ['tenant-status with an uppercase status', statusArgs('ACTIVE')],
    ['tenant-status with an empty status', ['provision', 'tenant-status', '--tenant-id', TENANT_A, '--status=', ...common]],
    ['tenant-status for two tenants', [...statusArgs('active'), '--tenant-id', TENANT_B]],
    ['remove-editor without --user-id', ['provision', 'remove-editor', '--tenant-id', TENANT_A, ...common]],
    ['remove-editor with an empty user id (a null would be a silent no-op)', ['provision', 'remove-editor', '--user-id=', '--tenant-id', TENANT_A, ...common]],
    ['remove-editor with a malformed user id', ['provision', 'remove-editor', '--user-id', 'x', '--tenant-id', TENANT_A, ...common]],
    ['remove-editor with an email in place of a user id', ['provision', 'remove-editor', '--email', 'editor@example.is', '--tenant-id', TENANT_A, ...common]],
    ['remove-editor without --tenant-id', ['provision', 'remove-editor', '--user-id', USER_ID, ...common]],
    ['remove-editor with a malformed tenant id', ['provision', 'remove-editor', '--user-id', USER_ID, '--tenant-id', TENANT_A, '--tenant-id', 'nope', ...common]],
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
    expect(r.err.join('\n')).toContain("FAILED: --expect-ref must be the hosted project's reference (20 lowercase letters or digits); nothing was sent");
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

  it('prints the existing id and exits 0 when the slug exists with the same name', async () => {
    const r = await run(tenantArgs, { handler: () => json(200, TENANT_A) });
    expect(r.code).toBe(0);
    expect(r.out).toEqual([`target: ${REF}.supabase.co`, `tenant acme: ${TENANT_A}`]);
    expect(r.err).toEqual([]);
  });

  it('refuses a slug that exists with a different name (slug_taken)', async () => {
    const r = await run(tenantArgs, { handler: () => json(400, { code: 'P0001', message: 'slug_taken', details: null, hint: null }) });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('FAILED: tenant acme already exists with a different name (slug_taken); nothing was created');
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

  it('passes --preview-url to api.admin_create_site', async () => {
    const r = await run([...siteArgs, '--preview-url', PREVIEW_URL], { stdin: SECRET, handler: siteHandler() });
    expect(r.code).toBe(0);
    expect((r.calls[1] as Call).body).toMatchObject({ p_preview_url: PREVIEW_URL, p_webhook_secret: SECRET });
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

  it('on a base URL the tenant already has, prints the site id, says the secret was not changed and exits 0', async () => {
    const r = await run(siteArgs, { stdin: SECRET, handler: siteHandler([{ id: SITE_ID, base_url: 'https://site.example.is' }]) });
    expect(r.code).toBe(0);
    expect(r.out).toEqual([
      `target: ${REF}.supabase.co`,
      `site ${SITE_ID}: already exists at https://site.example.is; nothing was created and the webhook secret was not changed (to change it, use provision webhook-secret)`,
    ]);
    expect(r.err).toEqual([]);
    // The piped secret is discarded: the only request carries the tenant id and nothing else.
    expect(r.calls.map(path)).toEqual(['/rest/v1/rpc/worker_sites?select=id,base_url']);
    expect((r.calls[0] as Call).body).toEqual({ p_tenant_id: TENANT_A });
  });

  it.each([
    ['not a string', 7],
    ['not a uuid', 'abc'],
  ])('refuses an existing site whose id is %s', async (_name, id) => {
    const r = await run(siteArgs, {
      stdin: SECRET,
      handler: () => json(200, [{ id, base_url: 'https://site.example.is' }]),
    });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('FAILED: unexpected response from worker_sites; nothing was created');
    expect(r.calls).toHaveLength(1);
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

// M4-02, spec §8.2: a site's webhook secret rotated in place, from standard input only.
describe('provision webhook-secret', () => {
  const handler: Handler = (c) => (path(c) === '/rest/v1/rpc/admin_set_webhook_secret' ? new Response(null, { status: 204 }) : json(404, {}));

  it('sets the site\'s webhook secret through api.admin_set_webhook_secret with the secret from stdin', async () => {
    const r = await run(webhookArgs, { stdin: `${SECRET}\n`, handler });
    expect(r.code).toBe(0);
    expect(r.out).toEqual([`target: ${REF}.supabase.co`, `site ${SITE_ID}: webhook secret set`]);
    expect(r.calls.map(path)).toEqual(['/rest/v1/rpc/admin_set_webhook_secret']);
    const [call] = r.calls as [Call];
    expect(call.init.method).toBe('POST');
    expect(call.body).toEqual({ p_site_id: SITE_ID, p_webhook_secret: SECRET });
    expect(call.url).not.toContain(SECRET);
    expect(header(call, 'Content-Profile')).toBe('api');
    expect(header(call, 'apikey')).toBe(KEY);
    expect(header(call, 'Authorization')).toBe(`Bearer ${KEY}`);
  });

  it('refuses a terminal on stdin, sending nothing', async () => {
    const r = await run(webhookArgs, { stdin: null, handler });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('standard input is a terminal; pipe the webhook secret in');
    expect(r.calls).toHaveLength(0);
  });

  it.each([
    ['empty', ''],
    ['fewer than 32 characters', 'x'.repeat(31)],
    ['more than 256 characters', 'x'.repeat(257)],
    ['a comma (it would split CMS_WEBHOOK_SECRETS)', `${SECRET},x`],
    ['a space', `${SECRET} x`],
    ['two trailing newlines', `${SECRET}\n\n`],
    ['a carriage return', `${SECRET}\r\n`],
  ])('refuses a secret that is %s, sending nothing', async (_name, stdin) => {
    const r = await run(webhookArgs, { stdin, handler });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toMatch(/standard input is empty|the webhook secret on standard input has an unexpected form \(value not shown\)/);
    expect(r.calls).toHaveLength(0);
  });

  it('accepts exactly 32 characters', async () => {
    const r = await run(webhookArgs, { stdin: 'y'.repeat(32), handler });
    expect(r.code).toBe(0);
  });

  it('reports an unknown site, and never prints the secret even when the server echoes it', async () => {
    let r = await run(webhookArgs, { stdin: SECRET, handler: () => json(400, { code: 'P0001', message: 'not_found' }) });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain(`FAILED: setting the webhook secret of site ${SITE_ID}: HTTP 400 P0001 not_found`);
    r = await run(webhookArgs, { stdin: SECRET, handler: () => json(400, { code: 'XX000', message: `bad ${SECRET} ${KEY}` }) });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('[redacted]');
  });

  it('reports a network failure without the error text', async () => {
    const r = await run(webhookArgs, {
      stdin: SECRET,
      handler: () => {
        throw Object.assign(new TypeError(`fetch failed ${SECRET}`), { cause: { code: 'ECONNRESET' } });
      },
    });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('network error (ECONNRESET)');
  });
});

// M4-02, spec §8.4: an incident suspends a tenant; reactivating restores publishing.
describe('provision tenant-status', () => {
  const handler: Handler = (c) => (path(c) === '/rest/v1/rpc/admin_set_tenant_status' ? new Response(null, { status: 204 }) : json(404, {}));

  it.each(['suspended', 'active'])('sets the status %s through api.admin_set_tenant_status', async (status) => {
    const r = await run(statusArgs(status), { handler });
    expect(r.code).toBe(0);
    expect(r.out).toEqual([`target: ${REF}.supabase.co`, `tenant ${TENANT_A}: status ${status}`]);
    expect(r.calls.map(path)).toEqual(['/rest/v1/rpc/admin_set_tenant_status']);
    const [call] = r.calls as [Call];
    expect(call.init.method).toBe('POST');
    expect(call.body).toEqual({ p_tenant_id: TENANT_A, p_status: status });
    expect(header(call, 'Content-Profile')).toBe('api');
    expect(header(call, 'apikey')).toBe(KEY);
    expect(r.stdinReads).toBe(0);
  });

  it('reports an unknown tenant as status, code and message', async () => {
    const r = await run(statusArgs('suspended'), { handler: () => json(400, { code: 'P0001', message: 'not_found', details: 'echo' }) });
    expect(r.code).toBe(1);
    const text = r.err.join('\n');
    expect(text).toContain(`FAILED: setting the status of tenant ${TENANT_A}: HTTP 400 P0001 not_found`);
    expect(text).not.toContain('echo');
  });

  it('never prints the key, even when the server echoes it', async () => {
    const r = await run(statusArgs('suspended'), { handler: () => json(500, { code: 'XX000', message: `bad ${KEY}` }) });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('[redacted]');
  });
});

// M4-02, spec §8.4: revoking an editor; admin_remove_membership is a silent no-op on a null user id
// and on an absent membership, so ids are validated and the output claims no more than it knows.
describe('provision remove-editor', () => {
  const removeHandler = (failTenant?: string): Handler => (c) => {
    if (path(c) !== '/rest/v1/rpc/admin_remove_membership') return json(404, {});
    const body = c.body as { p_tenant_id: string };
    return body.p_tenant_id === failTenant ? json(400, { code: 'P0001', message: 'not_found' }) : new Response(null, { status: 204 });
  };

  it('removes one membership per tenant through api.admin_remove_membership', async () => {
    const r = await run(removeArgs, { handler: removeHandler() });
    expect(r.code).toBe(0);
    expect(r.calls.map(path)).toEqual(['/rest/v1/rpc/admin_remove_membership', '/rest/v1/rpc/admin_remove_membership']);
    const [a, b] = r.calls as [Call, Call];
    expect(a.body).toEqual({ p_tenant_id: TENANT_A, p_user_id: USER_ID });
    expect(b.body).toEqual({ p_tenant_id: TENANT_B, p_user_id: USER_ID });
    expect(header(a, 'Content-Profile')).toBe('api');
    expect(header(a, 'apikey')).toBe(KEY);
    expect(r.out).toEqual([
      `target: ${REF}.supabase.co`,
      `user ${USER_ID}`,
      `membership ${TENANT_A}: removed or already absent`,
      `membership ${TENANT_B}: removed or already absent`,
    ]);
    expect(r.stdinReads).toBe(0);
  });

  it('removes each tenant once when it is given twice', async () => {
    const r = await run([...removeArgs, '--tenant-id', TENANT_A], { handler: removeHandler() });
    expect(r.code).toBe(0);
    expect(r.calls).toHaveLength(2);
  });

  it('prints exactly the tenants still to do and the command that finishes them', async () => {
    const r = await run(removeArgs, { handler: removeHandler(TENANT_A) });
    expect(r.code).toBe(1);
    expect(r.out).toContain(`membership ${TENANT_B}: removed or already absent`);
    const text = r.err.join('\n');
    expect(text).toContain(`membership ${TENANT_A}: FAILED: HTTP 400 P0001 not_found`);
    expect(text).toContain(`FAILED: user ${USER_ID} may still have memberships in: ${TENANT_A}`);
    expect(text).toContain(
      `finish with: pnpm --silent --filter @litljomi/cli cli provision remove-editor --user-id ${USER_ID} --tenant-id ${TENANT_A} --expect-ref ${REF} --env-file=${ENV_FILE}`,
    );
    expect(text).not.toContain(`--tenant-id ${TENANT_B}`);
  });

  it('leaves --env-file out of the finish command with the default env file', async () => {
    const args = removeArgs.filter((a, i) => a !== '--env-file' && removeArgs[i - 1] !== '--env-file');
    const r = await run(args, { handler: removeHandler(TENANT_B) });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).not.toContain('--env-file');
  });

  it('tries every tenant even when the connection drops on the first', async () => {
    let calls = 0;
    const r = await run(removeArgs, {
      handler: () => {
        calls += 1;
        if (calls === 1) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
        return new Response(null, { status: 204 });
      },
    });
    expect(r.code).toBe(1);
    expect(r.calls).toHaveLength(2);
    expect(r.err.join('\n')).toContain(`membership ${TENANT_A}: FAILED: network error (ECONNRESET)`);
    expect(r.out).toContain(`membership ${TENANT_B}: removed or already absent`);
  });

  it('never prints the key, even when the server echoes it', async () => {
    const r = await run(removeArgs, { handler: () => json(500, { code: 'XX000', message: `bad ${KEY}` }) });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('[redacted]');
  });
});

// fix/preview-url: a site's preview URL, set, replaced or cleared, never read from stdin.
describe('provision preview-url', () => {
  const handler: Handler = (c) => (path(c) === '/rest/v1/rpc/admin_set_preview_url' ? new Response(null, { status: 204 }) : json(404, {}));

  it('sets the site\'s preview URL through api.admin_set_preview_url', async () => {
    const r = await run(previewUrlArgs(PREVIEW_URL), { handler });
    expect(r.code).toBe(0);
    expect(r.out).toEqual([`target: ${REF}.supabase.co`, `site ${SITE_ID}: preview URL set to ${PREVIEW_URL}`]);
    expect(r.calls.map(path)).toEqual(['/rest/v1/rpc/admin_set_preview_url']);
    const [call] = r.calls as [Call];
    expect(call.body).toEqual({ p_site_id: SITE_ID, p_preview_url: PREVIEW_URL });
    expect(header(call, 'Content-Profile')).toBe('api');
    expect(header(call, 'apikey')).toBe(KEY);
    expect(r.stdinReads).toBe(0);
  });

  it('clears the preview URL with none (null)', async () => {
    const r = await run(previewUrlArgs('none'), { handler });
    expect(r.code).toBe(0);
    expect(r.out).toEqual([`target: ${REF}.supabase.co`, `site ${SITE_ID}: preview URL cleared`]);
    expect((r.calls[0] as Call).body).toEqual({ p_site_id: SITE_ID, p_preview_url: null });
  });

  it('accepts --preview-url=<url>', async () => {
    const r = await run(['provision', 'preview-url', '--site-id', SITE_ID, `--preview-url=${PREVIEW_URL}`, ...common], { handler });
    expect(r.code).toBe(0);
    expect((r.calls[0] as Call).body).toEqual({ p_site_id: SITE_ID, p_preview_url: PREVIEW_URL });
  });

  it('reports an unknown site or a refused URL as status, code and message', async () => {
    let r = await run(previewUrlArgs(PREVIEW_URL), { handler: () => json(400, { code: 'P0001', message: 'not_found' }) });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain(`FAILED: setting the preview URL of site ${SITE_ID}: HTTP 400 P0001 not_found`);
    r = await run(previewUrlArgs(PREVIEW_URL), {
      handler: () => json(400, { code: '22023', message: `p_preview_url must be an https URL ${KEY}` }),
    });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('[redacted]');
  });
});

// The same cases as supabase/tests/database/110_preview_url.test.sql: the CLI refuses before
// sending what api.admin_set_preview_url would refuse, and refuses nothing it accepts.
describe('provision: the preview URL rule', () => {
  it.each([
    'https://a.is',
    'https://demo.vefstjorn.is/api/cms/preview',
    'https://Site.Example.IS/Preview',
    'https://203.0.113.7:8443/preview',
    'https://[2001:db8::1]/preview',
    'http://localhost:3101/api/cms/preview',
    'http://localhost',
    'http://127.0.0.1:3101/api/cms/preview',
    'http://127.255.10.1/p',
    'http://[::1]:3101/api/cms/preview',
    `https://demo.example.is/${'a'.repeat(2024)}`,
  ])('accepts %s', (url) => {
    expect(isAllowedPreviewUrl(url)).toBe(true);
    // ... and the token route's URL parser reads it as https, or http to a loopback host.
    const parsed = new URL(url);
    expect(parsed.protocol === 'https:' || ['localhost', '[::1]'].includes(parsed.hostname) || parsed.hostname.startsWith('127.')).toBe(true);
  });

  it.each([
    ['http to a public host', 'http://demo.example.is/preview'],
    ['http to a private address', 'http://10.0.0.5/preview'],
    ['http to 0.0.0.0', 'http://0.0.0.0:3101/preview'],
    ['http to a host that only starts with localhost', 'http://localhost.example.is/preview'],
    ['http to a host that only starts with 127', 'http://127.0.0.1.example.is/preview'],
    ['http to an out-of-range 127 address', 'http://127.0.0.256/preview'],
    ['http to a 127 address with a leading zero', 'http://127.0.0.01/preview'],
    ['http to an IPv6 address other than ::1', 'http://[::2]/preview'],
    ['an uppercase scheme', 'HTTPS://demo.example.is/preview'],
    ['another scheme', 'javascript:alert(1)'],
    ['a ftp URL', 'ftp://demo.example.is/preview'],
    ['no scheme', 'demo.example.is/preview'],
    ['a scheme-relative URL', '//demo.example.is/preview'],
    ['user info', 'https://user:pass@demo.example.is/preview'],
    ['user info hiding the host', 'https://localhost@evil.example/preview'],
    ['a query', 'https://demo.example.is/preview?x=1'],
    ['a fragment', 'https://demo.example.is/preview#x'],
    ['a space', 'https://demo.example.is/pre view'],
    ['a backslash', 'https://demo.example.is\\preview'],
    ['a newline', 'https://demo.example.is/preview\n'],
    ['an empty host', 'https:///preview'],
    ['a trailing dot in the host', 'https://demo.example.is./preview'],
    ['a percent-encoded host', 'https://%6c%6f%63%61%6c%68%6f%73%74/preview'],
    ['a non-ASCII host', 'https://bakarí.is/preview'],
    ['an empty string', ''],
    ['more than 2048 characters', `https://demo.example.is/${'a'.repeat(2025)}`],
  ])('refuses %s', (_name, url) => {
    expect(isAllowedPreviewUrl(url)).toBe(false);
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

  describe('an existing user', () => {
    const users = (...list: { id?: unknown; email?: unknown }[]) => json(200, { users: list, aud: 'authenticated' });
    const other = (n: number) => ({ id: `66666666-6666-4666-8666-${String(n).padStart(12, '0')}`, email: `other${n}@example.is` });
    const page = (c: Call) => Number(new URL(c.url).searchParams.get('page'));
    const LIST = '/auth/v1/admin/users';
    const exists = (list: (c: Call) => Response): Handler => (c) => {
      if (path(c) === '/auth/v1/invite') return json(422, { code: 422, error_code: 'email_exists', msg: 'already registered' });
      if (new URL(c.url).pathname === LIST) return list(c);
      if (path(c) === '/rest/v1/rpc/admin_add_membership') return new Response(null, { status: 204 });
      return json(404, {});
    };
    const noMemberships = (r: Run) => expect(r.calls.filter((c) => path(c).includes('admin_add_membership'))).toEqual([]);

    it.each([
      ['email_exists', { code: 422, error_code: 'email_exists', msg: 'A user with this email address has already been registered' }],
      ['user_already_exists', { code: 422, error_code: 'user_already_exists', msg: 'User already registered' }],
    ])('finds the id in the users list after %s, and adds the memberships', async (_name, body) => {
      const r = await run(editorArgs, {
        handler: (c) => {
          if (path(c) === '/auth/v1/invite') return json(422, body);
          if (new URL(c.url).pathname === LIST) return users({ id: USER_ID, email: 'editor@example.is' });
          return new Response(null, { status: 204 });
        },
      });
      expect(r.code).toBe(0);
      expect(r.calls.map((c) => new URL(c.url).pathname)).toEqual([
        '/auth/v1/invite',
        LIST,
        '/rest/v1/rpc/admin_add_membership',
        '/rest/v1/rpc/admin_add_membership',
      ]);
      expect(r.calls[2]?.body).toEqual({ p_tenant_id: TENANT_A, p_user_id: USER_ID });
      expect(r.calls[3]?.body).toEqual({ p_tenant_id: TENANT_B, p_user_id: USER_ID });
      expect(r.out).toEqual([
        `target: ${REF}.supabase.co`,
        `existing user editor@example.is: user ${USER_ID}`,
        `membership ${TENANT_A}: ok`,
        `membership ${TENANT_B}: ok`,
      ]);
    });

    it('reads the list with a GET, the key in headers only and no body', async () => {
      const r = await run(editorArgs, { handler: exists(() => users({ id: USER_ID, email: 'editor@example.is' })) });
      expect(r.code).toBe(0);
      const list = r.calls[1] as Call;
      expect(list.init.method).toBe('GET');
      expect(list.init.body).toBeUndefined();
      expect(path(list)).toBe('/auth/v1/admin/users?page=1&per_page=200');
      expect(header(list, 'apikey')).toBe(KEY);
      expect(header(list, 'Authorization')).toBe(`Bearer ${KEY}`);
      expect(header(list, 'Content-Profile')).toBeNull();
      expect(list.url).not.toContain(KEY);
    });

    it('matches the email case-insensitively, whichever side has the capitals', async () => {
      let r = await run(editorArgs, { handler: exists(() => users(other(1), { id: USER_ID, email: 'Editor@Example.IS' })) });
      expect(r.code).toBe(0);
      expect((r.calls[2] as Call).body).toEqual({ p_tenant_id: TENANT_A, p_user_id: USER_ID });
      const upper = editorArgs.map((a) => (a === 'editor@example.is' ? 'EDITOR@example.is' : a));
      r = await run(upper, { handler: exists(() => users({ id: USER_ID, email: 'editor@example.is' })) });
      expect(r.code).toBe(0);
      expect((r.calls[2] as Call).body).toEqual({ p_tenant_id: TENANT_A, p_user_id: USER_ID });
    });

    it('matches only the whole email', async () => {
      const r = await run(editorArgs, {
        handler: exists((c) => (page(c) === 1 ? users({ id: USER_ID, email: 'not-editor@example.is.other' }, { id: USER_ID }, { id: USER_ID, email: null }) : users())),
      });
      expect(r.code).toBe(1);
      noMemberships(r);
    });

    it('follows the pages until it finds the user, and stops there', async () => {
      const r = await run(editorArgs, {
        handler: exists((c) => {
          if (page(c) === 1) return users(other(1), other(2));
          if (page(c) === 2) return users(other(3));
          if (page(c) === 3) return users(other(4), { id: USER_ID, email: 'editor@example.is' });
          throw new Error('read past the page with the user');
        }),
      });
      expect(r.code).toBe(0);
      expect(r.calls.filter((c) => new URL(c.url).pathname === LIST).map(path)).toEqual([
        '/auth/v1/admin/users?page=1&per_page=200',
        '/auth/v1/admin/users?page=2&per_page=200',
        '/auth/v1/admin/users?page=3&per_page=200',
      ]);
      expect((r.calls.at(-1) as Call).body).toEqual({ p_tenant_id: TENANT_B, p_user_id: USER_ID });
    });

    it('fails clearly and changes nothing when the list ends without the user', async () => {
      const r = await run(editorArgs, { handler: exists((c) => (page(c) === 1 ? users(other(1)) : users())) });
      expect(r.code).toBe(1);
      expect(r.err.join('\n')).toContain(
        'FAILED: a user with email editor@example.is already exists but was not found in the Auth users list (at most 100 pages of 200 are read); no invitation was sent and nothing was changed',
      );
      expect(r.calls.map((c) => new URL(c.url).pathname)).toEqual(['/auth/v1/invite', LIST, LIST]);
      expect(r.out).toEqual([`target: ${REF}.supabase.co`]);
    });

    it('stops at the page limit when the list never ends', async () => {
      const r = await run(editorArgs, { handler: exists(() => users(other(1))) });
      expect(r.code).toBe(1);
      expect(r.err.join('\n')).toContain('was not found in the Auth users list');
      expect(r.calls.filter((c) => new URL(c.url).pathname === LIST)).toHaveLength(100);
      noMemberships(r);
    });

    it('changes nothing when a page of the list fails, with status, code and message only', async () => {
      const r = await run(editorArgs, {
        handler: exists((c) => (page(c) === 1 ? users(other(1)) : json(500, { code: 500, error_code: 'unexpected_failure', msg: `bad ${KEY}`, users: [{ email: 'leak@example.is' }] }))),
      });
      expect(r.code).toBe(1);
      const text = r.err.join('\n');
      expect(text).toContain('FAILED: looking up the user with email editor@example.is: HTTP 500 unexpected_failure bad [redacted]; nothing was changed');
      expect(text).not.toContain('leak@example.is');
      noMemberships(r);
    });

    it('changes nothing when the connection drops during the lookup, without the error text', async () => {
      const r = await run(editorArgs, {
        handler: exists(() => {
          throw Object.assign(new TypeError(`fetch failed ${KEY}`), { cause: { code: 'ECONNRESET' } });
        }),
      });
      expect(r.code).toBe(1);
      expect(r.err.join('\n')).toContain('looking up the user with email editor@example.is: network error (ECONNRESET); nothing was changed');
      noMemberships(r);
    });

    it.each([
      ['no users field', () => json(200, { aud: 'authenticated' })],
      ['a list that is not one', () => json(200, { users: 'none' })],
      ['a body that is not JSON', () => new Response('<html>', { status: 200 })],
      ['a null body', () => json(200, null)],
    ])('changes nothing on a response with %s', async (_name, list) => {
      const r = await run(editorArgs, { handler: exists(list) });
      expect(r.code).toBe(1);
      expect(r.err.join('\n')).toContain('FAILED: unexpected response from the Auth users list; nothing was changed');
      noMemberships(r);
    });

    it.each([
      ['a user id that is not a uuid', { id: 'x', email: 'editor@example.is' }],
      ['no user id', { email: 'editor@example.is' }],
    ])('changes nothing on a matching user with %s', async (_name, user) => {
      const r = await run(editorArgs, { handler: exists(() => users(user)) });
      expect(r.code).toBe(1);
      expect(r.err.join('\n')).toContain('FAILED: unexpected response from the Auth users list; nothing was changed');
      noMemberships(r);
    });

    it('prints nothing else from the list', async () => {
      const r = await run(editorArgs, { handler: exists(() => users(other(1), { id: USER_ID, email: 'editor@example.is' })) });
      expect(r.code).toBe(0);
      expect(r.lines.join('\n')).not.toContain('other1@example.is');
    });

    it('prints the command that finishes a failed membership, as after an invitation', async () => {
      const r = await run(editorArgs, {
        handler: (c) =>
          (c.body as { p_tenant_id?: string } | undefined)?.p_tenant_id === TENANT_A
            ? json(400, { code: 'P0001', message: 'not_found' })
            : exists(() => users({ id: USER_ID, email: 'editor@example.is' }))(c),
      });
      expect(r.code).toBe(1);
      expect(r.err.join('\n')).toContain(`provision editor --user-id ${USER_ID} --tenant-id ${TENANT_A} --expect-ref ${REF}`);
    });
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

// Review focus 2: a rerun after a partial failure finishes the job and creates no duplicate. A small
// stateful project: `dropReply` applies the next matching write and loses its answer, `dropCall`
// loses the connection before the write. What each rerun sees comes from what the first run left.
describe('provision: a rerun after a partial failure', () => {
  const dropped = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
  const EMAIL = 'editor@example.is';

  function project(options: { confirmed?: boolean } = {}) {
    const state = {
      dropReply: null as string | null,
      dropCall: null as string | null,
      tenants: new Map<string, { id: string; name: string }>(),
      sites: [] as { id: string; base_url: string; secret: string }[],
      users: new Map<string, string>(),
      memberships: new Set<string>(),
      invitations: 0,
    };
    const reply = (rpc: string, write: () => void, answer: Response): Response => {
      if (state.dropCall === rpc) {
        state.dropCall = null;
        throw dropped();
      }
      write();
      if (state.dropReply === rpc) {
        state.dropReply = null;
        throw dropped();
      }
      return answer;
    };
    const handler: Handler = (c) => {
      const url = new URL(c.url);
      const body = c.body as Record<string, string>;
      if (url.pathname === '/auth/v1/invite') {
        state.invitations += 1;
        if (state.users.has(body['email'] as string) && options.confirmed) return json(422, { code: 422, error_code: 'email_exists', msg: 'already registered' });
        const id = state.users.get(body['email'] as string) ?? USER_ID;
        return reply('invite', () => state.users.set(body['email'] as string, id), json(200, { id, email: body['email'] }));
      }
      if (url.pathname === '/auth/v1/admin/users') {
        const page = url.searchParams.get('page');
        return json(200, { users: page === '1' ? [...state.users].map(([email, id]) => ({ id, email })) : [] });
      }
      if (url.pathname.endsWith('/admin_create_tenant')) {
        const existing = state.tenants.get(body['p_slug'] as string);
        if (existing && existing.name !== body['p_name']) return json(400, { code: 'P0001', message: 'slug_taken' });
        const id = existing?.id ?? NEW_TENANT;
        return reply('admin_create_tenant', () => state.tenants.set(body['p_slug'] as string, { id, name: body['p_name'] as string }), json(200, id));
      }
      if (url.pathname.endsWith('/worker_sites')) return json(200, state.sites.map(({ id, base_url }) => ({ id, base_url })));
      if (url.pathname.endsWith('/admin_create_site')) {
        return reply('admin_create_site', () => state.sites.push({ id: SITE_ID, base_url: body['p_base_url'] as string, secret: body['p_webhook_secret'] as string }), json(200, SITE_ID));
      }
      if (url.pathname.endsWith('/admin_add_membership')) {
        return reply('admin_add_membership', () => state.memberships.add(`${body['p_tenant_id']}/${body['p_user_id']}`), new Response(null, { status: 204 }));
      }
      if (url.pathname.endsWith('/admin_remove_membership')) {
        return reply('admin_remove_membership', () => state.memberships.delete(`${body['p_tenant_id']}/${body['p_user_id']}`), new Response(null, { status: 204 }));
      }
      if (url.pathname.endsWith('/admin_set_webhook_secret')) {
        return reply('admin_set_webhook_secret', () => ((state.sites[0] as { secret: string }).secret = body['p_webhook_secret'] as string), new Response(null, { status: 204 }));
      }
      return json(404, {});
    };
    return { state, handler };
  }

  it('tenant: the answer was lost after the insert; the rerun prints the same id and creates no other', async () => {
    const { state, handler } = project();
    state.dropReply = 'admin_create_tenant';
    expect((await run(tenantArgs, { handler })).code).toBe(1);
    const r = await run(tenantArgs, { handler });
    expect(r.code).toBe(0);
    expect(r.out).toContain(`tenant acme: ${NEW_TENANT}`);
    expect(state.tenants.size).toBe(1);
  });

  it('site: the answer was lost after the insert; the rerun prints the site, and the first secret stays', async () => {
    const { state, handler } = project();
    state.dropReply = 'admin_create_site';
    expect((await run(siteArgs, { stdin: SECRET, handler })).code).toBe(1);
    const r = await run(siteArgs, { stdin: `second-${SECRET}`, handler });
    expect(r.code).toBe(0);
    expect(r.out.join('\n')).toContain(SITE_ID);
    expect(r.out.join('\n')).toContain('the webhook secret was not changed');
    expect(state.sites).toEqual([{ id: SITE_ID, base_url: 'https://site.example.is', secret: SECRET }]);
  });

  it('site: the connection dropped before the insert; the rerun creates the one site', async () => {
    const { state, handler } = project();
    state.dropCall = 'admin_create_site';
    expect((await run(siteArgs, { stdin: SECRET, handler })).code).toBe(1);
    expect(state.sites).toEqual([]);
    const r = await run(siteArgs, { stdin: SECRET, handler });
    expect(r.code).toBe(0);
    expect(r.out).toContain(`site: ${SITE_ID}`);
    expect(state.sites).toHaveLength(1);
  });

  it.each([
    ['who has confirmed', true],
    ['who has not confirmed yet', false],
  ])('editor: the connection dropped between the invitation and the membership, for a user %s', async (_name, confirmed) => {
    const { state, handler } = project({ confirmed });
    state.dropCall = 'admin_add_membership';
    const first = await run(editorArgs, { handler });
    expect(first.code).toBe(1);
    expect(first.err.join('\n')).toContain(`is still missing memberships in: ${TENANT_A}`);
    expect(state.memberships).toEqual(new Set([`${TENANT_B}/${USER_ID}`]));

    const r = await run(editorArgs, { handler });
    expect(r.code).toBe(0);
    expect(state.users).toEqual(new Map([[EMAIL, USER_ID]]));
    expect(state.memberships).toEqual(new Set([`${TENANT_A}/${USER_ID}`, `${TENANT_B}/${USER_ID}`]));
  });

  it('editor: the answer to the invitation was lost; the rerun finds the user and adds the memberships', async () => {
    const { state, handler } = project({ confirmed: true });
    state.dropReply = 'invite';
    expect((await run(editorArgs, { handler })).code).toBe(1);
    expect(state.memberships.size).toBe(0);
    const r = await run(editorArgs, { handler });
    expect(r.code).toBe(0);
    expect(state.users.size).toBe(1);
    expect(state.memberships.size).toBe(2);
  });

  it('editor: a third run changes nothing', async () => {
    const { state, handler } = project({ confirmed: true });
    expect((await run(editorArgs, { handler })).code).toBe(0);
    expect((await run(editorArgs, { handler })).code).toBe(0);
    expect((await run(editorArgs, { handler })).code).toBe(0);
    expect(state.users.size).toBe(1);
    expect(state.memberships.size).toBe(2);
  });

  it('remove-editor: the connection dropped on one tenant; the printed command finishes the job', async () => {
    const { state, handler } = project();
    state.memberships.add(`${TENANT_A}/${USER_ID}`).add(`${TENANT_B}/${USER_ID}`);
    state.dropCall = 'admin_remove_membership';
    const first = await run(removeArgs, { handler });
    expect(first.code).toBe(1);
    expect(state.memberships).toEqual(new Set([`${TENANT_A}/${USER_ID}`]));

    const finish = (first.err.join('\n').match(/finish with: pnpm --silent --filter @litljomi\/cli cli (.*)$/m) as RegExpMatchArray)[1] as string;
    const r = await run(finish.split(' '), { handler });
    expect(r.code).toBe(0);
    expect(state.memberships.size).toBe(0);
  });

  it('remove-editor: a rerun over what was removed already exits 0', async () => {
    const { state, handler } = project();
    state.dropReply = 'admin_remove_membership';
    state.memberships.add(`${TENANT_A}/${USER_ID}`).add(`${TENANT_B}/${USER_ID}`);
    expect((await run(removeArgs, { handler })).code).toBe(1);
    expect((await run(removeArgs, { handler })).code).toBe(0);
    expect(state.memberships.size).toBe(0);
  });

  it('webhook-secret: the answer was lost after the update; the rerun sets the same value', async () => {
    const { state, handler } = project();
    state.sites.push({ id: SITE_ID, base_url: 'https://site.example.is', secret: 'old' });
    state.dropReply = 'admin_set_webhook_secret';
    expect((await run(webhookArgs, { stdin: SECRET, handler })).code).toBe(1);
    expect((await run(webhookArgs, { stdin: SECRET, handler })).code).toBe(0);
    expect(state.sites).toEqual([{ id: SITE_ID, base_url: 'https://site.example.is', secret: SECRET }]);
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
