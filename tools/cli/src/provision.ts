// `provision`: tenants, sites and editors on the hosted staging project (plan Task 28 Step 5,
// decision 44; runbook docs/runbooks/staging.md section 11). Run by Einar only, in his own terminal.
//
// Safety rules (decision 44, runbook sections 1 and 7.4; all but the stdin rule live in ./hosted.ts,
// shared with `boundary-check`):
// - The env file is read as text, never executed, with the rules of the runbook's `env_value`: each
//   needed name exactly once on a plain NAME=value line, its value matching a fixed pattern. A
//   refusal names the variable, never its value.
// - The URL must be https://<--expect-ref>.supabase.co; any other host (loopback included) is refused.
// - Requests go only to that origin, with the key in headers only, and never follow a redirect.
// - The webhook secret and the preview secret are read from standard input only. A preview URL is
//   not a secret and is an argument; it is checked against the token route's rule before anything
//   is sent.
// - A rerun finishes the job (spec §9.2, plan M4-02): `tenant` and `site` print what exists,
//   `site` then leaves the secret alone, and `editor --email` finds an existing user's id.
// - Output is the target host, ids and statuses. Server errors are shown as the HTTP status and the
//   error's code and message fields only; any occurrence of the key or the secret is redacted.
import {
  DEFAULT_ENV_FILE,
  Failure,
  UUID_RE,
  UsageError,
  flagValue as one,
  guardedFetch,
  parseArgs,
  readTarget,
  redactAll,
  requiredFlag as required,
  type ArgSpec,
  type FetchFn,
  type HttpRequest,
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
  '       provision site --tenant-id <uuid> --base-url https://<host> --revalidate-path /<path> [--preview-url <url>] --expect-ref <ref> [--env-file=<absolute path>]',
  '         (the webhook secret is read from standard input only)',
  '       provision preview-url --site-id <uuid> --preview-url (<url> | none) --expect-ref <ref> [--env-file=<absolute path>]',
  '         (sets the preview URL of an existing site, or clears it with none)',
  '       provision preview-secret --site-id <uuid> --expect-ref <ref> [--env-file=<absolute path>]',
  '         (the preview secret is read from standard input only; it sets the secret or rotates it)',
  '       provision webhook-secret --site-id <uuid> --expect-ref <ref> [--env-file=<absolute path>]',
  '         (the webhook secret is read from standard input only; it rotates the secret of an existing site)',
  '       provision editor (--email <address> | --user-id <uuid>) --tenant-id <uuid> [--tenant-id <uuid> ...] --expect-ref <ref> [--env-file=<absolute path>]',
  '       provision remove-editor --user-id <uuid> --tenant-id <uuid> [--tenant-id <uuid> ...] --expect-ref <ref> [--env-file=<absolute path>]',
  '       provision tenant-status --tenant-id <uuid> --status (active | suspended) --expect-ref <ref> [--env-file=<absolute path>]',
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
const TENANT_STATUS_RE = /^(?:active|suspended)$/;
// A preview URL: https to any host, or plain http to a loopback host only (the token route's rule,
// apps/cms/src/privileged/preview/token.ts isAllowedPreviewUrl; security review B4). The same
// expressions as api.admin_set_preview_url (20261104161000_preview_url.sql), which is the authority:
// a host of DNS labels, an IPv4 address or a bracketed IPv6 address, an optional port and path, and
// no user info, query, fragment, whitespace or backslash; at most 2048 characters.
const URL_PATH = "(?:/[A-Za-z0-9._~%!$&()*+,;=:@/-]*)?";
const PORT = '(?::[0-9]{1,5})?';
const OCTET = '(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])';
const HTTPS_PREVIEW_RE = new RegExp(
  `^https://(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*|\\[[0-9A-Fa-f:.]+\\])${PORT}${URL_PATH}$`,
);
const HTTP_LOOPBACK_PREVIEW_RE = new RegExp(`^http://(?:localhost|127\\.${OCTET}\\.${OCTET}\\.${OCTET}|\\[::1\\])${PORT}${URL_PATH}$`);
export const isAllowedPreviewUrl = (url: string): boolean =>
  url.length <= 2048 && (HTTPS_PREVIEW_RE.test(url) || HTTP_LOOPBACK_PREVIEW_RE.test(url));
/** `--preview-url none` on `provision preview-url` clears the site's preview URL. */
const CLEAR = 'none';
// The Auth users list, read until an empty page: a shorter page does not end it, since Auth may cap
// per_page. The page limit bounds the loop against a server that never sends an empty page.
const USERS_PER_PAGE = 200;
const MAX_USER_PAGES = 100;

// ---------------------------------------------------------------------------------------------
// Arguments

const COMMANDS: Record<string, ArgSpec> = {
  tenant: { positionals: 1, flags: ['--name'] },
  site: { positionals: 0, flags: ['--tenant-id', '--base-url', '--revalidate-path', '--preview-url'] },
  'preview-secret': { positionals: 0, flags: ['--site-id'] },
  'preview-url': { positionals: 0, flags: ['--site-id', '--preview-url'] },
  'webhook-secret': { positionals: 0, flags: ['--site-id'] },
  'tenant-status': { positionals: 0, flags: ['--tenant-id', '--status'] },
  editor: { positionals: 0, flags: ['--email', '--user-id', '--tenant-id'], repeatable: ['--tenant-id'] },
  'remove-editor': { positionals: 0, flags: ['--user-id', '--tenant-id'], repeatable: ['--tenant-id'] },
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

  /** One page of the Auth users list, read only to find an id; nothing from it is printed. */
  listUsers(page: number): Promise<ApiResult> {
    return this.send({ method: 'GET', path: `/auth/v1/admin/users?page=${page}&per_page=${USERS_PER_PAGE}`, headers: {} });
  }

  private post(path: string, body: Record<string, unknown>, extra: Record<string, string>): Promise<ApiResult> {
    return this.send({ method: 'POST', path, headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) });
  }

  private async send(request: HttpRequest): Promise<ApiResult> {
    const result = await guardedFetch(this.fetchFn, this.target.origin, this.secrets, {
      ...request,
      headers: { apikey: this.target.key, Authorization: `Bearer ${this.target.key}`, Accept: 'application/json', ...request.headers },
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

// admin_create_tenant returns the id of a tenant with this slug and name, so a rerun prints the same
// line as the first run.
async function tenant(p: Parsed, ctx: Context): Promise<number> {
  const slug = p.positionals[0] as string;
  const result = await ctx.api.rpc('admin_create_tenant', { p_slug: slug, p_name: one(p, '--name') });
  if (!result.ok) {
    if (result.message === 'slug_taken') throw new Failure(`FAILED: tenant ${slug} already exists with a different name (slug_taken); nothing was created`);
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
  const sitePreviewUrl = one(p, '--preview-url') ?? null;

  // No duplicate (decision 44.2): cms.sites has no unique (tenant_id, base_url), so the tenant's
  // active sites are read first, through the service_role-only api.worker_sites. Only id and
  // base_url are selected, so the sites' webhook secrets are not sent back.
  const existing = await ctx.api.rpc('worker_sites', { p_tenant_id: tenantId }, 'id,base_url');
  if (!existing.ok) throw new Failure(`FAILED: checking existing sites: ${existing.detail}; nothing was created`);
  if (!Array.isArray(existing.body)) throw new Failure('FAILED: unexpected response from worker_sites; nothing was created');
  const same = (existing.body as { id?: unknown; base_url?: unknown }[]).find((s) => s.base_url === baseUrl);
  if (same !== undefined) {
    if (typeof same.id !== 'string' || !UUID_RE.test(same.id)) throw new Failure('FAILED: unexpected response from worker_sites; nothing was created');
    // A rerun (spec §9.2): the piped secret is discarded. Not the `site: <id>` result line of a site
    // just created, whose secret the site's environment is then given.
    ctx.log(`site ${same.id}: already exists at ${baseUrl}; nothing was created and the webhook secret was not changed (to change it, use provision webhook-secret)`);
    return 0;
  }

  const created = await ctx.api.rpc('admin_create_site', {
    p_tenant_id: tenantId,
    p_base_url: baseUrl,
    p_revalidate_url: revalidateUrl,
    p_preview_url: sitePreviewUrl,
    p_webhook_secret: secret,
  });
  if (!created.ok) throw new Failure(`FAILED: creating the site: ${created.detail}`);
  if (typeof created.body !== 'string' || !UUID_RE.test(created.body)) throw new Failure('FAILED: unexpected response from admin_create_site');
  ctx.log(`site: ${created.body}`);
  return 0;
}

// A site's webhook secret (spec §8.2), through the service_role-only api.admin_set_webhook_secret: a
// new value in the Vault row the site already has. The worker signs with it from the next
// notification on, so the site must accept both secrets first (`old,new` in CMS_WEBHOOK_SECRETS).
async function webhookSecret(p: Parsed, ctx: Context, secret: string): Promise<number> {
  const siteId = one(p, '--site-id') as string;
  const result = await ctx.api.rpc('admin_set_webhook_secret', { p_site_id: siteId, p_webhook_secret: secret });
  if (!result.ok) throw new Failure(`FAILED: setting the webhook secret of site ${siteId}: ${result.detail}`);
  ctx.log(`site ${siteId}: webhook secret set`);
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

// A site's preview URL (spec §7.5; fix/preview-url), through the service_role-only
// api.admin_set_preview_url: set or replaced, or cleared with `none` (null). The site previews once it
// has both this URL and a preview secret (`provision preview-secret`).
async function previewUrl(p: Parsed, ctx: Context): Promise<number> {
  const siteId = one(p, '--site-id') as string;
  const value = one(p, '--preview-url') as string;
  const url = value === CLEAR ? null : value;
  const result = await ctx.api.rpc('admin_set_preview_url', { p_site_id: siteId, p_preview_url: url });
  if (!result.ok) throw new Failure(`FAILED: setting the preview URL of site ${siteId}: ${result.detail}`);
  ctx.log(url === null ? `site ${siteId}: preview URL cleared` : `site ${siteId}: preview URL set to ${url}`);
  return 0;
}

// A tenant's status (spec §8.4), through the service_role-only api.admin_set_tenant_status: suspended
// stops publishing, active restores it.
async function tenantStatus(p: Parsed, ctx: Context): Promise<number> {
  const tenantId = one(p, '--tenant-id') as string;
  const status = one(p, '--status') as string;
  const result = await ctx.api.rpc('admin_set_tenant_status', { p_tenant_id: tenantId, p_status: status });
  if (!result.ok) throw new Failure(`FAILED: setting the status of tenant ${tenantId}: ${result.detail}`);
  ctx.log(`tenant ${tenantId}: status ${status}`);
  return 0;
}

const EXISTING_USER = new Set(['email_exists', 'user_already_exists']);

/** The id of the user with this email, whatever its case; a refusal when the list has none. */
async function findUserId(api: Api, email: string): Promise<string> {
  const wanted = email.toLowerCase();
  for (let page = 1; page <= MAX_USER_PAGES; page++) {
    const listed = await api.listUsers(page);
    if (!listed.ok) throw new Failure(`FAILED: looking up the user with email ${email}: ${listed.detail}; nothing was changed`);
    const users = (listed.body as { users?: unknown } | null)?.users;
    if (!Array.isArray(users)) throw new Failure('FAILED: unexpected response from the Auth users list; nothing was changed');
    if (users.length === 0) break;
    const match = (users as ({ id?: unknown; email?: unknown } | null)[]).find((u) => typeof u?.email === 'string' && u.email.toLowerCase() === wanted);
    if (match !== undefined) {
      if (typeof match?.id !== 'string' || !UUID_RE.test(match.id)) throw new Failure('FAILED: unexpected response from the Auth users list; nothing was changed');
      return match.id;
    }
  }
  throw new Failure(
    `FAILED: a user with email ${email} already exists but was not found in the Auth users list (at most ${MAX_USER_PAGES} pages of ${USERS_PER_PAGE} are read); ` +
      `no invitation was sent and nothing was changed. To add memberships by id: ${FINISH_PREFIX} editor --user-id <user-id> --tenant-id <uuid> ...`,
  );
}

/** The command that finishes `command` for the tenants left over, printed after a partial failure. */
function finishCommand(ctx: Context, command: string, userId: string, tenantIds: string[]): string {
  const envFile = ctx.target.envFile === DEFAULT_ENV_FILE ? '' : ` --env-file=${ctx.target.envFile}`;
  return `${FINISH_PREFIX} ${command} --user-id ${userId} ${tenantIds.map((t) => `--tenant-id ${t}`).join(' ')} --expect-ref ${ctx.target.ref}${envFile}`;
}

async function editor(p: Parsed, ctx: Context): Promise<number> {
  const tenantIds = [...new Set(p.flags.get('--tenant-id') ?? [])];
  const email = one(p, '--email');
  let userId = one(p, '--user-id') as string;

  if (email !== undefined) {
    const invited = await ctx.api.invite(email);
    if (invited.ok) {
      const id = (invited.body as { id?: unknown } | null)?.id;
      if (typeof id !== 'string' || !UUID_RE.test(id)) throw new Failure('FAILED: unexpected response from the invitation; no membership was added');
      userId = id;
      ctx.log(`invited ${email}: user ${userId}`);
    } else if (invited.errorCode !== undefined && EXISTING_USER.has(invited.errorCode)) {
      userId = await findUserId(ctx.api, email);
      ctx.log(`existing user ${email}: user ${userId}`);
    } else {
      throw new Failure(`FAILED: invitation: ${invited.detail}; no membership was added`);
    }
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
    throw new Failure(`FAILED: user ${userId} is still missing memberships in: ${missing.join(' ')}\nfinish with: ${finishCommand(ctx, 'editor', userId, missing)}`);
  }
  return 0;
}

// Revokes an editor (spec §8.4), through the service_role-only api.admin_remove_membership, tenant by
// tenant; RLS reads memberships on every request, so it holds from the next one. The function reports
// nothing for a membership that was not there, so the output does not claim a removal.
async function removeEditor(p: Parsed, ctx: Context): Promise<number> {
  const tenantIds = [...new Set(p.flags.get('--tenant-id') ?? [])];
  const userId = one(p, '--user-id') as string;
  ctx.log(`user ${userId}`);

  const left: string[] = [];
  for (const tenantId of tenantIds) {
    const removed = await ctx.api.rpc('admin_remove_membership', { p_tenant_id: tenantId, p_user_id: userId });
    if (removed.ok) {
      ctx.log(`membership ${tenantId}: removed or already absent`);
    } else {
      ctx.error(`membership ${tenantId}: FAILED: ${removed.detail}`);
      left.push(tenantId);
    }
  }
  if (left.length > 0) {
    throw new Failure(`FAILED: user ${userId} may still have memberships in: ${left.join(' ')}\nfinish with: ${finishCommand(ctx, 'remove-editor', userId, left)}`);
  }
  return 0;
}

const PREVIEW_URL_FORM = '--preview-url must be https, or http to localhost, 127.0.0.0/8 or [::1], with no user info, query or fragment';

function validate(command: string, p: Parsed): void {
  if (command === 'tenant') {
    if (!SLUG_RE.test(p.positionals[0] as string)) throw new UsageError('the slug has an unexpected form');
    const name = one(p, '--name');
    if (name === undefined || name.trim() === '') throw new UsageError('--name is required');
  } else if (command === 'site') {
    required(p, '--tenant-id', UUID_RE);
    required(p, '--base-url', BASE_URL_RE);
    required(p, '--revalidate-path', PATH_RE);
    const preview = one(p, '--preview-url');
    if (preview !== undefined && !isAllowedPreviewUrl(preview)) throw new UsageError(PREVIEW_URL_FORM);
  } else if (command === 'preview-secret' || command === 'webhook-secret') {
    required(p, '--site-id', UUID_RE);
  } else if (command === 'tenant-status') {
    required(p, '--tenant-id', UUID_RE);
    required(p, '--status', TENANT_STATUS_RE);
  } else if (command === 'preview-url') {
    required(p, '--site-id', UUID_RE);
    const preview = one(p, '--preview-url');
    if (preview === undefined) throw new UsageError('--preview-url is required (a URL, or none to clear it)');
    if (preview !== CLEAR && !isAllowedPreviewUrl(preview)) throw new UsageError(PREVIEW_URL_FORM);
  } else if (command === 'remove-editor') {
    required(p, '--user-id', UUID_RE);
    requireTenantIds(p);
  } else {
    const email = one(p, '--email');
    const userId = one(p, '--user-id');
    if ((email === undefined) === (userId === undefined)) throw new UsageError('give exactly one of --email and --user-id');
    if (email !== undefined && !EMAIL_RE.test(email)) throw new UsageError('--email has an unexpected form');
    if (userId !== undefined && !UUID_RE.test(userId)) throw new UsageError('--user-id has an unexpected form');
    requireTenantIds(p);
  }
}

function requireTenantIds(p: Parsed): void {
  const tenantIds = p.flags.get('--tenant-id') ?? [];
  if (tenantIds.length === 0) throw new UsageError('--tenant-id is required');
  if (!tenantIds.every((t) => UUID_RE.test(t))) throw new UsageError('--tenant-id has an unexpected form');
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
    if (command === 'webhook-secret') {
      const secret = await readSecret(deps, 'webhook');
      secrets.push(secret);
      return await webhookSecret(parsed, ctx, secret);
    }
    if (command === 'preview-url') return await previewUrl(parsed, ctx);
    if (command === 'tenant-status') return await tenantStatus(parsed, ctx);
    if (command === 'remove-editor') return await removeEditor(parsed, ctx);
    return await editor(parsed, ctx);
  } catch (e) {
    // Our own refusals are printed; anything else only by its kind, never its text.
    error(e instanceof Failure ? e.message : `FAILED: unexpected error (${e instanceof Error ? e.name : 'unknown'})`);
    return 1;
  }
}
