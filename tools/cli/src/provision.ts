// `provision`: tenants, sites and editors on the hosted staging project (plan Task 28 Step 5,
// decision 44; runbook docs/runbooks/staging.md section 11). Run by Einar only, in his own terminal.
//
// Safety rules (decision 44, runbook sections 1 and 7.2; all but the stdin rule live in ./hosted.ts,
// shared with `boundary-check`):
// - The env file is read as text, never executed, with the rules of the runbook's `env_value`: each
//   needed name exactly once on a plain NAME=value line, its value matching a fixed pattern. A
//   refusal names the variable, never its value.
// - The URL must be https://<--expect-ref>.supabase.co; any other host (loopback included) is refused.
// - Requests go only to that origin, with the key in headers only, and never follow a redirect.
// - The webhook secret and the preview secret are read from standard input only.
// - Output is the target host, ids and statuses. Server errors are shown as the HTTP status and the
//   error's code and message fields only; any occurrence of the key or the secret is redacted.
import {
  DEFAULT_ENV_FILE,
  Failure,
  UUID_RE,
  UsageError,
  clean,
  flagValue as one,
  guardedFetch,
  parseArgs,
  readTarget,
  redactAll,
  requiredFlag as required,
  type ArgSpec,
  type FetchFn,
  type ParsedArgs as Parsed,
  type Target,
} from './hosted.ts';

export { DEFAULT_ENV_FILE, envValue } from './hosted.ts';
const FINISH_PREFIX = 'pnpm --silent --filter @litljomi/cli cli provision';

export interface ProvisionDeps {
  fetch: FetchFn;
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
  '       provision preview-secret --site-id <uuid> --expect-ref <ref> [--env-file=<absolute path>]',
  '         (the preview secret is read from standard input only; it sets the secret or rotates it)',
  '       provision editor (--email <address> | --user-id <uuid>) --tenant-id <uuid> [--tenant-id <uuid> ...] --expect-ref <ref> [--env-file=<absolute path>]',
].join('\n');

// cms.tenants' slug constraint.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// An https origin with a lowercase DNS host: no port, path, query or trailing slash.
const LABEL = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?';
const BASE_URL_RE = new RegExp(`^https://${LABEL}(?:\\.${LABEL})+$`);
// One or more path segments: no trailing slash, query or fragment.
const PATH_RE = /^(?:\/[A-Za-z0-9._~-]+)+$/;
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
// Printable ASCII without space or comma (CMS_WEBHOOK_SECRETS and CMS_PREVIEW_SECRETS are
// comma-separated); 32–256 characters. Both secrets have this form.
const SECRET_RE = /^[\x21-\x2b\x2d-\x7e]{32,256}$/;

// ---------------------------------------------------------------------------------------------
// Arguments

const COMMANDS: Record<string, ArgSpec> = {
  tenant: { positionals: 1, flags: ['--name'] },
  site: { positionals: 0, flags: ['--tenant-id', '--base-url', '--revalidate-path'] },
  'preview-secret': { positionals: 0, flags: ['--site-id'] },
  editor: { positionals: 0, flags: ['--email', '--user-id', '--tenant-id'], repeatable: ['--tenant-id'] },
};

function parse(command: string, args: string[]): Parsed {
  const spec = COMMANDS[command];
  if (spec === undefined) throw new UsageError(`unknown provision command`);
  return parseArgs(args, spec);
}

// ---------------------------------------------------------------------------------------------
// Requests

type ApiResult =
  | { ok: true; body: unknown }
  | { ok: false; detail: string; errorCode: string | undefined; message: string | undefined };

class Api {
  constructor(
    private readonly target: Target,
    private readonly fetchFn: FetchFn,
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
    const result = await guardedFetch(this.fetchFn, this.target.origin, this.secrets, {
      method: 'POST',
      path,
      headers: {
        apikey: this.target.key,
        Authorization: `Bearer ${this.target.key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...extra,
      },
      body: JSON.stringify(body),
    });
    if (result.kind === 'network') return { ok: false, detail: result.detail, errorCode: undefined, message: undefined };
    if (result.ok) return { ok: true, body: result.body };
    return { ok: false, detail: result.detail, errorCode: result.errorCode, message: result.message };
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

async function readSecret(deps: ProvisionDeps, kind: 'webhook' | 'preview'): Promise<string> {
  const input = await deps.readStdin();
  if (input === null) {
    const where = kind === 'webhook' ? ' (runbook section 11, P-2)' : '';
    throw new Failure(`FAILED: standard input is a terminal; pipe the ${kind} secret in${where}; nothing was sent`);
  }
  const secret = input.endsWith('\n') ? input.slice(0, -1) : input;
  if (secret === '') throw new Failure(`FAILED: standard input is empty; pipe the ${kind} secret in; nothing was sent`);
  if (!SECRET_RE.test(secret)) {
    throw new Failure(
      `FAILED: the ${kind} secret on standard input has an unexpected form (value not shown): 32–256 printable characters, no spaces or commas; nothing was sent`,
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

// A site's preview secret (spec §7.5, §9 step 2; security review B5), through the service_role-only
// api.admin_set_preview_secret: a first secret for a site that has none, or a new value (rotation).
// The same value goes into the site's CMS_PREVIEW_SECRETS.
async function previewSecret(p: Parsed, ctx: Context, secret: string): Promise<number> {
  const siteId = one(p, '--site-id') as string;
  const result = await ctx.api.rpc('admin_set_preview_secret', { p_site_id: siteId, p_preview_secret: secret });
  if (!result.ok) throw new Failure(`FAILED: setting the preview secret of site ${siteId}: ${result.detail}`);
  ctx.log(`site ${siteId}: preview secret set`);
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
  } else if (command === 'preview-secret') {
    required(p, '--site-id', UUID_RE);
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
    const target = await readTarget(parsed, deps.readTextFile);
    secrets.push(target.key);
    log(`target: ${target.origin.slice('https://'.length)}`);
    const ctx: Context = { api: new Api(target, deps.fetch, secrets), target, secrets, log, error };
    if (command === 'tenant') return await tenant(parsed, ctx);
    if (command === 'site') {
      const secret = await readSecret(deps, 'webhook');
      secrets.push(secret);
      return await site(parsed, ctx, secret);
    }
    if (command === 'preview-secret') {
      const secret = await readSecret(deps, 'preview');
      secrets.push(secret);
      return await previewSecret(parsed, ctx, secret);
    }
    return await editor(parsed, ctx);
  } catch (e) {
    // Our own refusals are printed; anything else only by its kind, never its text.
    error(e instanceof Failure ? e.message : `FAILED: unexpected error (${e instanceof Error ? e.name : 'unknown'})`);
    return 1;
  }
}
