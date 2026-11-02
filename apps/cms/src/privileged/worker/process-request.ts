// Worker step 1: claim a publish request, validate and project the draft, and commit it through
// the database (spec §6.1–6.3, §5.3; plan Task 19, decisions 10, 34 and 35). The worker trusts
// nothing but the database: it reads the request, the draft and the references' targets in one
// statement (api.worker_read_request), and the commit copies the data from cms.drafts itself,
// re-checking the version, schema version, tenant, membership and references (§6.2).
import { ProjectionError, projectEntry, type ContentType } from '@litljomi/cms-schema';
import { getModule, getType } from '@/modules/registry';
import type { SupabaseClient } from '../../lib/supabase/types';
import { createAdminClient } from '../admin-client';
import { alert } from './alerts';
import { contextFromRead, publicMediaUrl, type ReadRef } from './projection-context';
import { callRpc, isApiError } from './rpc';

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

type ClaimedRow = {
  id: string | null;
  tenant_id: string;
  entry_id: string;
  action: 'publish' | 'unpublish';
  draft_version: number | null;
  attempts: number;
};

type WorkerRead = {
  request: ClaimedRow & { id: string; error: unknown };
  entry: { id: string; tenant_id: string; type: string; slug: string | null };
  tenant: { id: string; slug: string; status: string };
  draft: { data: unknown; version: number; schema_version: number };
  refs: ReadRef[];
};

type Result = { status: Exclude<RequestStatus, 'skipped'>; errors?: unknown };

/**
 * Claims one request (api.worker_claim_request) and processes it. A request that is not claimable
 * (already being processed, or finished) is `skipped`. An unexpected error below the attempt limit
 * is thrown, leaving the request validating for the re-claim; at the limit the request is failed
 * and an alert raised.
 */
export async function processRequestById(requestId: string): Promise<RequestOutcome> {
  const db = createAdminClient();
  const row = await callRpc<ClaimedRow | null>(db, 'worker_claim_request', { p_request_id: requestId });
  if (row?.id == null) {
    const read = await callRpc<WorkerRead>(db, 'worker_read_request', { p_request_id: requestId });
    return { ...outcomeOf(read), status: 'skipped' };
  }
  return processClaimed(db, row as ClaimedRow & { id: string });
}

/**
 * Claims up to `limit` pending (or stale) requests, oldest first (api.worker_claim_requests), and
 * processes them one after another. A request that hits an unexpected error is logged and left for
 * the retry; it has no outcome here, and the others still run.
 */
export async function processPendingRequests(limit = 10): Promise<RequestOutcome[]> {
  const db = createAdminClient();
  const rows = (await callRpc<Array<ClaimedRow & { id: string }> | null>(db, 'worker_claim_requests', { p_limit: limit })) ?? [];
  const outcomes: RequestOutcome[] = [];
  for (const row of rows) {
    try {
      outcomes.push(await processClaimed(db, row));
    } catch {
      // Logged by processClaimed; the request stays validating for the re-claim.
    }
  }
  return outcomes;
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

async function processClaimed(db: SupabaseClient, row: ClaimedRow & { id: string }): Promise<RequestOutcome> {
  let read: WorkerRead | null = null;
  try {
    read = await callRpc<WorkerRead>(db, 'worker_read_request', { p_request_id: row.id });
    const result: Result =
      row.action === 'unpublish'
        ? { status: await callRpc<Result['status']>(db, 'worker_commit_unpublish', { p_request_id: row.id }) }
        : await publish(db, read);
    if (result.status !== 'committed' && result.errors === undefined) {
      // The commit recorded why on the request (superseded, rejected, invalid references).
      const after = await callRpc<WorkerRead>(db, 'worker_read_request', { p_request_id: row.id });
      result.errors = after.request.error;
    }
    return { ...outcomeOf(read), ...result };
  } catch (error) {
    // forbidden or not_found from a commit or a rejection: another run re-claimed the request and
    // finished it first (decision 35).
    if (read !== null && isApiError(error, 'forbidden', 'not_found')) return { ...outcomeOf(read), status: 'skipped' };
    return failUnexpected(db, row, read, error);
  }
}

/** §6.3: retry through the re-claim below MAX_ATTEMPTS; at the limit, fail the request and alert. */
async function failUnexpected(db: SupabaseClient, row: ClaimedRow & { id: string }, read: WorkerRead | null, error: unknown): Promise<RequestOutcome> {
  if (row.attempts < MAX_ATTEMPTS) {
    console.error(`[cms-worker] request ${row.id} failed (attempt ${row.attempts} of ${MAX_ATTEMPTS}); left for retry`, error);
    throw error;
  }
  const failure = { code: 'unexpected', attempts: row.attempts, message: error instanceof Error ? error.message : String(error) };
  const base = read
    ? outcomeOf(read)
    : { requestId: row.id, tenantId: row.tenant_id, tenantSlug: null, entryId: row.entry_id, action: row.action, type: null };
  try {
    await callRpc(db, 'worker_reject_request', { p_request_id: row.id, p_status: 'failed', p_error: failure });
  } catch (rejectError) {
    if (isApiError(rejectError, 'forbidden', 'not_found')) return { ...base, status: 'skipped' };
    throw rejectError;
  }
  await alert('publish_request.failed', { tenantId: row.tenant_id, requestId: row.id, entryId: row.entry_id, action: row.action, ...failure });
  return { ...base, status: 'failed', errors: failure };
}

/** Validates and projects a publish request's draft, then commits it (§6.1, §6.2). */
async function publish(db: SupabaseClient, read: WorkerRead): Promise<Result> {
  const { request, entry, tenant, draft } = read;
  const commit = (validatedVersion: number | null, title: string | null, sortAt: string | null) =>
    callRpc<Result['status']>(db, 'worker_commit_publish', {
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
  const invalid = validate(type, draft.data);
  if (invalid) return reject(invalid);
  // Decision 34.5: an entry of a type with site pages needs a slug for its path.
  if (module.site[type.name] && entry.slug === null) return reject({ code: 'slug_required' });

  // Project exactly as the release build would (§6.2), so committed content is deliverable.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const ctx = contextFromRead(read.refs, module, (path) => publicMediaUrl(supabaseUrl, path));
  try {
    projectEntry(type, draft.data, ctx);
  } catch (error) {
    if (error instanceof ProjectionError) return reject({ code: 'projection_failed', issues: issuesOf(error.issues) });
    if (error instanceof RangeError) return reject({ code: 'too_deep' });
    throw error;
  }

  const { title, sortAt } = type.queryColumns(draft.data);
  return { status: await commit(draft.version, title, sortAt) };
}

/**
 * Strict validation (the publish validator). A RangeError (the validator's recursion overflowing
 * the stack on very deep nesting; Task 14 security r1) is a failed validation, not a crash.
 */
function validate(type: ContentType, data: unknown): Record<string, unknown> | null {
  let parsed;
  try {
    parsed = type.publishValidator().safeParse(data);
  } catch (error) {
    if (error instanceof RangeError) return { code: 'too_deep' };
    throw error;
  }
  return parsed.success ? null : { code: 'invalid_data', issues: issuesOf(parsed.error.issues) };
}

/** Zod issues as stored on the request: code, path and message only (JSON-safe). */
function issuesOf(issues: ReadonlyArray<{ code: string; path: ReadonlyArray<PropertyKey>; message: string }>) {
  return issues.map((i) => ({
    code: i.code,
    path: i.path.map((p) => (typeof p === 'symbol' ? String(p) : p)),
    message: i.message,
  }));
}
