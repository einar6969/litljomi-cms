// `provision`: tenants, sites and editors on the hosted staging project (plan Task 28 Step 5,
// decision 44; runbook docs/runbooks/staging.md section 11). Run by Einar only, in his own terminal.
//
// Safety rules (decision 44, runbook sections 1 and 7.2):
// - The env file is read as text, never executed, with the rules of the runbook's `env_value`: each
//   needed name exactly once on a plain NAME=value line, its value matching a fixed pattern. A
//   refusal names the variable, never its value.
// - The URL must be https://<--expect-ref>.supabase.co; any other host (loopback included) is refused.
// - Requests go only to that origin, with the key in headers only, and never follow a redirect.
// - The webhook secret is read from standard input only.
// - Output is the target host, ids and statuses. Server errors are shown as the HTTP status and the
//   error's code and message fields only; any occurrence of the key or the secret is redacted.
import { isAbsolute } from 'node:path';

export const DEFAULT_ENV_FILE = '/Users/einarzoega/litljomi-cms/.env.staging.local';
const FINISH_PREFIX = 'pnpm --silent --filter @litljomi/cli cli provision';

export interface ProvisionDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** The env file's text. */
  readTextFile: (path: string) => Promise<string>;
  /** All of standard input as text, or null when standard input is a terminal. */
  readStdin: () => Promise<string | null>;
}

export interface ProvisionIo {
  log: (line: string) => void;
  error: (line: string) => void;
}

export const PROVISION_USAGE = [
  'usage: provision tenant <slug> --name <name> --expect-ref <ref> [--env-file=<absolute path>]',
  '       provision site --tenant-id <uuid> --base-url https://<host> --revalidate-path /<path> --expect-ref <ref> [--env-file=<absolute path>]',
  '         (the webhook secret is read from standard input only)',
  '       provision editor (--email <address> | --user-id <uuid>) --tenant-id <uuid> [--tenant-id <uuid> ...] --expect-ref <ref> [--env-file=<absolute path>]',
].join('\n');

const REF_RE = /^[a-z0-9]{20}$/;
const URL_RE = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
const KEY_RE = /^[A-Za-z0-9._-]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// cms.tenants' slug constraint.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// An https origin with a lowercase DNS host: no port, path, query or trailing slash.
const LABEL = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?';
const BASE_URL_RE = new RegExp(`^https://${LABEL}(?:\\.${LABEL})+$`);
// One or more path segments: no trailing slash, query or fragment.
const PATH_RE = /^(?:\/[A-Za-z0-9._~-]+)+$/;
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
// Printable ASCII without space or comma (CMS_WEBHOOK_SECRETS is comma-separated); 32–256 characters.
const SECRET_RE = /^[\x21-\x2b\x2d-\x7e]{32,256}$/;

class UsageError extends Error {}

/** A refusal or failure: its message is printed as is and the command exits 1. */
class Failure extends Error {}

// ---------------------------------------------------------------------------------------------
// Arguments

interface Parsed {
  positionals: string[];
  flags: Map<string, string[]>;
}

const COMMON_FLAGS = ['--expect-ref', '--env-file'];
const COMMANDS: Record<string, { positionals: number; flags: string[]; repeatable?: string[] }> = {
  tenant: { positionals: 1, flags: ['--name'] },
  site: { positionals: 0, flags: ['--tenant-id', '--base-url', '--revalidate-path'] },
  editor: { positionals: 0, flags: ['--email', '--user-id', '--tenant-id'], repeatable: ['--tenant-id'] },
};

function parse(command: string, args: string[]): Parsed {
  const spec = COMMANDS[command];
  if (spec === undefined) throw new UsageError(`unknown provision command`);
  const known = new Set([...spec.flags, ...COMMON_FLAGS]);
  const positionals: string[] = [];
  const flags = new Map<string, string[]>();
  for (let i = 0; i < args.length; i++) {
    const raw = args[i] as string;
    if (raw.startsWith('--')) {
      // `--flag=value` and `--flag value` are both accepted; `--env-file=<path>` is the documented form
      // because vite-node swallows a separate `--env-file <path>` when run through `pnpm … cli`.
      const eq = raw.indexOf('=');
      const arg = eq === -1 ? raw : raw.slice(0, eq);
      // Only the flag's name is ever printed, never a value.
      if (!known.has(arg)) throw new UsageError(`unknown option ${arg}`);
      const value = eq === -1 ? args[i + 1] : raw.slice(eq + 1);
      if (value === undefined || (eq === -1 && value.startsWith('--'))) throw new UsageError(`${arg} needs a value`);
      const values = flags.get(arg) ?? [];
      if (values.length > 0 && !(spec.repeatable ?? []).includes(arg)) throw new UsageError(`${arg} given twice`);
      values.push(value);
      flags.set(arg, values);
      if (eq === -1) i++;
    } else {
      positionals.push(raw);
    }
  }
  if (positionals.length !== spec.positionals) throw new UsageError('unexpected or missing arguments');
  if (!flags.has('--expect-ref')) throw new UsageError('--expect-ref is required');
  const envFile = flags.get('--env-file')?.[0];
  if (envFile !== undefined && !isAbsolute(envFile)) throw new UsageError('--env-file must be an absolute path');
  return { positionals, flags };
}

const one = (p: Parsed, name: string): string | undefined => p.flags.get(name)?.[0];

function required(p: Parsed, name: string, pattern: RegExp): string {
  const value = one(p, name);
  if (value === undefined) throw new UsageError(`${name} is required`);
  if (!pattern.test(value)) throw new UsageError(`${name} has an unexpected form`);
  return value;
}

// ---------------------------------------------------------------------------------------------
// The env file (runbook section 7.2, `env_value`)

/** NAME's value from the env file's text; refuses, naming only NAME, as the runbook's env_value does. */
export function envValue(text: string, name: string, allowed: RegExp, file: string): string {
  const assigned = new RegExp(`^\\s*(export\\s+)?${name}\\s*=`);
  let count = 0;
  let plain = false;
  let value = '';
  for (const line of text.split('\n')) {
    if (!assigned.test(line)) continue;
    count += 1;
    plain = line.startsWith(`${name}=`);
    if (plain) value = line.slice(name.length + 1);
  }
  if (count !== 1 || !plain) {
    throw new Failure(`FAILED: ${name} must be on exactly one plain ${name}=value line in ${file} (found ${count}); nothing was sent`);
  }
  if (!allowed.test(value)) throw new Failure(`FAILED: ${name} in ${file} has an unexpected form (value not shown); nothing was sent`);
  return value;
}

interface Target {
  origin: string;
  key: string;
  ref: string;
  envFile: string;
}

async function readTarget(p: Parsed, deps: ProvisionDeps): Promise<Target> {
  const ref = one(p, '--expect-ref') as string;
  if (!REF_RE.test(ref)) {
    throw new Failure("FAILED: --expect-ref must be the staging project's reference (20 lowercase letters or digits); nothing was sent");
  }
  const envFile = one(p, '--env-file') ?? DEFAULT_ENV_FILE;
  let text: string;
  try {
    text = await deps.readTextFile(envFile);
  } catch {
    throw new Failure(`FAILED: ${envFile} could not be read; nothing was sent`);
  }
  const url = envValue(text, 'NEXT_PUBLIC_SUPABASE_URL', URL_RE, envFile);
  const key = envValue(text, 'SUPABASE_SECRET_KEY', KEY_RE, envFile);
  if (url !== `https://${ref}.supabase.co`) {
    throw new Failure(`FAILED: ${envFile} points at ${url.slice('https://'.length)}, not ${ref}.supabase.co; nothing was sent`);
  }
  return { origin: url, key, ref, envFile };
}

// ---------------------------------------------------------------------------------------------
// Requests

type ApiResult =
  | { ok: true; body: unknown }
  | { ok: false; detail: string; errorCode: string | undefined; message: string | undefined };

/** Replaces each secret with [redacted], then control characters, then truncates (so no part of a secret survives). */
const redactAll = (value: string, secrets: readonly string[]) => secrets.reduce((v, s) => v.split(s).join('[redacted]'), value);
const clean = (value: string, secrets: readonly string[] = []) =>
  redactAll(value, secrets).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200);

class Api {
  constructor(
    private readonly target: Target,
    private readonly fetchFn: ProvisionDeps['fetch'],
    /** The key and the webhook secret, redacted from anything the server sends back. */
    private readonly secrets: readonly string[],
  ) {}

  rpc(name: string, args: Record<string, unknown>, select?: string): Promise<ApiResult> {
    const query = select === undefined ? '' : `?select=${select}`;
    return this.post(`/rest/v1/rpc/${name}${query}`, args, { 'Content-Profile': 'api' });
  }

  invite(email: string): Promise<ApiResult> {
    return this.post('/auth/v1/invite', { email }, {});
  }

  private async post(path: string, body: Record<string, unknown>, extra: Record<string, string>): Promise<ApiResult> {
    const url = new URL(path, this.target.origin);
    if (url.origin !== this.target.origin) throw new Failure('FAILED: refusing a request outside the target project');
    let response: Response;
    try {
      response = await this.fetchFn(url.href, {
        method: 'POST',
        headers: {
          apikey: this.target.key,
          Authorization: `Bearer ${this.target.key}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...extra,
        },
        body: JSON.stringify(body),
        redirect: 'error',
      });
    } catch (e) {
      // Only an error code from the cause (for example ENOTFOUND); never the error's text.
      const cause = (e as { cause?: { code?: unknown } } | null)?.cause?.code;
      return {
        ok: false,
        detail: `network error (${typeof cause === 'string' ? clean(cause, this.secrets) : 'no response'})`,
        errorCode: undefined,
        message: undefined,
      };
    }
    let parsed: unknown = null;
    try {
      const text = await response.text();
      parsed = text === '' ? null : (JSON.parse(text) as unknown);
    } catch {
      parsed = null;
    }
    if (response.ok) return { ok: true, body: parsed };
    // PostgREST errors have code and message; Auth errors have error_code and msg.
    const fields = (parsed ?? {}) as Record<string, unknown>;
    const pick = (...names: string[]) => names.map((n) => fields[n]).find((v): v is string => typeof v === 'string');
    const rawCode = pick('error_code', 'code');
    const rawMessage = pick('message', 'msg');
    const code = rawCode === undefined ? undefined : clean(rawCode, this.secrets);
    const message = rawMessage === undefined ? undefined : clean(rawMessage, this.secrets);
    const detail = ['HTTP', String(response.status), code, message].filter((v) => v !== undefined).join(' ');
    return { ok: false, detail, errorCode: code, message };
  }
}

// ---------------------------------------------------------------------------------------------
// Commands

interface Context {
  api: Api;
  target: Target;
  secrets: readonly string[];
  log: (line: string) => void;
  error: (line: string) => void;
}

async function tenant(p: Parsed, ctx: Context): Promise<number> {
  const slug = p.positionals[0] as string;
  const result = await ctx.api.rpc('admin_create_tenant', { p_slug: slug, p_name: one(p, '--name') });
  if (!result.ok) {
    if (result.message === 'slug_taken') throw new Failure(`FAILED: tenant ${slug} already exists (slug_taken); nothing was created`);
    throw new Failure(`FAILED: creating tenant ${slug}: ${result.detail}`);
  }
  if (typeof result.body !== 'string' || !UUID_RE.test(result.body)) throw new Failure('FAILED: unexpected response from admin_create_tenant');
  ctx.log(`tenant ${slug}: ${result.body}`);
  return 0;
}

async function readSecret(deps: ProvisionDeps): Promise<string> {
  const input = await deps.readStdin();
  if (input === null) {
    throw new Failure('FAILED: standard input is a terminal; pipe the webhook secret in (runbook section 11, P-2); nothing was sent');
  }
  const secret = input.endsWith('\n') ? input.slice(0, -1) : input;
  if (secret === '') throw new Failure('FAILED: standard input is empty; pipe the webhook secret in; nothing was sent');
  if (!SECRET_RE.test(secret)) {
    throw new Failure(
      'FAILED: the webhook secret on standard input has an unexpected form (value not shown): 32–256 printable characters, no spaces or commas; nothing was sent',
    );
  }
  return secret;
}

// worker_sites lists active sites only and read-then-create is not atomic: acceptable with one operator,
// and M1 never deactivates a site.
async function site(p: Parsed, ctx: Context, secret: string): Promise<number> {
  const tenantId = one(p, '--tenant-id') as string;
  const baseUrl = one(p, '--base-url') as string;
  const revalidateUrl = baseUrl + (one(p, '--revalidate-path') as string);

  // No duplicate (decision 44.2): cms.sites has no unique (tenant_id, base_url), so the tenant's
  // active sites are read first, through the service_role-only api.worker_sites. Only id and
  // base_url are selected, so the sites' webhook secrets are not sent back.
  const existing = await ctx.api.rpc('worker_sites', { p_tenant_id: tenantId }, 'id,base_url');
  if (!existing.ok) throw new Failure(`FAILED: checking existing sites: ${existing.detail}; nothing was created`);
  if (!Array.isArray(existing.body)) throw new Failure('FAILED: unexpected response from worker_sites; nothing was created');
  const same = (existing.body as { id?: unknown; base_url?: unknown }[]).find((s) => s.base_url === baseUrl);
  if (same !== undefined) {
    throw new Failure(`FAILED: tenant ${tenantId} already has a site at ${baseUrl} (site ${clean(String(same.id), ctx.secrets)}); nothing was created`);
  }

  const created = await ctx.api.rpc('admin_create_site', {
    p_tenant_id: tenantId,
    p_base_url: baseUrl,
    p_revalidate_url: revalidateUrl,
    p_preview_url: null,
    p_webhook_secret: secret,
  });
  if (!created.ok) throw new Failure(`FAILED: creating the site: ${created.detail}`);
  if (typeof created.body !== 'string' || !UUID_RE.test(created.body)) throw new Failure('FAILED: unexpected response from admin_create_site');
  ctx.log(`site: ${created.body}`);
  return 0;
}

const EXISTING_USER = new Set(['email_exists', 'user_already_exists']);

async function editor(p: Parsed, ctx: Context): Promise<number> {
  const tenantIds = [...new Set(p.flags.get('--tenant-id') ?? [])];
  const email = one(p, '--email');
  let userId = one(p, '--user-id') as string;

  if (email !== undefined) {
    const invited = await ctx.api.invite(email);
    if (!invited.ok) {
      if (invited.errorCode !== undefined && EXISTING_USER.has(invited.errorCode)) {
        throw new Failure(
          `FAILED: a user with email ${email} already exists; no invitation was sent and nothing was changed. ` +
            `To add memberships for an existing user: ${FINISH_PREFIX} editor --user-id <user-id> --tenant-id <uuid> ...`,
        );
      }
      throw new Failure(`FAILED: invitation: ${invited.detail}; no membership was added`);
    }
    const id = (invited.body as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || !UUID_RE.test(id)) throw new Failure('FAILED: unexpected response from the invitation; no membership was added');
    userId = id;
    ctx.log(`invited ${email}: user ${userId}`);
  } else {
    ctx.log(`user ${userId}`);
  }

  const missing: string[] = [];
  for (const tenantId of tenantIds) {
    const added = await ctx.api.rpc('admin_add_membership', { p_tenant_id: tenantId, p_user_id: userId });
    if (added.ok) {
      ctx.log(`membership ${tenantId}: ok`);
    } else {
      ctx.error(`membership ${tenantId}: FAILED: ${added.detail}`);
      missing.push(tenantId);
    }
  }
  if (missing.length > 0) {
    const envFile = ctx.target.envFile === DEFAULT_ENV_FILE ? '' : ` --env-file=${ctx.target.envFile}`;
    const finish = `${FINISH_PREFIX} editor --user-id ${userId} ${missing.map((t) => `--tenant-id ${t}`).join(' ')} --expect-ref ${ctx.target.ref}${envFile}`;
    throw new Failure(`FAILED: user ${userId} is still missing memberships in: ${missing.join(' ')}\nfinish with: ${finish}`);
  }
  return 0;
}

function validate(command: string, p: Parsed): void {
  if (command === 'tenant') {
    if (!SLUG_RE.test(p.positionals[0] as string)) throw new UsageError('the slug has an unexpected form');
    const name = one(p, '--name');
    if (name === undefined || name.trim() === '') throw new UsageError('--name is required');
  } else if (command === 'site') {
    required(p, '--tenant-id', UUID_RE);
    required(p, '--base-url', BASE_URL_RE);
    required(p, '--revalidate-path', PATH_RE);
  } else {
    const email = one(p, '--email');
    const userId = one(p, '--user-id');
    if ((email === undefined) === (userId === undefined)) throw new UsageError('give exactly one of --email and --user-id');
    if (email !== undefined && !EMAIL_RE.test(email)) throw new UsageError('--email has an unexpected form');
    if (userId !== undefined && !UUID_RE.test(userId)) throw new UsageError('--user-id has an unexpected form');
    const tenantIds = p.flags.get('--tenant-id') ?? [];
    if (tenantIds.length === 0) throw new UsageError('--tenant-id is required');
    if (!tenantIds.every((t) => UUID_RE.test(t))) throw new UsageError('--tenant-id has an unexpected form');
  }
}

/** Runs `provision <command> ...`; returns the exit code (0 ok, 1 refused or failed, 2 usage). */
export async function runProvision(args: string[], io: ProvisionIo, deps: ProvisionDeps): Promise<number> {
  const secrets: string[] = [];
  const log = (line: string) => io.log(redactAll(line, secrets));
  const error = (line: string) => io.error(redactAll(line, secrets));

  const [command = '', ...rest] = args;
  let parsed: Parsed;
  try {
    parsed = parse(command, rest);
    validate(command, parsed);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    error(`provision: ${e.message}`);
    error(PROVISION_USAGE);
    return 2;
  }

  try {
    const target = await readTarget(parsed, deps);
    secrets.push(target.key);
    log(`target: ${target.origin.slice('https://'.length)}`);
    const ctx: Context = { api: new Api(target, deps.fetch, secrets), target, secrets, log, error };
    if (command === 'tenant') return await tenant(parsed, ctx);
    if (command === 'site') {
      const secret = await readSecret(deps);
      secrets.push(secret);
      return await site(parsed, ctx, secret);
    }
    return await editor(parsed, ctx);
  } catch (e) {
    // Our own refusals are printed; anything else only by its kind, never its text.
    error(e instanceof Failure ? e.message : `FAILED: unexpected error (${e instanceof Error ? e.name : 'unknown'})`);
    return 1;
  }
}
