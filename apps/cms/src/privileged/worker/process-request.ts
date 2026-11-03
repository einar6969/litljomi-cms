// Worker step 1: claim a publish request, validate and project the draft, and commit it through
// the database (spec §6.1–6.3, §5.3; plan Task 19, decisions 10, 34 and 35). The worker trusts
// nothing but the database: it reads the request, the draft and the references' targets in one
// statement (api.worker_read_request), and the commit copies the data from cms.drafts itself,
// re-checking the version, schema version, tenant, membership and references (§6.2).
//
// Before committing a publish, the private original of every asset the draft references that is not
// public yet must exist in media-private (plan Task 30, decision 36.4): the release build copies it
// then, and a missing one would fail every build of the tenant. If one is missing the request fails
// validation (`asset_missing`) with an alert and is never committed, so an entry already live stays
// at its published revision.
//
// Each of those originals is then read and its metadata derived again from its bytes (M3-07,
// decision 50.5): api.register_asset records what the caller declares, so a direct call can store
// false dimensions, type, size or hash. An asset whose stored metadata differs from what its
// original's bytes say, or whose original is not a JPEG, PNG or WebP of at most 20 MB, fails the
// request (`asset_mismatch`) with an alert, and the entry is not committed. Originals are
// immutable for editors (media-private has no update or delete policy), and the metadata columns
// for every writer but the owner, so what is checked here is what the release build copies.
import { DRAFT_OUTDATED, DRAFT_SCHEMA_AHEAD, ProjectionError, projectEntry, type ContentType, type ProjectionContext } from '@litljomi/cms-schema';
import { inspectImage } from '@/editor/server/image-metadata';
import { getModule, getType } from '@/modules/registry';
import { supabaseUrl } from '../../lib/supabase/env';
import type { SupabaseClient } from '../../lib/supabase/types';
import { createAdminClient } from '../admin-client';
import { alert } from './alerts';
import { contextFromRead, publicMediaUrl, type ReadRef } from './projection-context';
import { callRpc, isApiError } from './rpc';
import { MEDIA_PRIVATE, privateMediaPath } from './storage-paths';

export type RequestStatus = 'committed' | 'failed_validation' | 'superseded' | 'rejected' | 'failed' | 'skipped';

/**
 * What became of one request. `status` is the request's final status as the database recorded it,
 * or `skipped` when this run did not process it (not claimable, or finished meanwhile by another
 * run). `errors` is the error object recorded on the request when it did not commit. `type` and
 * `tenantSlug` are null only when a request failed before it could be read.
 */
export type RequestOutcome = {
  requestId: string;
  tenantId: string;
  tenantSlug: string | null;
  entryId: string;
  action: 'publish' | 'unpublish';
  type: string | null;
  status: RequestStatus;
  errors?: unknown;
};

/** An unexpected error leaves a request validating; the claim after 5 minutes retries it, up to this many attempts (§6.3). */
export const MAX_ATTEMPTS = 5;

export type ProcessOptions = {
  /**
   * Whether an object exists in media-private (a path `{tenant_id}/{asset_id}/{filename}`); throws
   * when it cannot tell. Defaults to the admin client's Storage API.
   */
  originalExists?: (path: string) => Promise<boolean>;
  /**
   * The bytes of an object in media-private that exists; throws when it cannot be read. Defaults
   * to a download through the admin client's Storage API.
   */
  readOriginal?: (path: string) => Promise<Uint8Array>;
};

type ClaimedRow = {
  id: string | null;
  tenant_id: string;
  entry_id: string;
  action: 'publish' | 'unpublish';
  draft_version: number | null;
  attempts: number;
};

/** A row the claim returned: its id is set. */
type ClaimedRequest = ClaimedRow & { id: string };

type WorkerRead = {
  request: ClaimedRequest & { error: unknown };
  entry: { id: string; tenant_id: string; type: string; slug: string | null };
  tenant: { id: string; slug: string; status: string };
  draft: { data: unknown; version: number; schema_version: number };
  refs: ReadRef[];
};

/** The status a commit function returns (and records on the request). */
type CommitStatus = Exclude<RequestStatus, 'skipped'>;

type Result = { status: CommitStatus; errors?: unknown };

/**
 * Claims one request (api.worker_claim_request) and processes it. A request that is not claimable
 * (already being processed, or finished) is `skipped`. An unexpected error below the attempt limit
 * is thrown, leaving the request validating for the re-claim; at the limit the request is failed
 * and an alert raised.
 */
export async function processRequestById(requestId: string, options: ProcessOptions = {}): Promise<RequestOutcome> {
  const db = createAdminClient();
  const row = await callRpc<ClaimedRow | null>(db, 'worker_claim_request', { p_request_id: requestId });
  if (row?.id == null) {
    const read = await callRpc<WorkerRead>(db, 'worker_read_request', { p_request_id: requestId });
    return { ...outcomeOf(read), status: 'skipped' };
  }
  return processClaimed(db, row as ClaimedRequest, originalsOf(db, options));
}

/**
 * Claims up to `limit` pending (or stale) requests, oldest first (api.worker_claim_requests), and
 * processes them one after another. A request that hits an unexpected error is logged and left
 * validating for the re-claim; it has no outcome here, and the others still run.
 */
export async function processPendingRequests(limit = 10, options: ProcessOptions = {}): Promise<RequestOutcome[]> {
  const db = createAdminClient();
  const rows = (await callRpc<ClaimedRequest[] | null>(db, 'worker_claim_requests', { p_limit: limit })) ?? [];
  const outcomes: RequestOutcome[] = [];
  const originals = originalsOf(db, options);
  for (const row of rows) {
    try {
      outcomes.push(await processClaimed(db, row, originals));
    } catch (error) {
      // failUnexpected logged the cause; this line records that the sweep moved on without it.
      console.error(`[cms-worker] request ${row.id} has no outcome in this sweep; it stays validating for the re-claim`, error);
    }
  }
  return outcomes;
}

/** Concurrent Storage `exists` requests while checking a request's private originals. */
const ORIGINAL_CHECKS_AT_A_TIME = 8;
/** Concurrent downloads while re-deriving originals' metadata (each up to 20 MB in memory). */
const ORIGINAL_READS_AT_A_TIME = 4;

/** Access to the private originals: whether one exists, and its bytes. */
type Originals = { exists: (path: string) => Promise<boolean>; read: (path: string) => Promise<Uint8Array> };

/** The given lookups, or media-private through the admin client for those not given. */
function originalsOf(db: SupabaseClient, options: ProcessOptions): Originals {
  const exists =
    options.originalExists ??
    (async (path: string) => {
      // storage-js answers `data: false` with an error for 400 and 404 and throws on anything else.
      // An answer that is neither (no `true`, no `false`) is not read as "missing": it fails.
      const { data, error } = await db.storage.from(MEDIA_PRIVATE).exists(path);
      if (typeof data !== 'boolean') throw new Error(`media-private exists(${path}): ${error?.message ?? 'no answer'}`);
      return data;
    });
  const read =
    options.readOriginal ??
    (async (path: string) => {
      // The original was just found; failing to read it now is unexpected (retried), never "missing".
      const { data, error } = await db.storage.from(MEDIA_PRIVATE).download(path);
      if (error || !data) throw new Error(`media-private download(${path}): ${error?.message ?? 'no data'}`);
      return new Uint8Array(await data.arrayBuffer());
    });
  return { exists, read };
}

function outcomeOf(read: WorkerRead): Omit<RequestOutcome, 'status'> {
  return {
    requestId: read.request.id,
    tenantId: read.request.tenant_id,
    tenantSlug: read.tenant.slug,
    entryId: read.request.entry_id,
    action: read.request.action,
    type: read.entry.type,
  };
}

async function processClaimed(db: SupabaseClient, row: ClaimedRequest, originals: Originals): Promise<RequestOutcome> {
  let read: WorkerRead | null = null;
  try {
    read = await callRpc<WorkerRead>(db, 'worker_read_request', { p_request_id: row.id });
    const result: Result =
      row.action === 'unpublish'
        ? { status: await callRpc<CommitStatus>(db, 'worker_commit_unpublish', { p_request_id: row.id }) }
        : await publish(db, read, originals);
    if (result.status !== 'committed' && result.errors === undefined) await addRecordedErrors(db, row.id, result);
    return { ...outcomeOf(read), ...result };
  } catch (error) {
    // forbidden or not_found from a commit or a rejection: another run re-claimed the request and
    // finished it first (decision 35).
    if (read !== null && isApiError(error, 'forbidden', 'not_found')) return { ...outcomeOf(read), status: 'skipped' };
    return failUnexpected(db, row, read, error);
  }
}

/**
 * The commit recorded why the request did not commit (superseded, rejected, invalid references):
 * reads it back into `result.errors`. The request is already finished, so a failed re-read is
 * logged and the status returned without `errors`, not retried.
 */
async function addRecordedErrors(db: SupabaseClient, requestId: string, result: Result): Promise<void> {
  try {
    const after = await callRpc<WorkerRead>(db, 'worker_read_request', { p_request_id: requestId });
    result.errors = after.request.error;
  } catch (error) {
    console.error(`[cms-worker] request ${requestId} finished as ${result.status}, but its recorded error could not be read`, error);
  }
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * §6.3: retry through the re-claim below MAX_ATTEMPTS; at the limit, fail the request and alert.
 * The stored error is a stable code (editors can read publish_requests.error); the database
 * message goes only to the log and the alert (service_role and platform admins).
 */
async function failUnexpected(db: SupabaseClient, row: ClaimedRequest, read: WorkerRead | null, error: unknown): Promise<RequestOutcome> {
  if (row.attempts < MAX_ATTEMPTS) {
    console.error(`[cms-worker] request ${row.id} failed (attempt ${row.attempts} of ${MAX_ATTEMPTS}); left for retry`, error);
    throw error;
  }
  const failure = { code: 'unexpected', attempts: row.attempts };
  const details = { tenantId: row.tenant_id, requestId: row.id, entryId: row.entry_id, action: row.action, ...failure, message: messageOf(error) };
  const base = read
    ? outcomeOf(read)
    : { requestId: row.id, tenantId: row.tenant_id, tenantSlug: null, entryId: row.entry_id, action: row.action, type: null };
  try {
    await callRpc(db, 'worker_reject_request', { p_request_id: row.id, p_status: 'failed', p_error: failure });
  } catch (rejectError) {
    if (isApiError(rejectError, 'forbidden', 'not_found')) return { ...base, status: 'skipped' };
    // The request stays validating and is re-claimed; alert now, as the limit is already reached.
    console.error(`[cms-worker] request ${row.id} reached ${row.attempts} attempts, but failed could not be stored`, rejectError);
    await alert('publish_request.failed', { ...details, stored: false, storeError: messageOf(rejectError) });
    throw rejectError;
  }
  await alert('publish_request.failed', details);
  return { ...base, status: 'failed', errors: failure };
}

/** Validates and projects a publish request's draft, checks its private originals, then commits it (§6.1, §6.2). */
async function publish(db: SupabaseClient, read: WorkerRead, originals: Originals): Promise<Result> {
  const { request, entry, tenant, draft } = read;
  const commit = (validatedVersion: number | null, title: string | null, sortAt: string | null) =>
    callRpc<CommitStatus>(db, 'worker_commit_publish', {
      p_request_id: request.id,
      p_validated_draft_version: validatedVersion,
      p_validated_schema_version: draft.schema_version,
      p_title: title,
      p_sort_at: sortAt,
    });
  const reject = async (errors: Record<string, unknown>): Promise<Result> => {
    await callRpc(db, 'worker_reject_request', { p_request_id: request.id, p_status: 'failed_validation', p_error: errors });
    return { status: 'failed_validation', errors };
  };

  // The draft moved on after the request: no validation; the commit records superseded itself.
  if (draft.version !== request.draft_version) return { status: await commit(request.draft_version, null, null) };

  const module = getModule(tenant.slug);
  const type = getType(tenant.slug, entry.type);
  if (!module || !type) return reject({ code: 'unknown_type', type: entry.type });
  // §5.3: only a draft at the type's current schema version can be published. The worker never
  // upcasts a draft (the editor or the draft migration saves it at the current version first); the
  // code tells an outdated draft (DRAFT_OUTDATED, which can be updated) from one written by a newer
  // deploy than this one (DRAFT_SCHEMA_AHEAD).
  if (draft.schema_version !== type.version) {
    const code = draft.schema_version < type.version ? DRAFT_OUTDATED : DRAFT_SCHEMA_AHEAD;
    return reject({ code, draftSchemaVersion: draft.schema_version, currentSchemaVersion: type.version });
  }
  // projectEntry validates again, but validating first gives the editor's own errors their own
  // code (invalid_data); projection_failed is left for what only the projection can find.
  const invalid = validate(type, draft.data);
  if (invalid) return reject(invalid);
  // Decision 34.5: an entry of a type with site pages needs a slug for its path. Checked on the
  // read only, not again at commit: the revision stores no path, and the release build projects
  // with the slug the entry has then.
  if (module.site[type.name] && entry.slug === null) return reject({ code: 'slug_required' });

  // Project exactly as the release build would (§6.2), so committed content is deliverable.
  const base = supabaseUrl();
  const ctx = contextFromRead(read.refs, module, (path) => publicMediaUrl(base, path));
  const unprojectable = project(type, draft.data, ctx);
  if (unprojectable) return reject(unprojectable);

  // Decision 36.4: the originals the release build will copy must exist, or the request fails here.
  const pending = pendingOriginals(read);
  const missing = await missingOriginals(pending, originals.exists);
  if (missing.length > 0) {
    const result = await reject({ code: 'asset_missing', assetIds: missing });
    await alert('publish_request.asset_missing', { tenantId: tenant.id, requestId: request.id, entryId: entry.id, assetIds: missing });
    return result;
  }

  // M3-07: the stored metadata must be what the originals' bytes say.
  const mismatched = await mismatchedOriginals(db, tenant.id, pending, originals.read);
  if (mismatched.length > 0) {
    const assetIds = mismatched.map((m) => m.id);
    const result = await reject({ code: 'asset_mismatch', assetIds });
    await alert('publish_request.asset_mismatch', { tenantId: tenant.id, requestId: request.id, entryId: entry.id, assets: mismatched });
    return result;
  }

  const { title, sortAt } = type.queryColumns(draft.data);
  return { status: await commit(draft.version, title, sortAt) };
}

/** A referenced asset whose original the release build will copy; `path` is null when it cannot be built. */
type PendingOriginal = { id: string; path: string | null };

/**
 * The referenced assets that are not public yet, not archived and in the request's tenant (the
 * read gives a filename only then; the commit refuses the others as invalid references), once
 * each, in reference order. The path is the one api.register_asset requires.
 */
function pendingOriginals(read: WorkerRead): PendingOriginal[] {
  const assets: PendingOriginal[] = [];
  const seen = new Set<string>();
  for (const r of read.refs) {
    if (r.kind !== 'asset' || r.archived || r.public_path !== null || r.filename === null || seen.has(r.id)) continue;
    seen.add(r.id);
    let path: string | null;
    try {
      path = privateMediaPath(read.tenant.id, r.id, r.filename);
    } catch {
      path = null;
    }
    assets.push({ id: r.id, path });
  }
  return assets;
}

/**
 * The ids of the pending assets whose private original is not in media-private, in reference
 * order. An asset whose path cannot be built cannot have an original there, so it counts as
 * missing.
 */
async function missingOriginals(assets: PendingOriginal[], originalExists: Originals['exists']): Promise<string[]> {
  // At most ORIGINAL_CHECKS_AT_A_TIME Storage requests in flight (up to 1,000 references, decision 28).
  const present: boolean[] = [];
  for (let i = 0; i < assets.length; i += ORIGINAL_CHECKS_AT_A_TIME) {
    const batch = assets.slice(i, i + ORIGINAL_CHECKS_AT_A_TIME);
    present.push(...(await Promise.all(batch.map((a) => (a.path === null ? false : originalExists(a.path))))));
  }
  return assets.filter((_, i) => !present[i]).map((a) => a.id);
}

/** The metadata api.worker_asset_metadata returns for an asset. */
type StoredMetadata = { id: string; original_path: string; mime: string; bytes: number; width: number; height: number; sha256: string };

/** The metadata fields compared with the original's bytes. */
const METADATA_FIELDS = ['mime', 'bytes', 'width', 'height', 'sha256'] as const;

/** An asset whose stored metadata is not what its original says: the differing fields, or why the original was refused. */
export type MetadataMismatch = { id: string; fields: string[] } | { id: string; original: 'type' | 'size' };

/**
 * The pending assets (every one has an original in media-private, checked just before) whose
 * stored metadata differs from what their original's bytes say (`inspectImage`, the same
 * derivation the upload's server action uses), in reference order. An original that is not an
 * accepted image of at most 20 MB is a mismatch too. The stored row is read through
 * api.worker_asset_metadata; an asset without one, or whose stored path is not the one checked,
 * counts as a mismatch of the path.
 */
async function mismatchedOriginals(
  db: SupabaseClient,
  tenantId: string,
  assets: PendingOriginal[],
  readOriginal: Originals['read'],
): Promise<MetadataMismatch[]> {
  if (assets.length === 0) return [];
  const rows = (await callRpc<StoredMetadata[] | null>(db, 'worker_asset_metadata', { p_tenant_id: tenantId, p_asset_ids: assets.map((a) => a.id) })) ?? [];
  const stored = new Map(rows.map((r) => [r.id, r]));
  const check = async (asset: PendingOriginal): Promise<MetadataMismatch | null> => {
    const row = stored.get(asset.id);
    // missingOriginals counted a null path as missing, so every path here is set.
    if (!row || asset.path === null || row.original_path !== asset.path) return { id: asset.id, fields: ['original_path'] };
    const derived = await inspectImage(await readOriginal(asset.path));
    if (!derived.ok) return { id: asset.id, original: derived.reason };
    // bigint columns may arrive as numbers or strings; compare their text.
    const fields = METADATA_FIELDS.filter((f) => String(row[f]) !== String(derived[f]));
    return fields.length > 0 ? { id: asset.id, fields } : null;
  };
  const results: Array<MetadataMismatch | null> = [];
  for (let i = 0; i < assets.length; i += ORIGINAL_READS_AT_A_TIME) {
    results.push(...(await Promise.all(assets.slice(i, i + ORIGINAL_READS_AT_A_TIME).map(check))));
  }
  return results.filter((m): m is MetadataMismatch => m !== null);
}

type Failure = Record<string, unknown> | null;

/**
 * Runs a check. A RangeError (the validator's or a projection's recursion overflowing the stack on
 * very deep nesting; Task 14 security r1) is a failed validation, not a crash.
 */
function depthGuarded(check: () => Failure): Failure {
  try {
    return check();
  } catch (error) {
    if (error instanceof RangeError) return { code: 'too_deep' };
    throw error;
  }
}

/** Strict validation (the publish validator). */
function validate(type: ContentType, data: unknown): Failure {
  return depthGuarded(() => {
    const parsed = type.publishValidator().safeParse(data);
    return parsed.success ? null : { code: 'invalid_data', issues: issuesOf(parsed.error.issues) };
  });
}

/** The pre-commit projection; its result is discarded, only its failure matters. */
function project(type: ContentType, data: unknown, ctx: ProjectionContext): Failure {
  return depthGuarded(() => {
    try {
      projectEntry(type, data, ctx);
      return null;
    } catch (error) {
      if (error instanceof ProjectionError) return { code: 'projection_failed', issues: issuesOf(error.issues) };
      throw error;
    }
  });
}

/** Zod issues as stored on the request: code, path and message only (JSON-safe). */
function issuesOf(issues: ReadonlyArray<{ code: string; path: ReadonlyArray<PropertyKey>; message: string }>) {
  return issues.map((i) => ({
    code: i.code,
    path: i.path.map((p) => (typeof p === 'symbol' ? String(p) : p)),
    message: i.message,
  }));
}
