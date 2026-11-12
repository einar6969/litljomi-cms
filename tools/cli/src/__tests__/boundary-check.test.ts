import { afterEach, describe, expect, it } from 'vitest';
import demo from '@litljomi/module-demo';
import labak from '@litljomi/module-labak';
import type { ModuleManifest } from '@litljomi/cms-schema';
import { runCli } from '../cli.ts';
import { BOUNDARY_TITLE, TEST_SIDES, type BoundaryCheckDeps } from '../boundary-check.ts';

// Test values only: no real project, key or token.
const REF = 'abcdefghij0123456789';
const ORIGIN = `https://${REF}.supabase.co`;
const SK = 'sb_secret_TESTONLYkey-0123456789_abc.def';
const PK = 'sb_publishable_TESTONLYpk-9876543210_xyz';
const ENV_FILE = '/test/.env.production.local';
const DEFAULT_ENV_FILE = '/Users/einarzoega/litljomi-cms/.env.production.local';
const LABAK = '11111111-1111-4111-8111-111111111111';
const DEMO = '22222222-2222-4222-8222-222222222222';
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9];
const LABAK_EMAIL = 'einsi+a-labak@litljomi.is';
const DEMO_EMAIL = 'einsi+a-demo@litljomi.is';

const goodEnv = [
  '# production',
  `NEXT_PUBLIC_SUPABASE_URL=${ORIGIN}`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${PK}`,
  `SUPABASE_SECRET_KEY=${SK}`,
  '',
].join('\n');

interface Call {
  url: string;
  path: string;
  method: string;
  init: RequestInit;
  headers: Headers;
  json: unknown;
  bytes: Uint8Array | undefined;
}

type Handler = (call: Call) => Response | Promise<Response>;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const pgError = (status: number, code: string, message: string) => json(status, { code, message, details: null, hint: null });
const storageError = (statusCode: string, error: string, message: string) => json(400, { statusCode, error, message });

// ---------------------------------------------------------------------------------------------
// A fake production project with the boundary the local suite proves (state persists across runs).

interface Entry {
  id: string;
  tenant_id: string;
  type: string;
  title: string | null;
  version: number;
}

interface World {
  slugs: Record<string, string>;
  users: Map<string, string>; // email -> id
  memberships: Set<string>; // `${tenant}:${user}`
  entries: Entry[];
  objects: Map<string, Uint8Array<ArrayBuffer>>; // `${bucket}/${path}`
  tokens: Set<string>;
  nextId: number;
}

const newWorld = (): World => ({
  slugs: { [LABAK]: 'labak', [DEMO]: 'demo' },
  users: new Map(),
  memberships: new Set(),
  entries: [],
  objects: new Map(),
  tokens: new Set(),
  nextId: 1,
});

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

type Principal = { kind: 'anon' } | { kind: 'secret' } | { kind: 'editor'; userId: string } | { kind: 'bad' };

function principal(c: Call): Principal {
  const auth = c.headers.get('Authorization');
  const apikey = c.headers.get('apikey');
  if (auth === `Bearer ${SK}` && apikey === SK) return { kind: 'secret' };
  if (auth === null && apikey === PK) return { kind: 'anon' };
  const token = auth?.startsWith('Bearer tok-') ? auth.slice('Bearer '.length) : undefined;
  if (token !== undefined && apikey === PK) return { kind: 'editor', userId: token.slice('tok-'.length, 'tok-'.length + 36) };
  return { kind: 'bad' };
}

const isMember = (w: World, tenant: string, user: string) => w.memberships.has(`${tenant}:${user}`);
const denied = (p: Principal) => pgError(p.kind === 'anon' ? 401 : 403, '42501', 'permission denied for function');

function production(w: World): Handler {
  return (c) => {
    const p = principal(c);
    if (p.kind === 'bad') return json(401, { message: 'bad credentials' });
    const url = new URL(c.url);
    const body = (c.json ?? {}) as Record<string, unknown>;

    // Auth
    if (c.path === '/auth/v1/admin/users' && c.method === 'POST') {
      if (p.kind !== 'secret') return json(403, { code: 403, error_code: 'not_admin', msg: 'User not allowed' });
      const email = body.email as string;
      if (w.users.has(email)) return json(422, { code: 422, error_code: 'email_exists', msg: 'A user with this email address has already been registered' });
      const id = uuid(1000 + w.nextId++);
      w.users.set(email, id);
      return json(200, { id, email, aud: 'authenticated' });
    }
    if (c.path === '/auth/v1/admin/generate_link' && c.method === 'POST') {
      if (p.kind !== 'secret') return json(403, { code: 403, error_code: 'not_admin', msg: 'User not allowed' });
      const id = w.users.get(body.email as string);
      if (id === undefined) return json(404, { code: 404, error_code: 'user_not_found', msg: 'User not found' });
      const type = body.type as string;
      return json(200, {
        id,
        email: body.email,
        action_link: `${ORIGIN}/auth/v1/verify?token=hash-${type}-${id}&type=${type}`,
        email_otp: 'otp-918273',
        hashed_token: `hash-${type}-${id}`,
        verification_type: type,
        redirect_to: 'https://cms.example.is',
      });
    }
    if (c.path === '/auth/v1/verify' && c.method === 'POST') {
      if (p.kind !== 'anon') return json(400, { msg: 'unexpected key' });
      const hash = body.token_hash as string;
      const prefix = `hash-${body.type as string}-`;
      const id = hash?.startsWith(prefix) ? hash.slice(prefix.length) : '';
      // A token hash verifies only as the type it was generated for.
      if (![...w.users.values()].includes(id)) return json(403, { code: 403, error_code: 'otp_expired', msg: 'Token has expired' });
      const token = `tok-${id}-${w.nextId++}`;
      w.tokens.add(token);
      return json(200, { access_token: token, token_type: 'bearer', expires_in: 3600, refresh_token: `refresh-${id}`, user: { id } });
    }

    // GraphQL is not exposed.
    if (c.path === '/graphql/v1') return pgError(406, 'PGRST106', 'The schema must be one of the following: api');

    // Data API
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      if (c.headers.get('Content-Profile') !== 'api') return pgError(406, 'PGRST106', 'The schema must be one of the following: api');
      const fn = url.pathname.slice('/rest/v1/rpc/'.length);
      if (fn === 'admin_add_membership') {
        if (p.kind !== 'secret') return denied(p);
        if (!(body.p_tenant_id as string in w.slugs)) return pgError(400, 'P0001', 'not_found');
        w.memberships.add(`${body.p_tenant_id}:${body.p_user_id}`);
        return new Response(null, { status: 204 });
      }
      if (fn === 'worker_previous_release') {
        if (p.kind !== 'secret') return denied(p);
        const slug = w.slugs[body.p_tenant_id as string];
        // A composite result: a tenant without a delivered release gives a row of nulls.
        if (slug === undefined) return json(200, { id: null, tenant_id: null, number: null, status: null, bundle_path: null });
        return json(200, { id: uuid(9), tenant_id: body.p_tenant_id, number: 3, status: 'delivered', bundle_path: `${slug}/releases/3.json` });
      }
      if (fn === 'create_entry') {
        if (p.kind !== 'editor') return denied(p);
        if (!isMember(w, body.p_tenant_id as string, p.userId)) return pgError(400, 'P0001', 'not_found');
        const id = uuid(5000 + w.nextId++);
        w.entries.push({ id, tenant_id: body.p_tenant_id as string, type: body.p_type as string, title: null, version: 1 });
        return json(200, id);
      }
      if (fn === 'save_draft') {
        if (p.kind !== 'editor') return denied(p);
        const e = w.entries.find((x) => x.id === body.p_entry_id && isMember(w, x.tenant_id, p.userId));
        if (e === undefined) return pgError(400, 'P0001', 'not_found');
        if (e.version !== body.p_expected_version) return pgError(400, 'P0001', 'version_conflict');
        e.version += 1;
        e.title = body.p_title as string;
        return json(200, e.version);
      }
      return pgError(404, 'PGRST202', 'Could not find the function');
    }
    if (url.pathname.startsWith('/rest/v1/') && c.method === 'GET') {
      if (c.headers.get('Accept-Profile') !== 'api') return pgError(406, 'PGRST106', 'The schema must be one of the following: api');
      const view = url.pathname.slice('/rest/v1/'.length);
      if (p.kind !== 'editor') return pgError(p.kind === 'anon' ? 401 : 403, '42501', 'permission denied for view');
      const uid = p.userId;
      let rows: Record<string, unknown>[];
      if (view === 'my_tenants') {
        rows = Object.entries(w.slugs).filter(([id]) => isMember(w, id, uid)).map(([id, slug]) => ({ id, slug, name: slug, status: 'active' }));
      } else if (view === 'entry_list') {
        rows = w.entries.filter((e) => isMember(w, e.tenant_id, uid)).map((e) => ({ ...e, draft_version: e.version }));
      } else {
        return pgError(404, 'PGRST205', 'Could not find the table');
      }
      for (const [k, v] of url.searchParams) {
        if (['select', 'limit', 'order'].includes(k)) continue;
        if (!v.startsWith('eq.')) return pgError(400, 'PGRST100', 'bad filter');
        rows = rows.filter((r) => String(r[k]) === v.slice(3));
      }
      const limit = url.searchParams.get('limit');
      if (limit !== null) rows = rows.slice(0, Number(limit));
      return json(200, rows);
    }

    // Storage
    if (url.pathname.startsWith('/storage/v1/object/')) {
      const rest = decodeURIComponent(url.pathname.slice('/storage/v1/object/'.length));
      const slash = rest.indexOf('/');
      const bucket = slash === -1 ? rest : rest.slice(0, slash);
      const objectPath = slash === -1 ? '' : rest.slice(slash + 1);
      const key = `${bucket}/${objectPath}`;
      const editorOf = (tenantFolder: string) => p.kind === 'editor' && isMember(w, tenantFolder, p.userId);
      const folder = objectPath.split('/')[0] ?? '';
      if (c.method === 'GET') {
        if (bucket === 'media-private' && editorOf(folder) && w.objects.has(key)) return new Response(w.objects.get(key) as Uint8Array<ArrayBuffer>, { status: 200 });
        return storageError('404', 'not_found', 'Object not found');
      }
      if (c.method === 'DELETE') return json(200, []);
      if (c.method === 'PUT') return storageError('403', 'Unauthorized', 'new row violates row-level security policy');
      if (c.method === 'POST') {
        if (bucket !== 'media-private' || !editorOf(folder)) return storageError('403', 'Unauthorized', 'new row violates row-level security policy');
        if (w.objects.has(key)) {
          if (c.headers.get('x-upsert') === 'true') return storageError('403', 'Unauthorized', 'new row violates row-level security policy');
          return storageError('409', 'Duplicate', 'The resource already exists');
        }
        w.objects.set(key, c.bytes as Uint8Array<ArrayBuffer>);
        return json(200, { Key: key, Id: uuid(8000 + w.nextId++) });
      }
    }
    return json(404, { message: 'no route' });
  };
}

// ---------------------------------------------------------------------------------------------
// The runner

interface Run {
  code: number;
  out: string[];
  err: string[];
  lines: string[];
  calls: Call[];
  fileReads: number;
  world: World;
}

const runs: Run[] = [];

async function run(
  args: string[],
  opts: { env?: string | null; world?: World; handler?: (base: Handler) => Handler; noNetwork?: boolean } = {},
): Promise<Run> {
  const world = opts.world ?? newWorld();
  const base = production(world);
  const handler = opts.handler ? opts.handler(base) : base;
  const result: Run = { code: -1, out: [], err: [], lines: [], calls: [], fileReads: 0, world };
  const deps: BoundaryCheckDeps = {
    fetch: async (url, init) => {
      const raw = init.body;
      let parsed: unknown;
      let bytes: Uint8Array | undefined;
      if (typeof raw === 'string') {
        try {
          parsed = JSON.parse(raw) as unknown;
        } catch {
          parsed = undefined;
        }
      } else if (raw instanceof Uint8Array) {
        bytes = new Uint8Array(raw);
      }
      const u = new URL(url);
      const call: Call = { url, path: u.pathname, method: init.method ?? 'GET', init, headers: new Headers(init.headers), json: parsed, bytes };
      result.calls.push(call);
      if (opts.noNetwork) throw new Error('no request expected');
      return handler(call);
    },
    readTextFile: async (path) => {
      result.fileReads += 1;
      if (opts.env === null || (path !== ENV_FILE && path !== DEFAULT_ENV_FILE)) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
      return opts.env ?? goodEnv;
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
    boundaryCheck: deps,
  });
  runs.push(result);
  return result;
}

// Every run, whatever its outcome: no key, token, link or hashed token in any output; every request
// to the target origin only, with no redirect followed; never an invitation, never a user deletion;
// no storage write or delete with the secret key; no password set.
afterEach(() => {
  for (const r of runs.splice(0)) {
    const text = r.lines.join('\n');
    expect(text).not.toContain(SK);
    expect(text).not.toContain(PK);
    expect(text).not.toContain('tok-');
    expect(text).not.toContain('hash-');
    expect(text).not.toContain('refresh-');
    expect(text).not.toContain('otp-');
    expect(text).not.toContain('action_link');
    for (const c of r.calls) {
      expect(new URL(c.url).origin).toBe(ORIGIN);
      expect(c.init.redirect).toBe('error');
      expect(c.url).not.toContain(SK);
      expect(c.url).not.toContain('tok-');
      expect(c.path).not.toBe('/auth/v1/invite');
      expect(c.path.startsWith('/auth/v1/admin/users') && c.method === 'DELETE').toBe(false);
      if (c.path.startsWith('/storage/') && c.method !== 'GET') expect(c.headers.get('Authorization')).not.toBe(`Bearer ${SK}`);
      if (c.path === '/auth/v1/admin/users') {
        expect(c.json).toEqual({ email: expect.any(String), email_confirm: true });
      }
    }
  }
});

const common = ['--expect-ref', REF, `--env-file=${ENV_FILE}`];
const args = ['boundary-check', '--labak-tenant-id', LABAK, '--demo-tenant-id', DEMO, ...common];
const resultLine = (r: Run) => r.out.at(-1);
const line = (r: Run, pattern: RegExp) => r.out.filter((l) => pattern.test(l));
const fails = (r: Run) => r.out.filter((l) => l.startsWith('FAIL '));
const TOTAL = 71;

// ---------------------------------------------------------------------------------------------

describe('boundary-check: arguments', () => {
  it.each([
    ['no flags', ['boundary-check']],
    ['a missing --expect-ref', ['boundary-check', '--labak-tenant-id', LABAK, '--demo-tenant-id', DEMO, `--env-file=${ENV_FILE}`]],
    ['a missing --labak-tenant-id', ['boundary-check', '--demo-tenant-id', DEMO, ...common]],
    ['a missing --demo-tenant-id', ['boundary-check', '--labak-tenant-id', LABAK, ...common]],
    ['a malformed tenant id', ['boundary-check', '--labak-tenant-id', 'labak', '--demo-tenant-id', DEMO, ...common]],
    ['an uppercase tenant id', ['boundary-check', '--labak-tenant-id', 'A1A40000-1ABC-4000-8000-0000000000AB', '--demo-tenant-id', DEMO, ...common]],
    ['the same tenant twice', ['boundary-check', '--labak-tenant-id', LABAK, '--demo-tenant-id', LABAK, ...common]],
    ['a repeated flag', [...args, '--labak-tenant-id', LABAK]],
    ['an unknown flag', [...args, '--local']],
    ['a positional argument', [...args, 'extra']],
    ['a relative --env-file', ['boundary-check', '--labak-tenant-id', LABAK, '--demo-tenant-id', DEMO, '--expect-ref', REF, '--env-file=.env.production.local']],
  ])('refuses %s with usage (exit 2), before reading anything', async (_name, a) => {
    const r = await run(a, { noNetwork: true });
    expect(r.code).toBe(2);
    expect(r.err.join('\n')).toContain('usage: boundary-check');
    expect(r.calls).toHaveLength(0);
    expect(r.fileReads).toBe(0);
  });

  it('refuses to run without injected dependencies', async () => {
    const errors: string[] = [];
    const code = await runCli(args, { log: () => {}, error: (l) => errors.push(l) });
    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('boundary-check');
  });

  it('lists boundary-check in the CLI usage', async () => {
    const errors: string[] = [];
    expect(await runCli(['nope'], { log: () => {}, error: (l) => errors.push(l) })).toBe(2);
    expect(errors.join('\n')).toContain('boundary-check --labak-tenant-id <uuid> --demo-tenant-id <uuid> --expect-ref <ref>');
  });
});

describe('boundary-check: the target project', () => {
  it.each([['short'], ['ABCDEFGHIJ0123456789'], ['']])('refuses --expect-ref %j before reading the env file', async (ref) => {
    const r = await run(['boundary-check', '--labak-tenant-id', LABAK, '--demo-tenant-id', DEMO, '--expect-ref', ref], { noNetwork: true });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain("FAILED: --expect-ref must be the hosted project's reference (20 lowercase letters or digits); nothing was sent");
    expect(r.fileReads).toBe(0);
    expect(r.calls).toHaveLength(0);
  });

  it('refuses a URL for another project, naming the hosts, and sends nothing', async () => {
    const r = await run(args, { env: goodEnv.replace(ORIGIN, 'https://zzzzzzzzzz0123456789.supabase.co'), noNetwork: true });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toMatch(/zzzzzzzzzz0123456789\.supabase\.co, not abcdefghij0123456789\.supabase\.co; nothing was sent/);
    expect(r.calls).toHaveLength(0);
  });

  it.each([
    ['a loopback URL', goodEnv.replace(ORIGIN, 'http://127.0.0.1:54321'), 'NEXT_PUBLIC_SUPABASE_URL', 'unexpected form'],
    ['another host', goodEnv.replace(ORIGIN, `https://${REF}.example.com`), 'NEXT_PUBLIC_SUPABASE_URL', 'unexpected form'],
    ['a duplicate secret key line', `${goodEnv}SUPABASE_SECRET_KEY=${SK}x\n`, 'SUPABASE_SECRET_KEY', 'found 2'],
    ['an export line', goodEnv.replace('SUPABASE_SECRET_KEY=', 'export SUPABASE_SECRET_KEY='), 'SUPABASE_SECRET_KEY', 'exactly one plain'],
    ['a missing publishable key', goodEnv.replace(`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${PK}`, ''), 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'found 0'],
    ['a duplicate publishable key', `${goodEnv}NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${PK}\n`, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'found 2'],
    ['spaces around = for the publishable key', goodEnv.replace('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = '), 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'exactly one plain'],
    ['a quoted publishable key', goodEnv.replace(`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${PK}`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="${PK}"`), 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'unexpected form'],
    ['a publishable key with a $', goodEnv.replace(`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${PK}`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${PK}$X`), 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'unexpected form'],
  ])('refuses %s, naming the variable and not its value', async (_name, env, variable, reason) => {
    const r = await run(args, { env, noNetwork: true });
    expect(r.code).toBe(1);
    const text = r.err.join('\n');
    expect(text).toContain(`FAILED: ${variable}`);
    expect(text).toContain(reason);
    expect(text).toContain('nothing was sent');
    expect(r.calls).toHaveLength(0);
    expect(r.out).toHaveLength(0);
  });

  it('refuses a missing env file', async () => {
    const r = await run(args, { env: null, noNetwork: true });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain(`FAILED: ${ENV_FILE} could not be read; nothing was sent`);
  });

  it('reads the default env file when --env-file is not given', async () => {
    const r = await run(['boundary-check', '--labak-tenant-id', LABAK, '--demo-tenant-id', DEMO, '--expect-ref', REF]);
    expect(r.code).toBe(0);
  });
});

describe('boundary-check: a production project that holds the boundary', () => {
  it('passes every check, prints the target first and the RESULT line last, and exits 0', async () => {
    const r = await run(args);
    expect(r.err).toEqual([]);
    expect(r.code).toBe(0);
    expect(r.out[0]).toBe(`target: ${REF}.supabase.co`);
    expect(fails(r)).toEqual([]);
    expect(line(r, /^PASS /)).toHaveLength(TOTAL);
    expect(resultLine(r)).toBe(`RESULT: ${TOTAL} passed, 0 failed`);
    // Every line between the target and the summary is a check line.
    const firstSummary = r.out.findIndex((l) => l.startsWith('test user '));
    expect(r.out.slice(1, firstSummary).every((l) => /^PASS A[1-4] /.test(l))).toBe(true);
  });

  it('covers each gate with the expected observations', async () => {
    const r = await run(args);
    for (const schema of ['cms', 'private', 'public', 'graphql_public']) {
      for (const who of ['anon', 'the labak editor', 'the demo editor', 'the secret key']) {
        expect(line(r, new RegExp(`^PASS A1 schema ${schema} table read refused for ${who} \\(406 PGRST106\\)$`))).toHaveLength(1);
        expect(line(r, new RegExp(`^PASS A1 schema ${schema} rpc refused for ${who} \\(406 PGRST106\\)$`))).toHaveLength(1);
      }
    }
    expect(line(r, /^PASS A1 GraphQL refused for /)).toHaveLength(3);
    expect(line(r, /^PASS A2 labak editor creates its test entry \(200\)$/)).toHaveLength(1);
    expect(line(r, /^PASS A2 demo editor saves a draft in its own tenant \(200\)$/)).toHaveLength(1);
    expect(line(r, /^PASS A2 labak editor cannot create an entry in the demo tenant \(400 P0001 not_found\)$/)).toHaveLength(1);
    expect(line(r, /^PASS A2 demo editor cannot save the labak test draft \(400 P0001 not_found\)$/)).toHaveLength(1);
    expect(line(r, /^PASS A2 labak editor's entry list shows no rows of the demo tenant \(200\)$/)).toHaveLength(1);
    expect(line(r, /^PASS A3 worker_previous_release accepted for the secret key \(200\)$/)).toHaveLength(1);
    expect(line(r, /^PASS A3 worker_previous_release refused for anon \(401 42501\)$/)).toHaveLength(1);
    expect(line(r, /^PASS A3 worker_previous_release refused for the labak editor \(403 42501\)$/)).toHaveLength(1);
    expect(line(r, /^PASS A4 labak editor uploads its own object \(200\)$/)).toHaveLength(1);
    expect(line(r, /^PASS A4 demo editor cannot upload into the labak prefix \(400 Unauthorized new row violates row-level security policy\)$/)).toHaveLength(1);
    expect(line(r, /^PASS A4 labak editor cannot read the demo test object \(400 not_found Object not found\)$/)).toHaveLength(1);
    expect(line(r, /^PASS A4 labak editor cannot delete its own object \(DELETE 200, then download 200\)$/)).toHaveLength(1);
    expect(line(r, /^PASS A4 demo editor cannot upload to media-public under the tenant slug /)).toHaveLength(1);
    expect(line(r, /^PASS A4 demo editor cannot upload to delivery /)).toHaveLength(1);
  });

  it('creates two confirmed users with no password and no email, one membership each, and prints their ids', async () => {
    const r = await run(args);
    const creates = r.calls.filter((c) => c.path === '/auth/v1/admin/users');
    expect(creates.map((c) => c.json)).toEqual([
      { email: LABAK_EMAIL, email_confirm: true },
      { email: DEMO_EMAIL, email_confirm: true },
    ]);
    const memberships = r.calls.filter((c) => c.path === '/rest/v1/rpc/admin_add_membership');
    const labakId = r.world.users.get(LABAK_EMAIL);
    const demoId = r.world.users.get(DEMO_EMAIL);
    expect(memberships.map((c) => c.json)).toEqual([
      { p_tenant_id: LABAK, p_user_id: labakId },
      { p_tenant_id: DEMO, p_user_id: demoId },
    ]);
    expect([...r.world.memberships].sort()).toEqual([`${DEMO}:${demoId}`, `${LABAK}:${labakId}`].sort());
    expect(r.out).toContain(`test user ${LABAK_EMAIL}: ${labakId} (created)`);
    expect(r.out).toContain(`test user ${DEMO_EMAIL}: ${demoId} (created)`);
    // Sessions: a recovery link from generate_link with the secret key (it sends no email), verified
    // by POST with the publishable key only; the sign-in hook allows it as otp (decision 72.1).
    // The test editors have no password.
    const links = r.calls.filter((c) => c.path === '/auth/v1/admin/generate_link');
    expect(links.map((c) => c.json)).toEqual([
      { type: 'recovery', email: LABAK_EMAIL },
      { type: 'recovery', email: DEMO_EMAIL },
    ]);
    for (const c of r.calls.filter((x) => x.path === '/auth/v1/verify')) {
      expect(c.headers.get('apikey')).toBe(PK);
      expect(c.headers.get('Authorization')).toBeNull();
      expect(c.json).toEqual({ type: 'recovery', token_hash: expect.stringMatching(/^hash-recovery-/) });
    }
  });

  it('leaves two drafts titled for the check and two tiny objects, and prints their ids', async () => {
    const r = await run(args);
    expect(r.world.entries).toHaveLength(2);
    expect(r.world.entries.map((e) => [e.tenant_id, e.type, e.title])).toEqual([
      [LABAK, 'news', BOUNDARY_TITLE],
      [DEMO, 'event', BOUNDARY_TITLE],
    ]);
    const [le, de] = r.world.entries as [Entry, Entry];
    expect(r.out).toContain(`entry ${LABAK}: ${le.id} (created)`);
    expect(r.out).toContain(`entry ${DEMO}: ${de.id} (created)`);
    const labakObject = `media-private/${LABAK}/${TEST_SIDES.labak.objectId}/a.jpg`;
    const demoObject = `media-private/${DEMO}/${TEST_SIDES.demo.objectId}/a.jpg`;
    expect([...r.world.objects.keys()].sort()).toEqual([labakObject, demoObject].sort());
    expect([...(r.world.objects.get(labakObject) as Uint8Array)]).toEqual(JPEG);
    expect(r.out).toContain(`object ${LABAK}: ${labakObject} (uploaded)`);
    expect(r.out).toContain(`object ${DEMO}: ${demoObject} (uploaded)`);
  });

  it('sends the key in headers only: anon has the publishable key and no Authorization, editors a Bearer token', async () => {
    const r = await run(args);
    for (const c of r.calls) {
      const auth = c.headers.get('Authorization');
      const apikey = c.headers.get('apikey');
      if (apikey === SK) expect(auth).toBe(`Bearer ${SK}`);
      else {
        expect(apikey).toBe(PK);
        if (auth !== null) expect(auth).toMatch(/^Bearer tok-/);
      }
    }
    // Uploads carry the tiny JPEG as image/jpeg, upsert off unless the upsert check.
    const uploads = r.calls.filter((c) => c.method === 'POST' && c.path.startsWith('/storage/v1/object/media-private/'));
    expect(uploads.every((c) => c.headers.get('Content-Type') === 'image/jpeg')).toBe(true);
  });

  it('is idempotent: a second run reuses the users, the entries and the objects, and says so', async () => {
    const world = newWorld();
    const first = await run(args, { world });
    expect(first.code).toBe(0);
    const users = new Map(world.users);
    const second = await run(args, { world });
    expect(second.code).toBe(0);
    expect(resultLine(second)).toBe(`RESULT: ${TOTAL} passed, 0 failed`);
    expect(world.users).toEqual(users);
    expect(world.entries).toHaveLength(2);
    expect(world.entries.every((e) => e.version === 3)).toBe(true);
    expect(world.memberships.size).toBe(2);
    expect(world.objects.size).toBe(2);
    expect(second.out).toContain(`test user ${LABAK_EMAIL}: ${users.get(LABAK_EMAIL)} (existing, reused)`);
    expect(line(second, /^PASS A2 labak editor reuses its test entry, found by title \(200\)$/)).toHaveLength(1);
    expect(
      line(second, /^PASS A4 labak editor's own object already existed from an earlier run; downloaded and verified \(400 Duplicate, then 200\)$/),
    ).toHaveLength(1);
    expect(second.out.some((l) => /^object .*\(already existed; downloaded and verified\)$/.test(l))).toBe(true);
    // The reused entry was found through the editor's own api.entry_list, by its fixed title.
    const find = second.calls.find((c) => c.path === '/rest/v1/entry_list' && new URL(c.url).searchParams.get('title') !== null) as Call;
    expect(new URL(find.url).searchParams.get('title')).toBe(`eq.${BOUNDARY_TITLE}`);
    expect(find.headers.get('Authorization')).toMatch(/^Bearer tok-/);
  });

  it('keeps going when an earlier run created the user but not the membership', async () => {
    const world = newWorld();
    world.users.set(LABAK_EMAIL, uuid(77));
    const r = await run(args, { world });
    expect(r.code).toBe(0);
    expect(world.memberships.has(`${LABAK}:${uuid(77)}`)).toBe(true);
  });
});

describe('boundary-check: setup refusals', () => {
  it('refuses to run the checks when a test user is a member of the other tenant', async () => {
    const world = newWorld();
    world.users.set(LABAK_EMAIL, uuid(77));
    world.memberships.add(`${DEMO}:${uuid(77)}`);
    const r = await run(args, { world });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain(
      `FAILED: setup: test user ${LABAK_EMAIL} (${uuid(77)}) is a member of another tenant (${DEMO}); refusing to run the checks`,
    );
    expect(r.out.some((l) => l.startsWith('RESULT:'))).toBe(false);
    expect(r.calls.some((c) => c.path.startsWith('/storage/') || c.path.includes('create_entry'))).toBe(false);
  });

  it('refuses tenant ids given the wrong way round before creating or changing anything', async () => {
    const r = await run(['boundary-check', '--labak-tenant-id', DEMO, '--demo-tenant-id', LABAK, ...common]);
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain(`FAILED: setup: --labak-tenant-id ${DEMO} is the tenant demo, not labak; nothing was done`);
    // Only the read-only slug check (worker_previous_release with the secret key) was sent.
    expect(r.calls.map((c) => c.path)).toEqual(['/rest/v1/rpc/worker_previous_release']);
    expect(r.calls[0]?.json).toEqual({ p_tenant_id: DEMO });
  });

  it('refuses a tenant whose slug cannot be confirmed (no delivered release), before changing anything', async () => {
    const world = newWorld();
    delete world.slugs[DEMO];
    const r = await run(args, { world });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain(`FAILED: setup: tenant ${DEMO} has no delivered release, so its slug cannot be confirmed; nothing was done`);
    expect(r.calls.every((c) => c.path === '/rest/v1/rpc/worker_previous_release')).toBe(true);
  });

  it('reports a failed membership as status, code and message, and stops', async () => {
    const r = await run(args, {
      handler: (base) => (c) => (c.path === '/rest/v1/rpc/admin_add_membership' ? pgError(400, 'P0001', 'not_found') : base(c)),
    });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain(`FAILED: setup: membership ${LABAK} for ${LABAK_EMAIL}: HTTP 400 P0001 not_found`);
    expect(r.out.some((l) => l.startsWith('RESULT:'))).toBe(false);
  });

  it('reports a failed user creation as status, code and message, and stops', async () => {
    const r = await run(args, {
      handler: (base) => (c) => (c.path === '/auth/v1/admin/users' ? json(500, { code: 500, error_code: 'unexpected_failure', msg: 'Database error' }) : base(c)),
    });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain(`FAILED: setup: test user ${LABAK_EMAIL}: HTTP 500 unexpected_failure Database error`);
    expect(r.calls.map((c) => c.path)).toEqual(['/rest/v1/rpc/worker_previous_release', '/rest/v1/rpc/worker_previous_release', '/auth/v1/admin/users']);
  });

  it('refuses a verified session for another user than the generated link', async () => {
    const r = await run(args, {
      handler: (base) => async (c) => {
        const res = await base(c);
        if (c.path !== '/auth/v1/verify') return res;
        const body = (await res.json()) as Record<string, unknown>;
        return json(200, { ...body, user: { id: uuid(4242) } });
      },
    });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain(`FAILED: setup: the session for ${LABAK_EMAIL} is not for user`);
  });

  it('stops on a transport error during setup without crashing', async () => {
    const r = await run(args, {
      handler: (base) => (c) => {
        if (c.path === '/auth/v1/admin/generate_link') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
        return base(c);
      },
    });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain(`FAILED: setup: recovery link for ${LABAK_EMAIL}: network error (ECONNRESET)`);
  });

  it('stops when Auth refuses the sign-in (for example a hook that refuses otp), and runs no check', async () => {
    const r = await run(args, {
      handler: (base) => (c) =>
        c.path === '/auth/v1/verify' ? json(403, { code: 403, error_code: 'unexpected_failure', msg: 'Sign-in not allowed' }) : base(c),
    });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain(`FAILED: setup: sign-in for ${LABAK_EMAIL}: HTTP 403 unexpected_failure Sign-in not allowed`);
    expect(r.lines.filter((l) => /^(PASS|FAIL) /.test(l))).toEqual([]);
  });
});

describe('boundary-check: FAIL classification', () => {
  const expectOneFail = (r: Run, pattern: RegExp) => {
    expect(r.code).toBe(1);
    const failed = fails(r);
    expect(failed.filter((l) => pattern.test(l)).length).toBeGreaterThan(0);
    expect(resultLine(r)).toBe(`RESULT: ${TOTAL - failed.length} passed, ${failed.length} failed`);
  };

  it('A1: an exposed schema fails, showing what was observed and expected', async () => {
    const r = await run(args, {
      handler: (base) => (c) => (c.headers.get('Accept-Profile') === 'public' ? json(200, []) : base(c)),
    });
    expectOneFail(r, /^FAIL A1 schema public table read refused for anon \(observed 200, expected 406 PGRST106\)$/);
    expect(fails(r)).toHaveLength(4);
  });

  it('A1: an answered GraphQL endpoint fails', async () => {
    const r = await run(args, { handler: (base) => (c) => (c.path === '/graphql/v1' ? json(200, { data: {} }) : base(c)) });
    expectOneFail(r, /^FAIL A1 GraphQL refused for anon \(observed 200, expected not 2xx\)$/);
  });

  it('A2: a cross-tenant create the server accepts is a FAIL', async () => {
    let world: World | undefined;
    const r = await run(args, {
      world: (world = newWorld()),
      handler: (base) => (c) => {
        const p = principal(c);
        if (c.path === '/rest/v1/rpc/create_entry' && p.kind === 'editor' && !isMember(world as World, (c.json as { p_tenant_id: string }).p_tenant_id, p.userId)) {
          return json(200, uuid(6666));
        }
        return base(c);
      },
    });
    expectOneFail(r, /^FAIL A2 labak editor cannot create an entry in the demo tenant \(observed 200, expected 400 P0001 not_found\)$/);
  });

  it('A2: an entry list that shows the other tenant fails', async () => {
    const r = await run(args, {
      handler: (base) => async (c) => {
        const res = await base(c);
        const u = new URL(c.url);
        if (c.path !== '/rest/v1/entry_list' || u.searchParams.has('title')) return res;
        const rows = (await res.json()) as unknown[];
        return json(200, [...rows, { id: uuid(31337), tenant_id: '33333333-3333-4333-8333-333333333333' }]);
      },
    });
    expectOneFail(r, /^FAIL A2 labak editor's entry list shows no rows of the demo tenant \(observed 200, 1 row of another tenant, expected only own rows\)$/);
  });

  it('A2: a failed own draft save fails, and the cross-tenant save check is not meaningful without its draft', async () => {
    const r = await run(args, {
      handler: (base) => (c) => {
        const p = principal(c);
        if (c.path === '/rest/v1/rpc/create_entry' && p.kind === 'editor' && (c.json as { p_tenant_id: string }).p_tenant_id === LABAK) {
          return pgError(403, '42501', 'permission denied for table entries');
        }
        return base(c);
      },
    });
    expectOneFail(r, /^FAIL A2 labak editor creates its test entry \(observed 403 42501, expected 200\)$/);
    expect(line(r, /^FAIL A2 labak editor saves a draft in its own tenant \(observed not run, no test entry, expected 200\)$/)).toHaveLength(1);
    expect(line(r, /^FAIL A2 demo editor cannot save the labak test draft \(observed not run, no labak test draft, expected 400 P0001 not_found\)$/)).toHaveLength(1);
  });

  it('A3: a worker function an editor can call fails; a secret key that is refused fails', async () => {
    const r = await run(args, {
      handler: (base) => {
        let secretCalls = 0;
        return (c) => {
          if (c.path !== '/rest/v1/rpc/worker_previous_release') return base(c);
          // The first two secret-key calls are setup's slug checks.
          if (principal(c).kind === 'secret') return ++secretCalls <= 2 ? base(c) : pgError(403, '42501', 'permission denied');
          return json(200, null);
        };
      },
    });
    expectOneFail(r, /^FAIL A3 worker_previous_release accepted for the secret key \(observed 403 42501, expected 200\)$/);
    expect(line(r, /^FAIL A3 worker_previous_release refused for the demo editor \(observed 200, expected 42501\)$/)).toHaveLength(1);
    expect(line(r, /^FAIL A3 /)).toHaveLength(4);
  });

  it('A4: an upload into the other prefix that succeeds fails', async () => {
    const r = await run(args, {
      handler: (base) => (c) =>
        c.method === 'POST' && c.path.startsWith(`/storage/v1/object/media-private/${DEMO}/`) && !c.path.includes(TEST_SIDES.demo.objectId)
          ? json(200, { Key: 'x' })
          : base(c),
    });
    expectOneFail(r, /^FAIL A4 labak editor cannot upload into the demo prefix \(observed 200, expected not 2xx\)$/);
  });

  it('A4: reading the other tenant\'s object that succeeds fails', async () => {
    const world = newWorld();
    const r = await run(args, {
      world,
      handler: (base) => (c) => {
        const p = principal(c);
        const labakObject = `/storage/v1/object/media-private/${LABAK}/${TEST_SIDES.labak.objectId}/a.jpg`;
        if (c.method === 'GET' && c.path === labakObject && p.kind === 'editor' && p.userId === world.users.get(DEMO_EMAIL)) {
          return new Response(new Uint8Array(JPEG), { status: 200 });
        }
        return base(c);
      },
    });
    expectOneFail(r, /^FAIL A4 demo editor cannot read the labak test object \(observed 200, expected not 2xx\)$/);
    expect(fails(r)).toHaveLength(1);
  });

  it('A4: the read of the other tenant\'s object is not meaningful when that object was not confirmed', async () => {
    const r = await run(args, {
      handler: (base) => (c) =>
        c.method === 'POST' && c.path === `/storage/v1/object/media-private/${DEMO}/${TEST_SIDES.demo.objectId}/a.jpg`
          ? storageError('403', 'Unauthorized', 'new row violates row-level security policy')
          : base(c),
    });
    expectOneFail(r, /^FAIL A4 demo editor uploads its own object \(observed 400 Unauthorized new row violates row-level security policy, expected 200\)$/);
    expect(line(r, /^FAIL A4 labak editor cannot read the demo test object \(observed not run, the demo test object was not confirmed, expected not 2xx\)$/)).toHaveLength(1);
  });

  it('A4: an own-object upsert that succeeds fails, and so does the unchanged check', async () => {
    let world: World | undefined;
    const r = await run(args, {
      world: (world = newWorld()),
      handler: (base) => (c) => {
        if (c.method === 'POST' && c.headers.get('x-upsert') === 'true' && c.path.startsWith('/storage/v1/object/media-private/')) {
          const key = decodeURIComponent(c.path.slice('/storage/v1/object/'.length));
          (world as World).objects.set(key, c.bytes as Uint8Array<ArrayBuffer>);
          return json(200, { Key: key });
        }
        return base(c);
      },
    });
    expectOneFail(r, /^FAIL A4 labak editor cannot upsert its own object \(observed 200, expected not 2xx\)$/);
    expect(line(r, /^FAIL A4 labak editor's own object is unchanged \(observed 200, different bytes, expected 200 with the test bytes\)$/)).toHaveLength(1);
  });

  it('A4: a delete that removes the own object fails', async () => {
    let world: World | undefined;
    const r = await run(args, {
      world: (world = newWorld()),
      handler: (base) => (c) => {
        if (c.method === 'DELETE' && c.path === '/storage/v1/object/media-private') {
          const prefixes = (c.json as { prefixes: string[] }).prefixes;
          for (const p of prefixes) (world as World).objects.delete(`media-private/${p}`);
          return json(200, prefixes.map((name) => ({ name })));
        }
        return base(c);
      },
    });
    expectOneFail(r, /^FAIL A4 labak editor cannot delete its own object \(observed DELETE 200 \(1 object removed\), then download 400 not_found Object not found, expected the object still there\)$/);
    const del = r.calls.find((c) => c.method === 'DELETE') as Call;
    expect(del.json).toEqual({ prefixes: [`${LABAK}/${TEST_SIDES.labak.objectId}/a.jpg`] });
  });

  it('A4: uploads to media-public or delivery that succeed fail', async () => {
    const r = await run(args, {
      handler: (base) => (c) =>
        c.method === 'POST' && (c.path.startsWith('/storage/v1/object/media-public/') || c.path.startsWith('/storage/v1/object/delivery/'))
          ? json(200, { Key: 'x' })
          : base(c),
    });
    expectOneFail(r, /^FAIL A4 labak editor cannot upload to delivery \(observed 200, expected not 2xx\)$/);
    expect(line(r, /^FAIL A4 .* media-public /)).toHaveLength(4);
    // The refused-write paths are fresh each run, so an earlier object never makes a refusal look like a pass.
    const paths = r.calls.filter((c) => c.method === 'POST' && c.path.startsWith('/storage/v1/object/delivery/')).map((c) => c.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.every((p) => /^\/storage\/v1\/object\/delivery\/(labak|demo)\/releases\/boundary-check-[0-9a-f-]{36}\.json$/.test(p))).toBe(true);
  });

  it('A4: an existing own object with other bytes is not accepted as already there', async () => {
    const world = newWorld();
    world.objects.set(`media-private/${LABAK}/${TEST_SIDES.labak.objectId}/a.jpg`, new Uint8Array([1, 2, 3]));
    const r = await run(args, { world });
    expectOneFail(r, /^FAIL A4 labak editor's own object already existed from an earlier run; downloaded and verified \(observed 400 Duplicate, then 200, different bytes, expected 200, or Duplicate with the test bytes\)$/);
  });

  it('a transport error on one check is a FAIL for that check, and the run goes on to RESULT', async () => {
    const r = await run(args, {
      handler: (base) => (c) => {
        if (c.path === '/graphql/v1' && principal(c).kind === 'anon') throw Object.assign(new TypeError(`fetch failed ${SK}`), { cause: { code: 'ECONNRESET' } });
        return base(c);
      },
    });
    expectOneFail(r, /^FAIL A1 GraphQL refused for anon \(observed network error \(ECONNRESET\), expected not 2xx\)$/);
    expect(fails(r)).toHaveLength(1);
  });

  it('a refused redirect (fetch throws with redirect: error) is a FAIL, not a crash', async () => {
    const r = await run(args, {
      handler: (base) => {
        let secretCalls = 0;
        return (c) => {
          if (c.path === '/rest/v1/rpc/worker_previous_release' && principal(c).kind === 'secret' && ++secretCalls > 2) {
            throw Object.assign(new TypeError('fetch failed'), { cause: new Error('unexpected redirect') });
          }
          return base(c);
        };
      },
    });
    expectOneFail(r, /^FAIL A3 worker_previous_release accepted for the secret key \(observed network error \(no response\), expected 200\)$/);
  });
});

describe('boundary-check: redaction', () => {
  it('never prints a key or token that a server message echoes', async () => {
    const r = await run(args, {
      handler: (base) => (c) => {
        if (c.path === '/rest/v1/rpc/worker_previous_release' && principal(c).kind === 'editor') {
          return pgError(403, `42501 ${SK}`, `denied for ${c.headers.get('Authorization')} and ${PK}`);
        }
        return base(c);
      },
    });
    expect(r.code).toBe(1);
    expect(r.out.join('\n')).toContain('[redacted]');
  });

  it('never prints a setup server message that echoes a hashed token or a token', async () => {
    const r = await run(args, {
      handler: (base) => {
        let token = '';
        return async (c) => {
          const res = await base(c);
          if (c.path === '/auth/v1/verify') token = ((await res.clone().json()) as { access_token: string }).access_token;
          if (c.path === '/rest/v1/rpc/admin_add_membership') return pgError(400, 'XX000', `bad hash-recovery-${uuid(1001)} ${token} ${SK}`);
          return res;
        };
      },
    });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('[redacted]');
  });

  it('reports a thrown fetch error by its cause code only, never its text', async () => {
    const r = await run(args, {
      handler: () => () => {
        throw Object.assign(new Error(`boom ${SK}`), { name: 'OddError' });
      },
    });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain(`FAILED: setup: confirming tenant ${LABAK}: network error (no response); nothing was done`);
    expect(r.err.join('\n')).not.toContain('boom');
  });
});

describe('boundary-check: the test drafts', () => {
  it.each([
    ['labak', labak, TEST_SIDES.labak.type],
    ['demo', demo, TEST_SIDES.demo.type],
  ] as const)('the %s draft is one the module accepts as a draft, with the title and sort columns the CMS would write', (_n, manifest, typeName) => {
    const type = (manifest as ModuleManifest).types.find((t) => t.name === typeName);
    expect(type).toBeDefined();
    expect(type?.version).toBe(1);
    const parsed = type!.draftValidator().safeParse({ title: BOUNDARY_TITLE });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ title: BOUNDARY_TITLE });
    expect(type!.queryColumns(parsed.data)).toEqual({ title: BOUNDARY_TITLE, sortAt: null });
  });

  it('saves exactly that draft', async () => {
    const r = await run(args);
    const saves = r.calls.filter((c) => c.path === '/rest/v1/rpc/save_draft' && r.world.entries.some((e) => e.id === (c.json as { p_entry_id: string }).p_entry_id));
    expect(saves.length).toBeGreaterThanOrEqual(2);
    for (const s of saves) {
      expect(s.json).toEqual({
        p_entry_id: expect.any(String),
        p_expected_version: expect.any(Number),
        p_data: { title: BOUNDARY_TITLE },
        p_schema_version: 1,
        p_title: BOUNDARY_TITLE,
        p_sort_at: null,
      });
    }
  });
});
