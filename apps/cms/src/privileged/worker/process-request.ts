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
import { ProjectionError, projectEntry, type ContentType, type ProjectionContext } from '@litljomi/cms-schema';
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
  return processClaimed(db, row as ClaimedRequest, originalLookup(db, options));
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
  const originalExists = originalLookup(db, options);
  for (const row of rows) {
    try {
      outcomes.push(await processClaimed(db, row, originalExists));
    } catch (error) {
      // failUnexpected logged the cause; this line records that the sweep moved on without it.
      console.error(`[cms-worker] request ${row.id} has no outcome in this sweep; it stays validating for the re-claim`, error);
    }
  }
  return outcomes;
}

/** Concurrent Storage `exists` requests while checking a request's private originals. */
const ORIGINAL_CHECKS_AT_A_TIME = 8;

type OriginalExists = (path: string) => Promise<boolean>;

/** The lookup of private originals: the given one, or media-private through the admin client. */
function originalLookup(db: SupabaseClient, options: ProcessOptions): OriginalExists {
  if (options.originalExists) return options.originalExists;
  return async (path) => {
    // storage-js answers `data: false` with an error for 400 and 404 and throws on anything else.
    // An answer that is neither (no `true`, no `false`) is not read as "missing": it fails.
    const { data, error } = await db.storage.from(MEDIA_PRIVATE).exists(path);
    if (typeof data !== 'boolean') throw new Error(`media-private exists(${path}): ${error?.message ?? 'no answer'}`);
    return data;
  };
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

async function processClaimed(db: SupabaseClient, row: ClaimedRequest, originalExists: OriginalExists): Promise<RequestOutcome> {
  let read: WorkerRead | null = null;
  try {
    read = await callRpc<WorkerRead>(db, 'worker_read_request', { p_request_id: row.id });
    const result: Result =
      row.action === 'unpublish'
        ? { status: await callRpc<CommitStatus>(db, 'worker_commit_unpublish', { p_request_id: row.id }) }
        : await publish(db, read, originalExists);
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
async function publish(db: SupabaseClient, read: WorkerRead, originalExists: OriginalExists): Promise<Result> {
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
  // §5.3: only a draft at the type's current schema version can be published.
  if (draft.schema_version !== type.version) {
    return reject({ code: 'schema_outdated', draftSchemaVersion: draft.schema_version, currentSchemaVersion: type.version });
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
  const missing = await missingOriginals(read, originalExists);
  if (missing.length > 0) {
    const result = await reject({ code: 'asset_missing', assetIds: missing });
    await alert('publish_request.asset_missing', { tenantId: tenant.id, requestId: request.id, entryId: entry.id, assetIds: missing });
    return result;
  }

  const { title, sortAt } = type.queryColumns(draft.data);
  return { status: await commit(draft.version, title, sortAt) };
}

/**
 * The ids of the referenced assets that are not public yet, not archived and in the request's
 * tenant (the read gives a filename only then; the commit refuses the others as invalid
 * references) whose private original is not in media-private, in reference order. The path is the
 * one api.register_asset requires; an asset whose path cannot be built cannot have an original
 * there, so it counts as missing.
 */
async function missingOriginals(read: WorkerRead, originalExists: OriginalExists): Promise<string[]> {
  // In reference order; `path` is null when it cannot be built (counted as missing without a lookup).
  const assets: Array<{ id: string; path: string | null }> = [];
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
  // At most ORIGINAL_CHECKS_AT_A_TIME Storage requests in flight (up to 1,000 references, decision 28).
  const present: boolean[] = [];
  for (let i = 0; i < assets.length; i += ORIGINAL_CHECKS_AT_A_TIME) {
    const batch = assets.slice(i, i + ORIGINAL_CHECKS_AT_A_TIME);
    present.push(...(await Promise.all(batch.map((a) => (a.path === null ? false : originalExists(a.path))))));
  }
  return assets.filter((_, i) => !present[i]).map((a) => a.id);
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
