// `boundary-check`: re-proves gates A1–A4 on the hosted staging project over HTTP only (plan
// decision 46; runbook docs/runbooks/staging.md section 14). Run by Einar only, in his own terminal.
// It mirrors the assertions of tests/integration/src/http-boundary.test.ts and
// storage-boundary.test.ts that need no database connection, limited to what decision 46 lists.
//
// The safety rules are `provision`'s (./hosted.ts): the env file read as text with the runbook's
// env_value rules, --expect-ref required, the URL exactly https://<ref>.supabase.co, requests to
// that origin only with keys and tokens in headers only, no redirect followed, and output limited
// to ids, statuses and the error code and message fields, with every key and token redacted.
//
// What it leaves on staging (decision 46; nothing can be removed without SQL, so nothing is ever
// deleted): two pre-confirmed test editors created through the Auth admin API (no invitation, no
// email, no password), one membership each, one draft entry each, and one tiny JPEG each in
// media-private. Re-runs reuse all of them. The secret key is used only for the Auth admin
// endpoints, admin_add_membership and the read-only worker_previous_release; never for a storage
// write or delete.
import { randomUUID } from 'node:crypto';
import {
  Failure,
  UUID_RE,
  UsageError,
  guardedFetch,
  parseArgs,
  readTarget,
  redactAll,
  requiredFlag,
  type FetchFn,
  type HttpRequest,
  type HttpResult,
  type Target,
} from './hosted.ts';

export interface BoundaryCheckDeps {
  fetch: FetchFn;
  /** The env file's text. */
  readTextFile: (path: string) => Promise<string>;
}

export interface BoundaryCheckIo {
  log: (line: string) => void;
  error: (line: string) => void;
}

export const BOUNDARY_CHECK_USAGE =
  'usage: boundary-check --labak-tenant-id <uuid> --demo-tenant-id <uuid> --expect-ref <ref> [--env-file=<absolute path>]';

/** The title of both test drafts; a re-run finds its draft by it, through the editor's own api.entry_list. */
export const BOUNDARY_TITLE = 'A1–A4 grensupróf (prófun)';

type Role = 'labak' | 'demo';
const ROLES: readonly Role[] = ['labak', 'demo'];
const otherRole = (r: Role): Role => (r === 'labak' ? 'demo' : 'labak');

/**
 * The fixed test data per tenant. `type` is a type of that tenant's module whose draft validator
 * accepts `{ title }` alone (checked in the tests); `objectId` is the fixed asset-id folder of the
 * test object, media-private/<tenant-id>/<objectId>/a.jpg, so a re-run finds it again.
 */
export const TEST_SIDES: Record<Role, { email: string; type: string; objectId: string }> = {
  labak: { email: 'einsi+a-labak@litljomi.is', type: 'news', objectId: 'a1a40000-1abc-4000-8000-000000000001' },
  demo: { email: 'einsi+a-demo@litljomi.is', type: 'event', objectId: 'a1a40000-2dec-4000-8000-000000000002' },
};

const SCHEMA_VERSION = 1;
const DRAFT_DATA = { title: BOUNDARY_TITLE };

// The 14-byte JPEG of storage-boundary.test.ts: a JPEG signature; the Storage API checks the declared
// content type against the bucket's allowed types, not the pixels.
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
// Different bytes, so a successful overwrite would show in the content.
const OTHER_JPEG = new Uint8Array([...JPEG.slice(0, -2), 0x00, 0xff, 0xd9]);

// The schemas that must not be reachable (spec §4.2; runbook G3.3 lists graphql_public too).
const HIDDEN_SCHEMAS = ['cms', 'private', 'public', 'graphql_public'] as const;
// The A3 function: read-only (`stable`, a single select) and it returns no secret, unlike
// worker_sites, which decrypts the sites' webhook secrets from Vault.
const A3_FUNCTION = 'worker_previous_release';
// Auth's error codes for an existing user (the same set `provision editor` handles).
const EXISTING_USER = new Set(['email_exists', 'user_already_exists']);
// Storage errors carry `error` (Duplicate, Unauthorized, not_found) and `message`.
const STORAGE_CODE_FIELDS = ['error_code', 'code', 'error'] as const;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ---------------------------------------------------------------------------------------------
// Checks and their output

type Gate = 'A1' | 'A2' | 'A3' | 'A4';

interface Principal {
  /** As printed: "anon", "the labak editor", "the secret key". */
  label: string;
  headers: Record<string, string>;
}

interface Editor extends Principal {
  role: Role;
  email: string;
  tenantId: string;
  userId: string;
  userCreated: boolean;
  /** The tenant slug, confirmed in setup; used for the refused media-public and delivery paths. */
  slug: string;
}

class Session {
  readonly secrets: string[] = [];
  passed = 0;
  failed = 0;

  constructor(
    readonly target: Target,
    private readonly fetchFn: FetchFn,
    private readonly io: BoundaryCheckIo,
  ) {}

  log(line: string): void {
    this.io.log(redactAll(line, this.secrets));
  }

  error(line: string): void {
    this.io.error(redactAll(line, this.secrets));
  }

  /** Remembers a value the server issued (a token, a link) so that no output can contain it. */
  secret(value: unknown): void {
    if (typeof value === 'string' && value !== '') this.secrets.push(value);
  }

  send(req: HttpRequest): Promise<HttpResult> {
    return guardedFetch(this.fetchFn, this.target.origin, this.secrets, req);
  }

  get secretKey(): Principal {
    return { label: 'the secret key', headers: { apikey: this.target.key, Authorization: `Bearer ${this.target.key}` } };
  }

  get anon(): Principal {
    return { label: 'anon', headers: { apikey: this.target.publishableKey as string } };
  }

  check(gate: Gate, description: string, pass: boolean, observed: string, expected: string): boolean {
    if (pass) {
      this.passed += 1;
      this.log(`PASS ${gate} ${description} (${observed})`);
    } else {
      this.failed += 1;
      this.log(`FAIL ${gate} ${description} (observed ${observed}, expected ${expected})`);
    }
    return pass;
  }
}

/** Status and code as printed in a check line; the message too for P0001 (it is the error's name) and for storage. */
function observed(r: HttpResult, withMessage = false): string {
  if (r.kind === 'network') return r.detail;
  const message = withMessage || r.errorCode === 'P0001' ? r.message : undefined;
  return [String(r.status), r.errorCode, message].filter((v) => v !== undefined).join(' ');
}

const isOk = (r: HttpResult) => r.kind === 'response' && r.ok;
const hasCode = (r: HttpResult, status: number | undefined, code: string, message?: string) =>
  r.kind === 'response' && (status === undefined || r.status === status) && r.errorCode === code && (message === undefined || r.message === message);
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

// ---------------------------------------------------------------------------------------------
// Requests

const json = (body: unknown) => JSON.stringify(body);

function rpc(who: Principal, fn: string, args: Record<string, unknown>, profile = 'api'): HttpRequest {
  return {
    method: 'POST',
    path: `/rest/v1/rpc/${fn}`,
    headers: { ...who.headers, 'Content-Type': 'application/json', Accept: 'application/json', 'Content-Profile': profile },
    body: json(args),
  };
}

function read(who: Principal, relation: string, query: Record<string, string>, profile = 'api'): HttpRequest {
  // Percent-encoded (a space is %20, never +), so the title filter does not depend on how + is decoded.
  const search = Object.entries(query)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return {
    method: 'GET',
    path: `/rest/v1/${relation}${search === '' ? '' : `?${search}`}`,
    headers: { ...who.headers, Accept: 'application/json', 'Accept-Profile': profile },
  };
}

function auth(who: Principal, path: string, body: Record<string, unknown>): HttpRequest {
  return { method: 'POST', path, headers: { ...who.headers, 'Content-Type': 'application/json', Accept: 'application/json' }, body: json(body) };
}

const objectUrl = (bucket: string, path: string) => `/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;

function upload(who: Principal, bucket: string, path: string, opts: { method?: 'POST' | 'PUT'; upsert?: boolean; bytes?: Uint8Array<ArrayBuffer>; type?: string } = {}): HttpRequest {
  return {
    method: opts.method ?? 'POST',
    path: objectUrl(bucket, path),
    headers: { ...who.headers, 'Content-Type': opts.type ?? 'image/jpeg', 'x-upsert': opts.upsert ? 'true' : 'false' },
    body: opts.bytes ?? JPEG,
    codeFields: STORAGE_CODE_FIELDS,
  };
}

const download = (who: Principal, bucket: string, path: string): HttpRequest => ({
  method: 'GET',
  path: objectUrl(bucket, path),
  headers: { ...who.headers },
  codeFields: STORAGE_CODE_FIELDS,
});

// The Storage API's bulk delete (storage-js `remove`): it answers 200 with the objects it removed,
// so a refusal under RLS is a 200 with none; the object is downloaded again to prove it is still there.
const remove = (who: Principal, bucket: string, paths: string[]): HttpRequest => ({
  method: 'DELETE',
  path: `/storage/v1/object/${bucket}`,
  headers: { ...who.headers, 'Content-Type': 'application/json' },
  body: json({ prefixes: paths }),
  codeFields: STORAGE_CODE_FIELDS,
});

// "The resource already exists": HTTP 409, or 400 with statusCode "409" / error "Duplicate".
function isDuplicate(r: HttpResult): boolean {
  if (r.kind !== 'response' || r.ok) return false;
  const body = (r.body ?? {}) as { statusCode?: unknown; error?: unknown };
  return r.status === 409 || body.statusCode === '409' || body.error === 'Duplicate';
}

// ---------------------------------------------------------------------------------------------
// Setup (aborts with a Failure; no check runs before setup has finished)

/** Confirms, read-only, that the tenant id is the tenant `role` (by its latest release's bundle path, `<slug>/releases/<n>.json`). */
async function confirmTenant(s: Session, role: Role, tenantId: string): Promise<string> {
  const r = await s.send(rpc(s.secretKey, A3_FUNCTION, { p_tenant_id: tenantId }));
  if (!isOk(r) || r.kind !== 'response') throw new Failure(`FAILED: setup: confirming tenant ${tenantId}: ${r.detail}; nothing was done`);
  const row = (Array.isArray(r.body) ? r.body[0] : r.body) as { tenant_id?: unknown; bundle_path?: unknown } | null | undefined;
  const bundle = typeof row?.bundle_path === 'string' ? row.bundle_path : undefined;
  if (row?.tenant_id !== tenantId || bundle === undefined) {
    throw new Failure(`FAILED: setup: tenant ${tenantId} has no delivered release, so its slug cannot be confirmed; nothing was done`);
  }
  const slug = bundle.split('/')[0] ?? '';
  if (slug !== role) {
    const shown = SLUG_RE.test(slug) ? slug : '(unexpected slug)';
    throw new Failure(`FAILED: setup: --${role}-tenant-id ${tenantId} is the tenant ${shown}, not ${role}; nothing was done`);
  }
  return slug;
}

/** Finds or creates the test editor, signs it in and adds its one membership. */
async function setUpEditor(s: Session, role: Role, tenantId: string, slug: string): Promise<Editor> {
  const { email } = TEST_SIDES[role];
  const admin = s.secretKey;

  // createUser with email_confirm and no password: no email is sent. Never the invite endpoint.
  const created = await s.send(auth(admin, '/auth/v1/admin/users', { email, email_confirm: true }));
  let createdId: string | undefined;
  if (created.kind === 'response' && created.ok) {
    const id = (created.body as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || !UUID_RE.test(id)) throw new Failure(`FAILED: setup: test user ${email}: unexpected response`);
    createdId = id;
  } else if (!(created.kind === 'response' && created.errorCode !== undefined && EXISTING_USER.has(created.errorCode))) {
    throw new Failure(`FAILED: setup: test user ${email}: ${created.detail}`);
  }

  // A session through a recovery link, one of the links editors sign in with (spec §4.4): admin
  // generate_link (sends no email), then POST /verify with the hashed token, which Auth reports as
  // otp and the sign-in hook allows (decision 72.1). The test editors have no password and get none.
  const link = await s.send(auth(admin, '/auth/v1/admin/generate_link', { type: 'recovery', email }));
  const linkBody = (link.kind === 'response' ? link.body : null) as Record<string, unknown> | null;
  for (const k of ['hashed_token', 'action_link', 'email_otp']) s.secret(linkBody?.[k]);
  if (!isOk(link)) throw new Failure(`FAILED: setup: recovery link for ${email}: ${link.detail}`);
  const userId = linkBody?.id;
  const hashed = linkBody?.hashed_token;
  if (typeof userId !== 'string' || !UUID_RE.test(userId) || typeof hashed !== 'string' || hashed === '') {
    throw new Failure(`FAILED: setup: recovery link for ${email}: unexpected response`);
  }
  if (createdId !== undefined && createdId !== userId) throw new Failure(`FAILED: setup: recovery link for ${email} is not for the created user ${createdId}`);

  const verified = await s.send(auth(s.anon, '/auth/v1/verify', { type: 'recovery', token_hash: hashed }));
  const session = (verified.kind === 'response' ? verified.body : null) as Record<string, unknown> | null;
  s.secret(session?.access_token);
  s.secret(session?.refresh_token);
  if (!isOk(verified)) throw new Failure(`FAILED: setup: sign-in for ${email}: ${verified.detail}`);
  const token = session?.access_token;
  if (typeof token !== 'string' || token === '') throw new Failure(`FAILED: setup: sign-in for ${email}: unexpected response`);
  if ((session?.user as { id?: unknown } | undefined)?.id !== userId) {
    throw new Failure(`FAILED: setup: the session for ${email} is not for user ${userId}; nothing more was done`);
  }

  const editor: Editor = {
    role,
    email,
    tenantId,
    userId,
    userCreated: createdId !== undefined,
    slug,
    label: `the ${role} editor`,
    headers: { apikey: s.target.publishableKey as string, Authorization: `Bearer ${token}` },
  };

  // Idempotent: an existing membership changes nothing.
  const member = await s.send(rpc(admin, 'admin_add_membership', { p_tenant_id: tenantId, p_user_id: userId }));
  if (!isOk(member)) throw new Failure(`FAILED: setup: membership ${tenantId} for ${email}: ${member.detail}`);

  // The test editor must be a member of its own tenant only, or every isolation check is void.
  const tenants = await s.send(read(editor, 'my_tenants', { select: 'id' }));
  if (!isOk(tenants) || tenants.kind !== 'response' || !Array.isArray(tenants.body)) {
    throw new Failure(`FAILED: setup: reading api.my_tenants for ${email}: ${tenants.detail}`);
  }
  const ids = (tenants.body as { id?: unknown }[]).map((t) => String(t.id));
  const others = ids.filter((id) => id !== tenantId);
  if (others.length > 0) {
    const shown = others.map((id) => (UUID_RE.test(id) ? id : '(unexpected id)')).join(' ');
    throw new Failure(`FAILED: setup: test user ${email} (${userId}) is a member of another tenant (${shown}); refusing to run the checks`);
  }
  if (!ids.includes(tenantId)) throw new Failure(`FAILED: setup: test user ${email} (${userId}) is not a member of ${tenantId} after admin_add_membership`);
  return editor;
}

// ---------------------------------------------------------------------------------------------
// A1: cms, private, public and graphql_public are not reachable over the Data API

async function checkA1(s: Session, editors: Record<Role, Editor>): Promise<void> {
  const principals = [s.anon, editors.labak, editors.demo, s.secretKey];
  for (const schema of HIDDEN_SCHEMAS) {
    for (const who of principals) {
      const table = await s.send(read(who, 'entries', { select: '*' }, schema));
      s.check('A1', `schema ${schema} table read refused for ${who.label}`, hasCode(table, 406, 'PGRST106'), observed(table), '406 PGRST106');
      const fn = await s.send(rpc(who, 'extract_refs', { p_data: {} }, schema));
      s.check('A1', `schema ${schema} rpc refused for ${who.label}`, hasCode(fn, 406, 'PGRST106'), observed(fn), '406 PGRST106');
    }
  }
  for (const who of [s.anon, editors.labak, editors.demo]) {
    const r = await s.send(auth(who, '/graphql/v1', { query: '{__typename}' }));
    s.check('A1', `GraphQL refused for ${who.label}`, r.kind === 'response' && !r.ok, observed(r), 'not 2xx');
  }
}

// ---------------------------------------------------------------------------------------------
// A2: invoker api functions write the own tenant only

interface Draft {
  entryId: string;
  version: number;
  reused: boolean;
}

/** Finds the editor's test entry by its fixed title through api.entry_list, or creates it; then saves the draft. */
async function ownDraft(s: Session, e: Editor): Promise<Draft | undefined> {
  const { type } = TEST_SIDES[e.role];
  const found = await s.send(
    read(e, 'entry_list', { select: 'id,draft_version', tenant_id: `eq.${e.tenantId}`, type: `eq.${type}`, title: `eq.${BOUNDARY_TITLE}`, order: 'id.asc', limit: '1' }),
  );
  let draft: Draft | undefined;
  if (isOk(found) && found.kind === 'response' && Array.isArray(found.body) && found.body.length > 0) {
    const row = found.body[0] as { id?: unknown; draft_version?: unknown };
    if (typeof row.id === 'string' && UUID_RE.test(row.id) && Number.isInteger(row.draft_version)) {
      draft = { entryId: row.id, version: row.draft_version as number, reused: true };
    }
    s.check('A2', `${e.role} editor reuses its test entry, found by title`, draft !== undefined, draft ? observed(found) : `${observed(found)}, unexpected row`, '200');
  } else if (!isOk(found)) {
    s.check('A2', `${e.role} editor finds or creates its test entry`, false, observed(found), '200');
  } else {
    const created = await s.send(rpc(e, 'create_entry', { p_tenant_id: e.tenantId, p_type: type }));
    const id = created.kind === 'response' && created.ok ? created.body : undefined;
    const ok = typeof id === 'string' && UUID_RE.test(id);
    s.check('A2', `${e.role} editor creates its test entry`, ok, ok || !isOk(created) ? observed(created) : `${observed(created)}, no entry id`, '200');
    if (ok) draft = { entryId: id, version: 1, reused: false };
  }

  if (draft === undefined) {
    s.check('A2', `${e.role} editor saves a draft in its own tenant`, false, 'not run, no test entry', '200');
    return undefined;
  }
  const saved = await s.send(
    rpc(e, 'save_draft', {
      p_entry_id: draft.entryId,
      p_expected_version: draft.version,
      p_data: DRAFT_DATA,
      p_schema_version: SCHEMA_VERSION,
      p_title: BOUNDARY_TITLE,
      p_sort_at: null,
    }),
  );
  const next = saved.kind === 'response' && saved.ok ? saved.body : undefined;
  const ok = next === draft.version + 1;
  s.check('A2', `${e.role} editor saves a draft in its own tenant`, ok, ok || !isOk(saved) ? observed(saved) : `${observed(saved)}, unexpected version`, '200');
  return ok ? { ...draft, version: draft.version + 1 } : draft;
}

async function checkA2(s: Session, editors: Record<Role, Editor>): Promise<Record<Role, Draft | undefined>> {
  const drafts = { labak: await ownDraft(s, editors.labak), demo: await ownDraft(s, editors.demo) };
  for (const role of ROLES) {
    const e = editors[role];
    const o = otherRole(role);
    const create = await s.send(rpc(e, 'create_entry', { p_tenant_id: editors[o].tenantId, p_type: TEST_SIDES[o].type }));
    s.check('A2', `${role} editor cannot create an entry in the ${o} tenant`, hasCode(create, 400, 'P0001', 'not_found'), observed(create), '400 P0001 not_found');

    const target = drafts[o];
    if (target === undefined) {
      s.check('A2', `${role} editor cannot save the ${o} test draft`, false, `not run, no ${o} test draft`, '400 P0001 not_found');
    } else {
      const save = await s.send(
        rpc(e, 'save_draft', {
          p_entry_id: target.entryId,
          p_expected_version: target.version,
          p_data: DRAFT_DATA,
          p_schema_version: SCHEMA_VERSION,
          p_title: BOUNDARY_TITLE,
          p_sort_at: null,
        }),
      );
      s.check('A2', `${role} editor cannot save the ${o} test draft`, hasCode(save, 400, 'P0001', 'not_found'), observed(save), '400 P0001 not_found');
    }

    const list = await s.send(read(e, 'entry_list', { select: 'id,tenant_id' }));
    const description = `${role} editor's entry list shows no rows of the ${o} tenant`;
    if (!isOk(list) || list.kind !== 'response' || !Array.isArray(list.body)) {
      s.check('A2', description, false, isOk(list) ? `${observed(list)}, not a list` : observed(list), 'only own rows');
      continue;
    }
    const rows = list.body as { id?: unknown; tenant_id?: unknown }[];
    const foreign = rows.filter((r) => r.tenant_id !== e.tenantId).length;
    const seesOther = target !== undefined && rows.some((r) => r.id === target.entryId);
    const ownTestRow = drafts[role] === undefined || rows.some((r) => r.id === drafts[role]?.entryId);
    const notes = [
      foreign > 0 ? `${foreign} row${foreign === 1 ? '' : 's'} of another tenant` : undefined,
      seesOther ? `the ${o} test entry` : undefined,
      ownTestRow ? undefined : 'without its own test entry',
    ].filter((n) => n !== undefined);
    s.check('A2', description, notes.length === 0, [observed(list), ...notes].join(', '), 'only own rows');
  }
  return drafts;
}

// ---------------------------------------------------------------------------------------------
// A3: worker functions are for the secret key only

async function checkA3(s: Session, editors: Record<Role, Editor>): Promise<void> {
  const args = { p_tenant_id: editors.labak.tenantId };
  const ok = await s.send(rpc(s.secretKey, A3_FUNCTION, args));
  s.check('A3', `${A3_FUNCTION} accepted for the secret key`, isOk(ok), observed(ok), '200');
  for (const who of [s.anon, editors.labak, editors.demo]) {
    const r = await s.send(rpc(who, A3_FUNCTION, args));
    s.check('A3', `${A3_FUNCTION} refused for ${who.label}`, hasCode(r, undefined, '42501'), observed(r), '42501');
  }
}

// ---------------------------------------------------------------------------------------------
// A4: media-private by tenant prefix; no editor writes to media-public or delivery

const ownPath = (e: Editor) => `${e.tenantId}/${TEST_SIDES[e.role].objectId}/a.jpg`;

type ObjectState = 'uploaded' | 'already existed; downloaded and verified' | undefined;

/** Downloads the editor's own object: whether it is there with the test bytes, and what was observed. */
async function ownObjectIntact(s: Session, e: Editor): Promise<{ intact: boolean; seen: string }> {
  const r = await s.send(download(e, 'media-private', ownPath(e)));
  if (r.kind !== 'response' || !r.ok) return { intact: false, seen: observed(r, true) };
  const intact = sameBytes(r.bytes, JPEG);
  return { intact, seen: intact ? observed(r) : `${observed(r)}, different bytes` };
}

async function uploadOwn(s: Session, e: Editor): Promise<ObjectState> {
  const up = await s.send(upload(e, 'media-private', ownPath(e)));
  let state: ObjectState;
  if (isOk(up)) {
    s.check('A4', `${e.role} editor uploads its own object`, true, observed(up), '200');
    state = 'uploaded';
  } else if (isDuplicate(up)) {
    // Acceptable only when the editor can download it and it is the test object.
    const { intact, seen } = await ownObjectIntact(s, e);
    const description = `${e.role} editor's own object already existed from an earlier run; downloaded and verified`;
    s.check('A4', description, intact, `${observed(up)}, then ${seen}`, '200, or Duplicate with the test bytes');
    state = intact ? 'already existed; downloaded and verified' : undefined;
  } else {
    s.check('A4', `${e.role} editor uploads its own object`, false, observed(up, true), '200');
  }
  // Run even after a failed upload, so every run prints the same checks.
  const { intact, seen } = await ownObjectIntact(s, e);
  s.check('A4', `${e.role} editor reads its own object`, intact, seen, '200 with the test bytes');
  return intact ? state : undefined;
}

const refused = (s: Session, description: string, r: HttpResult) =>
  s.check('A4', description, r.kind === 'response' && !r.ok, observed(r, true), 'not 2xx');

async function checkA4(s: Session, editors: Record<Role, Editor>): Promise<Record<Role, ObjectState>> {
  // Own objects first, so each cross-tenant read has a real object to be refused.
  const objects = { labak: await uploadOwn(s, editors.labak), demo: await uploadOwn(s, editors.demo) };

  // Cross-tenant attempts, before any attempt on the editor's own object.
  for (const role of ROLES) {
    const e = editors[role];
    const o = editors[otherRole(role)];
    // A fresh path each run: an object left by an earlier run cannot make a refusal look like a pass.
    refused(s, `${role} editor cannot upload into the ${o.role} prefix`, await s.send(upload(e, 'media-private', `${o.tenantId}/${randomUUID()}/a.jpg`)));
    if (objects[o.role] === undefined) {
      s.check('A4', `${role} editor cannot read the ${o.role} test object`, false, `not run, the ${o.role} test object was not confirmed`, 'not 2xx');
    } else {
      refused(s, `${role} editor cannot read the ${o.role} test object`, await s.send(download(e, 'media-private', ownPath(o))));
    }
  }

  for (const role of ROLES) {
    const e = editors[role];
    refused(s, `${role} editor cannot upsert its own object`, await s.send(upload(e, 'media-private', ownPath(e), { upsert: true, bytes: OTHER_JPEG })));
    refused(s, `${role} editor cannot update its own object`, await s.send(upload(e, 'media-private', ownPath(e), { method: 'PUT', upsert: true, bytes: OTHER_JPEG })));
    const kept = await ownObjectIntact(s, e);
    s.check('A4', `${role} editor's own object is unchanged`, kept.intact, kept.seen, '200 with the test bytes');

    const del = await s.send(remove(e, 'media-private', [ownPath(e)]));
    const removed = del.kind === 'response' && del.ok && Array.isArray(del.body) ? del.body.length : 0;
    const after = await ownObjectIntact(s, e);
    const delSeen = del.kind === 'network' ? del.detail : `DELETE ${observed(del, true)}${removed > 0 ? ` (${removed} object${removed === 1 ? '' : 's'} removed)` : ''}`;
    s.check('A4', `${role} editor cannot delete its own object`, removed === 0 && after.intact, `${delSeen}, then download ${after.seen}`, 'the object still there');

    refused(s, `${role} editor cannot upload to media-public under the tenant slug`, await s.send(upload(e, 'media-public', `${e.slug}/${randomUUID()}/a.jpg`)));
    refused(s, `${role} editor cannot upload to media-public under the tenant id`, await s.send(upload(e, 'media-public', `${e.tenantId}/${randomUUID()}/a.jpg`)));
    refused(
      s,
      `${role} editor cannot upload to delivery`,
      await s.send(upload(e, 'delivery', `${e.slug}/releases/boundary-check-${randomUUID()}.json`, { type: 'application/json', bytes: new TextEncoder().encode('{"ok":true}') })),
    );
  }
  return objects;
}

// ---------------------------------------------------------------------------------------------
// The command

/** Runs `boundary-check ...`; returns the exit code (0 every check passed, 1 refused or any check failed, 2 usage). */
export async function runBoundaryCheck(args: string[], io: BoundaryCheckIo, deps: BoundaryCheckDeps): Promise<number> {
  let tenantIds: Record<Role, string>;
  let parsed;
  try {
    parsed = parseArgs(args, { positionals: 0, flags: ['--labak-tenant-id', '--demo-tenant-id'] });
    tenantIds = { labak: requiredFlag(parsed, '--labak-tenant-id', UUID_RE), demo: requiredFlag(parsed, '--demo-tenant-id', UUID_RE) };
    if (tenantIds.labak === tenantIds.demo) throw new UsageError('--labak-tenant-id and --demo-tenant-id must differ');
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    io.error(`boundary-check: ${e.message}`);
    io.error(BOUNDARY_CHECK_USAGE);
    return 2;
  }

  let s: Session | undefined;
  try {
    const target = await readTarget(parsed, deps.readTextFile, { publishableKey: true });
    s = new Session(target, deps.fetch, io);
    s.secret(target.key);
    s.secret(target.publishableKey);
    s.log(`target: ${target.origin.slice('https://'.length)}`);

    const slugs = { labak: await confirmTenant(s, 'labak', tenantIds.labak), demo: await confirmTenant(s, 'demo', tenantIds.demo) };
    const editors = {
      labak: await setUpEditor(s, 'labak', tenantIds.labak, slugs.labak),
      demo: await setUpEditor(s, 'demo', tenantIds.demo, slugs.demo),
    };

    await checkA1(s, editors);
    const drafts = await checkA2(s, editors);
    await checkA3(s, editors);
    const objects = await checkA4(s, editors);

    for (const role of ROLES) {
      const e = editors[role];
      s.log(`test user ${e.email}: ${e.userId} (${e.userCreated ? 'created' : 'existing, reused'})`);
    }
    for (const role of ROLES) {
      const d = drafts[role];
      s.log(`entry ${tenantIds[role]}: ${d === undefined ? 'none' : `${d.entryId} (${d.reused ? 'reused' : 'created'})`}`);
    }
    for (const role of ROLES) {
      const state = objects[role];
      s.log(`object ${tenantIds[role]}: media-private/${ownPath(editors[role])} (${state ?? 'not confirmed'})`);
    }
    s.log(`RESULT: ${s.passed} passed, ${s.failed} failed`);
    return s.failed === 0 ? 0 : 1;
  } catch (e) {
    const line = e instanceof Failure ? e.message : `FAILED: unexpected error (${e instanceof Error ? e.name : 'unknown'})`;
    if (s === undefined) io.error(line);
    else s.error(line);
    return 1;
  }
}
