// Worker step 2: build and deliver a tenant's release (spec §5.6, §7.1, §7.2; plan Task 20,
// decisions 10, 34 and 35; "Withdrawal and failure visibility").
//
// The bundle holds every entry the database says is published and not archived in one snapshot
// (withdrawal always wins), projected from its published revision. An entry that cannot be
// projected falls back to its projection in the previous release only when that projection was
// built from the same revision and everything it references is still allowed (its assets are not
// archived, its referenced entries are in this release); otherwise it is left out and resolves to
// null for every other entry (§7.1, fail closed; plan M3-05). Either way the entry is recorded in
// releases.error (`fallback` or `omitted`) and alerted. The switch is atomic: the bundle is written
// and read back, then the pointer is written and read back; any failure up to and including that
// read-back marks the release failed, and the pointer never names a bundle that was not verified.
//
// The pointer only ever moves forward (§7.1; plan Task 30, decision 37.1). Before writing it the
// worker (c) reads the current pointer and refuses if it names this release or a newer one, (b)
// asks the database whether this release is still building and refuses if it is not or if a
// delivered release has a number at or above this one, and (a) refuses once POINTER_DEADLINE_MS
// have passed since the release began, well before the sweep fails it as stale (420 s). A refusal
// fails the build with an alert. If the finish is refused or fails after the pointer was written,
// the pointer is left as it is (never written back to an older release) and an alert is raised;
// the requests stay unlinked, so the next build delivers a newer release.
//
// Before writing anything public, the build records it (plan M3-06): the bundle's path is fixed by
// the release row, and api.worker_record_release_media stores every asset the release references.
// The sweep's retention step (retention.ts) deletes what expired releases recorded, failed builds
// included, and clears public_path for the media it deletes, so whether to copy an asset is the
// record's answer (no public object known), not the snapshot's.
import {
  ProjectionError,
  UpcastError,
  entryContentHash,
  isManuallyOrdered,
  projectEntry,
  type ContentType,
  type ModuleManifest,
} from '@litljomi/cms-schema';
import type { Bundle, BundleEntry, Pointer } from '@litljomi/cms-sdk';
import { getModule } from '@/modules/registry';
import { supabaseUrl } from '../../lib/supabase/env';
import type { SupabaseClient } from '../../lib/supabase/types';
import { createAdminClient } from '../admin-client';
import { alert } from './alerts';
import { liveTargets } from './live-targets';
import { buildProjectionContext, localStackOrigin, publicMediaUrl, type ContextAsset, type ContextEntry } from './projection-context';
import { callRpc, isApiError } from './rpc';
import {
  deliveryBundlePath,
  deliveryPointerPath,
  MEDIA_PRIVATE,
  POINTER_MAX_AGE_S,
  pointerBundlePath,
  privateMediaPath,
  publicMediaPath,
} from './storage-paths';

/** §7.2. */
export const BUNDLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
/** §7.2. */
export const POINTER_CACHE_CONTROL = `public, max-age=${POINTER_MAX_AGE_S}`;
/**
 * No pointer is written once this long has passed since `worker_begin_release` succeeded (decision
 * 37.1 (a)): 270 s of the worker's 300 s maxDuration, so a build that runs late fails instead of
 * moving the pointer after the sweep may have failed its release (at 420 s).
 */
export const POINTER_DEADLINE_MS = 270_000;
/** Omitted entries past this many are stored with their error code only (Task 20 quality r1, Minor 6). */
export const MAX_STORED_OMISSION_DETAILS = 50;
/**
 * How often, and how far apart, the build records its media again while a sweep is deleting some of
 * it (M3-06): 6 attempts 5 s apart. A sweep deletes one batch in seconds; a build still waiting
 * after that fails and is retried on M3-02's schedule.
 */
export const RECORD_MEDIA_ATTEMPTS = 6;
export const RECORD_MEDIA_WAIT_MS = 5_000;

const DELIVERY = 'delivery';
const MEDIA_PUBLIC = 'media-public';

/** The storage operations of a build; the default goes through the admin client's Storage API. */
export interface ReleaseStorage {
  /** `cacheControl` is the complete `cache-control` header value. Throws on any error. */
  upload(bucket: string, path: string, body: Uint8Array, o: { cacheControl: string; contentType: string; upsert: boolean }): Promise<void>;
  /** The object's bytes; throws when it cannot be read. */
  download(bucket: string, path: string): Promise<Uint8Array>;
  /** Server-side copy (no download). An existing destination is `exists`, not an error (decision 35). */
  copy(from: { bucket: string; path: string }, to: { bucket: string; path: string }): Promise<'copied' | 'exists'>;
}

/** An entry left out of a release, as recorded in `releases.error.omitted` (decision 35). */
export type OmittedEntry = { entryId: string; requestIds: string[]; error: unknown };
/**
 * An entry whose projection failed and whose projection from release `fromRelease` was reused
 * (§7.1, conditions 1 and 2), as recorded in `releases.error.fallback` (plan M3-05).
 */
export type FallbackEntry = OmittedEntry & { fromRelease: number };

export type BuildResult = {
  status: 'delivered' | 'failed' | 'busy';
  releaseId?: string;
  number?: number;
  omitted: OmittedEntry[];
  /** Entries served from the previous release's projection (§7.1); absent when there are none. */
  fallback?: FallbackEntry[];
  bundle?: Bundle;
  /** The tenant's previously delivered bundle (null for the first release), for the live checks. */
  previousBundle?: Bundle | null;
  /**
   * Delivered only: every request linked to the release (the snapshot's committed requests, those
   * of omitted entries included), in request order, so the caller can live-check each (Task 21).
   */
  requests?: LinkedRequest[];
  /**
   * Delivered only: when the pointer was written (epoch ms, from `now`), for the live check's
   * resend (decision 48), which compares it with `Date.now()`: an injected `now` must be wall time.
   */
  pointerWrittenAt?: number;
};

/** A committed request linked to a delivered release. */
export type LinkedRequest = {
  id: string;
  entryId: string;
  action: 'publish' | 'unpublish';
  /** Whether an earlier release reached a site with the entry (api.worker_entry_was_delivered). */
  wasDelivered: boolean;
};

export type BuildOptions = {
  db?: SupabaseClient;
  storage?: ReleaseStorage;
  /** The public URL of a `media-public` path; defaults to the Supabase project's public object URL. */
  mediaUrl?: (publicPath: string) => string;
  now?: () => Date;
  /** A monotonic clock in milliseconds, for the pointer deadline; defaults to `performance.now`. */
  clock?: () => number;
  /** Waits between media records while a sweep is deleting (M3-06); defaults to a timer. */
  sleep?: (ms: number) => Promise<void>;
};

type ReleaseRow = { id: string | null; tenant_id: string | null; number: number | null; status: string | null; bundle_path?: string | null };

type SnapshotEntry = {
  entry_id: string;
  type: string;
  slug: string | null;
  revision_id: string;
  schema_version: number;
  data: unknown;
  title: string | null;
  sort_at: string | null;
  first_published_at: string;
  last_published_at: string;
  /**
   * The entry's place (from 1) among the snapshot's entries of its type, in the order editors give
   * a manually ordered type (A12, migration 20261112230000_manual_order). Absent from a database
   * without that migration.
   */
  order_rank?: number;
  refs: Array<{ path: string; kind: 'entry' | 'asset'; id: string }>;
};
type SnapshotAsset = ContextAsset & { original_path: string; archived: boolean };
type Snapshot = {
  release: { id: string; tenant_id: string; number: number; status: string };
  tenant: { id: string; slug: string };
  entries: SnapshotEntry[];
  assets: SnapshotAsset[];
  requests: Array<{ id: string; entry_id: string; action: 'publish' | 'unpublish'; revision_id: string | null; was_delivered: boolean }>;
};

/**
 * A failure at a named step of the build. `code` is what releases.error records: `build_failed`,
 * `pointer_refused` (a forward-only check refused the pointer write) or `finish_refused` (the
 * release was no longer building when the worker finished it, for example failed as stale).
 */
class BuildFailure extends Error {
  constructor(
    readonly step: string,
    readonly cause: unknown,
    readonly code: 'build_failed' | 'pointer_refused' | 'finish_refused' = 'build_failed',
  ) {
    super(`${step}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

/** A forward-only check refused the pointer write (decision 37.1). */
const refused = (step: string, reason: string) => new BuildFailure(step, new Error(reason), 'pointer_refused');

type PointerCheck = { building: boolean; latest_delivered: number | null };

/**
 * Builds and delivers the tenant's next release (§7.1). Returns `busy` when the tenant already has
 * a building release. Never throws once the release has begun: a failure marks it failed (with the
 * step and whether the pointer was written) and raises an alert.
 */
export async function buildRelease(tenantId: string, options: BuildOptions = {}): Promise<BuildResult> {
  const db = options.db ?? createAdminClient();
  const storage = options.storage ?? supabaseReleaseStorage(db);
  // Read before beginning: an unset project URL throws here, never resolving every image to null.
  // The project's own URL also decides whether media may be delivered over http: only on a local
  // stack (enhancement A4). An injected mediaUrl is https only.
  const projectUrl = options.mediaUrl === undefined ? supabaseUrl() : null;
  const mediaUrl = options.mediaUrl ?? mediaUrlOf(projectUrl as string);
  const media = { url: mediaUrl, localOrigin: projectUrl === null ? null : localStackOrigin(projectUrl) };
  const now = options.now ?? (() => new Date());
  const clock = options.clock ?? (() => performance.now());

  // Step 1. A row of nulls when another build is running (decision 35).
  const begun = await callRpc<ReleaseRow | null>(db, 'worker_begin_release', { p_tenant_id: tenantId });
  if (begun?.id == null || begun.number == null) return { status: 'busy', omitted: [] };
  const begunAt = clock();
  const releaseId = begun.id;
  const number = begun.number;

  let pointerWritten: boolean | null = false;
  let omitted: OmittedEntry[] = [];
  let fallback: FallbackEntry[] = [];
  let previousBundle: Bundle | null = null;
  let step = 'previous_release';
  const at = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    step = name;
    try {
      return await fn();
    } catch (error) {
      throw error instanceof BuildFailure ? error : new BuildFailure(name, error);
    }
  };

  try {
    // Right after beginning: the previous release and its bundle (decision 35).
    const previous = await at('previous_release', () => callRpc<ReleaseRow | null>(db, 'worker_previous_release', { p_tenant_id: tenantId }));
    if (previous?.id != null) {
      previousBundle = await at('previous_bundle', async () => {
        if (!previous.bundle_path) throw new Error(`delivered release ${previous.number} has no bundle path`);
        const bundle = parseJson<Bundle>(await storage.download(DELIVERY, previous.bundle_path));
        if (bundle.format !== 1 || bundle.release !== previous.number) throw new Error(`bundle ${previous.bundle_path} is not release ${previous.number}`);
        return bundle;
      });
    }

    // Step 2. One snapshot of everything the build reads.
    const snapshot = await at('snapshot', () => callRpc<Snapshot>(db, 'worker_release_snapshot', { p_release_id: releaseId }));
    const slug = snapshot.tenant.slug;
    if (snapshot.release.id !== releaseId || snapshot.tenant.id !== tenantId) throw new BuildFailure('snapshot', new Error('snapshot of another release'));
    if (previousBundle !== null && previousBundle.tenant !== slug) throw new BuildFailure('previous_bundle', new Error('previous bundle of another tenant'));
    const module = getModule(slug);
    if (!module) throw new BuildFailure('module', new Error(`no module for tenant ${slug}`));

    // Step 3. Project; reuse or leave out what fails (two passes or more, until nothing changes).
    const projected = await at('project', async () => projectAll(snapshot, module, tenantId, media, previousBundle));
    omitted = projected.omitted;
    fallback = projected.fallback;
    const generatedAt = now().toISOString();
    const bundle: Bundle = { format: 1, tenant: slug, release: number, generatedAt, entries: projected.entries };
    // A7, §7.4: the linked entries no page is checked for, decided from the targets the delivery
    // checks, before anything is written.
    const requests = snapshot.requests.map((r) => ({ id: r.id, entryId: r.entry_id, action: r.action, wasDelivered: r.was_delivered }));
    const nothingChecked = liveTargets(module, { bundle, previousBundle, requests }, mediaUrl(''))
      .filter((t) => t.nothingChecked)
      .map((t) => ({ entryId: t.entryId }));

    // Step 4. Record every public object before writing it (M3-06, §7.2): the bundle path is fixed
    // by the release row; the media is every asset the included entries reference. Then copy what
    // is not public yet.
    const toCopy = await at('record_media', () => recordMedia(db, releaseId, projected.referencedAssets, options.sleep ?? sleep));
    const publicAssets = await at('copy_media', async () => {
      const copied: Array<{ id: string; public_path: string }> = [];
      for (const a of toCopy) {
        const to = publicMediaPath(slug, a.id, a.filename);
        await storage.copy({ bucket: MEDIA_PRIVATE, path: a.original_path }, { bucket: MEDIA_PUBLIC, path: to });
        copied.push({ id: a.id, public_path: to });
      }
      return copied;
    });

    // Steps 5–6. Write the bundle, read it back, compare bytes.
    const bundlePath = deliveryBundlePath(slug, number);
    const bundleBytes = new TextEncoder().encode(JSON.stringify(bundle));
    await at('bundle_upload', () =>
      storage.upload(DELIVERY, bundlePath, bundleBytes, { cacheControl: BUNDLE_CACHE_CONTROL, contentType: 'application/json', upsert: false }),
    );
    await at('bundle_verify', async () => {
      if (!sameBytes(await storage.download(DELIVERY, bundlePath), bundleBytes)) throw new Error('the bundle read back differs');
    });

    // The pointer only moves forward (decision 37.1): (c), then (b), then (a), closest to the write.
    const pointer: Pointer = { format: 1, tenant: slug, release: number, bundle: pointerBundlePath(number), generatedAt };
    const pointerPath = deliveryPointerPath(slug);
    const readPointer = async () => parseJson<Pointer>(await storage.download(DELIVERY, pointerPath));
    await at('pointer_current', async () => {
      // A tenant with no delivered release may have no pointer yet; otherwise it must be readable.
      const current = await readPointer().catch((error: unknown) => {
        if (previous?.id == null) return null;
        throw error;
      });
      if (current === null) return;
      if (current.format !== 1 || current.tenant !== slug || !Number.isSafeInteger(current.release)) {
        throw refused('pointer_current', 'the current pointer is not a pointer of this tenant');
      }
      if (current.release >= number) throw refused('pointer_current', `the current pointer already names release ${current.release}`);
    });
    await at('pointer_check', async () => {
      const [state] = (await callRpc<PointerCheck[] | null>(db, 'worker_pointer_check', { p_release_id: releaseId })) ?? [];
      if (!state) throw new Error('worker_pointer_check returned no row');
      if (!state.building) throw refused('pointer_check', 'the release is no longer building');
      if (state.latest_delivered !== null && state.latest_delivered >= number) {
        throw refused('pointer_check', `release ${state.latest_delivered} is already delivered`);
      }
    });
    const elapsed = clock() - begunAt;
    // Deliberately outside `at()`: `refused` already is a BuildFailure carrying its own step
    // ('pointer_deadline') and the `pointer_refused` reason, and wrapping would only rewrite `step`.
    if (elapsed >= POINTER_DEADLINE_MS) {
      throw refused('pointer_deadline', `${Math.round(elapsed)} ms since the release began (limit ${POINTER_DEADLINE_MS} ms)`);
    }

    // Steps 7–8. Write the pointer, read it back, check the release.
    await at('pointer_upload', async () => {
      const upload = await writePointer(storage, pointerPath, pointer, readPointer);
      pointerWritten = upload.written;
      if (!upload.ok) throw upload.error;
    });
    const pointerWrittenAt = now().getTime();
    await at('pointer_verify', async () => {
      const p = await readPointer();
      if (p.release !== number || p.bundle !== pointer.bundle) throw new Error(`the pointer reads back release ${String(p.release)}`);
    });

    // Step 9. Delivered: every request of the snapshot is linked; failed entries are the release's error,
    // with the entries no page is checked for (A7, §7.4: never shown live).
    // forbidden: the release is no longer building (the sweep failed it as stale); it stays failed.
    const stored = storedOmissions(omitted);
    const storedFallback = storedOmissions(fallback);
    const entryErrors = {
      ...(stored.length > 0 ? { omitted: stored } : {}),
      ...(storedFallback.length > 0 ? { fallback: storedFallback } : {}),
      ...(nothingChecked.length > 0 ? { nothingChecked } : {}),
    };
    await at('finish', () =>
      callRpc(db, 'worker_finish_release', {
        p_release_id: releaseId,
        p_status: 'delivered',
        p_bundle_path: bundlePath,
        p_error: Object.keys(entryErrors).length > 0 ? entryErrors : null,
        p_request_ids: snapshot.requests.map((r) => r.id),
        p_public_assets: publicAssets,
      }).catch((error: unknown) => {
        throw isApiError(error, 'forbidden') ? new BuildFailure('finish', error, 'finish_refused') : error;
      }),
    );

    // Step 10. Failed entries are visible and alerted ("Withdrawal and failure visibility"; §7.1).
    if (omitted.length > 0) await alert('release.entry_omitted', { tenantId, releaseId, number, omitted: stored });
    if (fallback.length > 0) await alert('release.entry_fallback', { tenantId, releaseId, number, fallback: storedFallback });
    return {
      status: 'delivered',
      releaseId,
      number,
      omitted,
      ...(fallback.length > 0 ? { fallback } : {}),
      bundle,
      previousBundle,
      requests,
      pointerWrittenAt,
    };
  } catch (error) {
    const failure = error instanceof BuildFailure ? error : new BuildFailure(step, error);
    const stored = storedOmissions(omitted);
    const storedFallback = storedOmissions(fallback);
    const recorded = {
      code: failure.code,
      step: failure.step,
      message: failure.message,
      pointerWritten,
      ...(stored.length > 0 ? { omitted: stored } : {}),
      ...(storedFallback.length > 0 ? { fallback: storedFallback } : {}),
    };
    // A refused finish means the release is no longer building: finishing it again would be
    // refused too, and its recorded error (stale_building) stays. A pointer already written is left
    // as it is (decision 37.1 (d)): never written back to an older release.
    if (failure.code !== 'finish_refused') {
      try {
        // A failed release links no requests and no assets: they wait for the next build.
        await callRpc(db, 'worker_finish_release', {
          p_release_id: releaseId,
          p_status: 'failed',
          p_bundle_path: null,
          p_error: recorded,
          p_request_ids: null,
          p_public_assets: null,
        });
      } catch (finishError) {
        console.error(`[cms-worker] release ${releaseId} could not be marked failed`, finishError);
      }
    }
    const event = failure.code === 'finish_refused' ? 'release.finish_refused' : 'release.failed';
    await alert(event, { tenantId, releaseId, number, code: failure.code, step: failure.step, message: failure.message, pointerWritten });
    await alertIfBuildRetriesExhausted(db, { tenantId, releaseId, number });
    return { status: 'failed', releaseId, number, omitted, previousBundle };
  }
}

/** A row of api.worker_record_release_media (M3-06). */
type RecordedMedia = { asset_id: string; copy: boolean; deleting: boolean };

/**
 * Records the release's media (api.worker_record_release_media) and returns the assets to copy:
 * those with no public object the database knows of. While a sweep is deleting any of them, waits
 * and records again (the sweep's deletion must finish before the copy, or it would remove the
 * copy); still deleting after RECORD_MEDIA_ATTEMPTS records is an error (the build fails).
 */
async function recordMedia(
  db: SupabaseClient,
  releaseId: string,
  assets: SnapshotAsset[],
  wait: (ms: number) => Promise<void>,
): Promise<SnapshotAsset[]> {
  const byId = new Map(assets.map((a) => [a.id, a]));
  for (let attempt = 1; ; attempt++) {
    const rows =
      (await callRpc<RecordedMedia[] | null>(db, 'worker_record_release_media', { p_release_id: releaseId, p_asset_ids: [...byId.keys()] })) ?? [];
    if (rows.length !== byId.size || rows.some((r) => !byId.has(r.asset_id))) throw new Error('worker_record_release_media returned other assets');
    const deleting = rows.filter((r) => r.deleting).length;
    if (deleting === 0) return rows.filter((r) => r.copy).map((r) => byId.get(r.asset_id)!);
    if (attempt >= RECORD_MEDIA_ATTEMPTS) throw new Error(`a sweep is still deleting ${deleting} of the release's media`);
    await wait(RECORD_MEDIA_WAIT_MS);
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A row of api.worker_release_retry (M3-02). */
type ReleaseRetry = { status: string; next_attempt_at: string | null; retries_exhausted: boolean };

/**
 * After a release failed (here, or as stale in the sweep): when the database has scheduled no next
 * build for the tenant, 24 hours have passed since the first failed build of the run and the
 * platform admin is alerted (`release.retries_exhausted`, §7.4, §8.4). The sweep builds the tenant
 * again only for a request made after that build began (M3-02). Never throws: a failing read is
 * logged, as the failure itself was already alerted.
 */
export async function alertIfBuildRetriesExhausted(
  db: SupabaseClient,
  release: { tenantId: string; releaseId: string; number: number },
): Promise<void> {
  try {
    const [retry] = (await callRpc<ReleaseRetry[] | null>(db, 'worker_release_retry', { p_release_id: release.releaseId })) ?? [];
    if (retry?.retries_exhausted) await alert('release.retries_exhausted', { ...release });
  } catch (error) {
    console.error(`[cms-worker] the build retry of release ${release.releaseId} could not be read`, error);
  }
}

/** The project's public media URL of a `media-public` path. */
const mediaUrlOf = (base: string) => (path: string) => publicMediaUrl(base, path);

/**
 * Writes the pointer. `written` is whether it was: when the upload fails, a read-back decides (the
 * upload may have failed after the object was stored): true when the pointer names this release,
 * false when it names another, null when it cannot be read.
 */
async function writePointer(
  storage: ReleaseStorage,
  path: string,
  pointer: Pointer,
  readPointer: () => Promise<Pointer>,
): Promise<{ ok: true; written: true } | { ok: false; written: boolean | null; error: unknown }> {
  try {
    await storage.upload(DELIVERY, path, new TextEncoder().encode(JSON.stringify(pointer)), {
      cacheControl: POINTER_CACHE_CONTROL,
      contentType: 'application/json',
      upsert: true,
    });
    return { ok: true, written: true };
  } catch (error) {
    const written = await readPointer().then(
      (p) => p.release === pointer.release,
      () => null,
    );
    return { ok: false, written, error };
  }
}

/** Failed entries as stored and alerted: every entry, with the details of the first ones only. */
function storedOmissions<T extends OmittedEntry>(omitted: T[]): T[] {
  return omitted.map((o, i) => (i < MAX_STORED_OMISSION_DETAILS ? o : { ...o, error: { code: codeOf(o.error) } }));
}

const codeOf = (error: unknown): unknown => (error !== null && typeof error === 'object' && 'code' in error ? error.code : 'unknown');

type Projected = {
  entries: Record<string, BundleEntry[]>;
  omitted: OmittedEntry[];
  fallback: FallbackEntry[];
  /** Every resolvable asset the release's entries reference: recorded, and copied unless public. */
  referencedAssets: SnapshotAsset[];
};

/**
 * Projects every entry of the snapshot, each upcast to its type's current schema version first.
 * Entries that cannot be built fail before projection (unknown type, a revision that cannot be
 * upcast, an asset whose path is not valid) or in it (any error). A failed entry reuses its record
 * from the previous release when §7.1's two conditions hold: (1) that record was built from the
 * revision published now, and (2) everything the revision references is still allowed: each asset
 * is resolvable (not archived, valid paths) and each referenced entry is in this release.
 * Otherwise it is left out. The context resolves only the entries in the release, so the
 * projection repeats until a pass fails nothing more: the final records never reference a
 * left-out entry.
 */
function projectAll(
  snapshot: Snapshot,
  module: ModuleManifest,
  tenantId: string,
  media: { url: (p: string) => string; localOrigin: string | null },
  previousBundle: Bundle | null,
): Projected {
  const slug = snapshot.tenant.slug;
  const errors = new Map<string, unknown>();

  // Assets that may be resolved: not archived, with valid private and public paths.
  const assetsById = new Map(snapshot.assets.map((a) => [a.id, a]));
  const validAsset = (a: SnapshotAsset): boolean => {
    try {
      if (a.original_path !== privateMediaPath(tenantId, a.id, a.filename)) return false;
      // Builds the public path only for its validation (slug, asset id, filename): it throws if invalid.
      publicMediaPath(slug, a.id, a.filename);
      return true;
    } catch {
      return false;
    }
  };
  const contextAssets: ContextAsset[] = snapshot.assets
    .filter((a) => !a.archived && validAsset(a))
    .map((a) => ({ ...a, public_path: a.public_path ?? publicMediaPath(slug, a.id, a.filename) }));
  const allowedAssets = new Set(contextAssets.map((a) => a.id));

  const types = new Map<string, ContentType>(module.types.map((t) => [t.name, t]));
  // §5.3, §7.1: each revision's data at its type's current schema version, upcast in memory. The
  // stored revision is never rewritten; `upcast` copies before any transform runs.
  const current = new Map<string, unknown>();
  for (const e of snapshot.entries) {
    const type = types.get(e.type);
    if (!type) {
      errors.set(e.entry_id, { code: 'unknown_type', type: e.type });
      continue;
    }
    const upcast = upcastRevision(e, type);
    if ('error' in upcast) {
      errors.set(e.entry_id, upcast.error);
      continue;
    }
    current.set(e.entry_id, upcast.data);
    const bad = e.refs.find((r) => {
      const a = r.kind === 'asset' ? assetsById.get(r.id) : undefined;
      return a !== undefined && !a.archived && !validAsset(a);
    });
    if (bad) errors.set(e.entry_id, { code: 'asset_path_invalid', assetId: bad.id });
  }

  // §7.1 condition 1: the previous record of the same entry and type, built from the same revision.
  const previousRecords = new Map<string, BundleEntry>();
  for (const [type, list] of Object.entries(previousBundle?.entries ?? {})) {
    for (const p of list) previousRecords.set(`${type}/${p.id}`, p);
  }
  const sameRevision = (e: SnapshotEntry): BundleEntry | undefined => {
    const p = previousRecords.get(`${e.type}/${e.entry_id}`);
    return p !== undefined && p.revisionId === e.revision_id ? p : undefined;
  };
  const snapshotIds = new Set(snapshot.entries.map((e) => e.entry_id));
  // §7.1 condition 2, decided as the largest set of failed entries whose references are all
  // allowed when exactly the entries that did not fail and that set are in the release.
  const chooseFallbacks = (): Map<string, BundleEntry> => {
    const reused = new Map<string, BundleEntry>();
    for (const e of snapshot.entries) {
      const p = errors.has(e.entry_id) ? sameRevision(e) : undefined;
      if (p) reused.set(e.entry_id, p);
    }
    for (let dropped = true; dropped; ) {
      dropped = false;
      const inRelease = (id: string) => !errors.has(id) || reused.has(id);
      for (const e of snapshot.entries) {
        if (!reused.has(e.entry_id)) continue;
        const allowed = e.refs.every((r) => (r.kind === 'asset' ? allowedAssets.has(r.id) : snapshotIds.has(r.id) && inRelease(r.id)));
        if (!allowed) {
          reused.delete(e.entry_id);
          dropped = true;
        }
      }
    }
    return reused;
  };

  let built = new Map<string, BundleEntry>();
  let reused = new Map<string, BundleEntry>();
  for (;;) {
    reused = chooseFallbacks();
    const included = snapshot.entries.filter((e) => !errors.has(e.entry_id) || reused.has(e.entry_id));
    const ctx = buildProjectionContext({
      module,
      entries: included.map(
        (e): ContextEntry => ({ id: e.entry_id, type: e.type, slug: e.slug, title: e.title, sortAt: isoOrNull(e.sort_at) }),
      ),
      assets: contextAssets,
      mediaUrl: media.url,
      localMediaOrigin: media.localOrigin,
    });
    built = new Map();
    let failed = false;
    for (const e of included) {
      if (errors.has(e.entry_id)) continue;
      try {
        built.set(e.entry_id, bundleEntry(e, current.get(e.entry_id), types.get(e.type)!, ctx));
      } catch (error) {
        errors.set(e.entry_id, projectionError(error));
        failed = true;
      }
    }
    if (!failed) break;
  }

  const entries: Record<string, BundleEntry[]> = {};
  const referenced = new Set<string>();
  for (const e of snapshot.entries) {
    const b = built.get(e.entry_id) ?? reused.get(e.entry_id);
    if (!b) continue;
    (entries[e.type] ??= []).push(b);
    for (const r of e.refs) if (r.kind === 'asset') referenced.add(r.id);
  }
  sortManuallyOrdered(entries, snapshot.entries, types);
  const failedEntry = (e: SnapshotEntry): OmittedEntry => ({
    entryId: e.entry_id,
    requestIds: snapshot.requests.filter((r) => r.entry_id === e.entry_id).map((r) => r.id),
    error: errors.get(e.entry_id),
  });
  const failedEntries = snapshot.entries.filter((e) => errors.has(e.entry_id));
  const omitted = failedEntries.filter((e) => !reused.has(e.entry_id)).map(failedEntry);
  const fallback = failedEntries
    .filter((e) => reused.has(e.entry_id))
    .map((e): FallbackEntry => ({ ...failedEntry(e), fromRelease: previousBundle!.release }));
  const referencedAssets = snapshot.assets.filter((a) => referenced.has(a.id) && !a.archived && validAsset(a));
  return { entries, omitted, fallback, referencedAssets };
}

/**
 * Each type's entries are in the snapshot's order (by entry id), except that a manually ordered
 * type's are sorted by the snapshot's `order_rank`, the editors' order (A12; §5.1, §7.2: the order
 * is the list's, never a field of the record). The sort is stable, so entries without a rank (a
 * database before A12) keep the snapshot's order.
 */
function sortManuallyOrdered(entries: Record<string, BundleEntry[]>, list: SnapshotEntry[], types: Map<string, ContentType>): void {
  const ranks = new Map(list.map((e) => [e.entry_id, e.order_rank]));
  const rank = (id: string) => {
    const r = ranks.get(id);
    return typeof r === 'number' && Number.isFinite(r) ? r : Number.MAX_SAFE_INTEGER;
  };
  for (const [name, records] of Object.entries(entries)) {
    const type = types.get(name);
    if (type !== undefined && isManuallyOrdered(type)) records.sort((a, b) => rank(a.id) - rank(b.id));
  }
}

/**
 * A revision's data at its type's current version (§5.3), or the omission error when it cannot be
 * upcast: written at a version newer than the deployed type, a gap in the transforms, or a failing
 * transform (`upcast` wraps whatever a transform throws). Any other error (copying the document)
 * also only omits the entry: one failing entry does not block the tenant (§7.1).
 */
function upcastRevision(e: SnapshotEntry, type: ContentType): { data: unknown } | { error: Record<string, unknown> } {
  try {
    return { data: type.upcast(e.data, e.schema_version) };
  } catch (error) {
    if (!(error instanceof UpcastError)) {
      return { error: { code: 'upcast_failed', reason: 'unexpected', revisionSchemaVersion: e.schema_version, currentSchemaVersion: type.version } };
    }
    return {
      error: {
        code: 'upcast_failed',
        reason: error.code,
        revisionSchemaVersion: e.schema_version,
        currentSchemaVersion: type.version,
        ...(error.atVersion === undefined ? {} : { atVersion: error.atVersion }),
      },
    };
  }
}

/**
 * The §7.2 record of one entry from its upcast data; projection only through `projectEntry` (its
 * strict validation and depth cap apply). `schemaVersion` is the version the data now has.
 */
function bundleEntry(e: SnapshotEntry, data: unknown, type: ContentType, ctx: ReturnType<typeof buildProjectionContext>): BundleEntry {
  const projected = projectEntry(type, data, ctx);
  const record = {
    id: e.entry_id,
    revisionId: e.revision_id,
    slug: e.slug,
    title: e.title,
    sortAt: isoOrNull(e.sort_at),
    firstPublishedAt: iso(e.first_published_at),
    lastPublishedAt: iso(e.last_published_at),
    schemaVersion: type.version,
    data: projected,
  };
  const { id, revisionId, ...rest } = record;
  // §7.2's field order: contentHash after revisionId.
  return { id, revisionId, contentHash: entryContentHash(record), ...rest };
}

function projectionError(error: unknown): unknown {
  if (error instanceof ProjectionError) {
    return {
      code: 'projection_failed',
      issues: error.issues.slice(0, 20).map((i) => ({ code: i.code, path: i.path.map((p) => (typeof p === 'symbol' ? String(p) : p)), message: i.message })),
    };
  }
  if (error instanceof RangeError) return { code: 'too_deep' };
  return { code: 'projection_error', message: error instanceof Error ? error.message : String(error) };
}

/** A database timestamp as an ISO string (UTC, milliseconds). */
function iso(s: string): string {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error(`not a timestamp: ${s}`);
  return d.toISOString();
}

/** A nullable database timestamp (sort_at) as an ISO string or null. */
function isoOrNull(s: string | null): string | null {
  return s === null ? null : iso(s);
}

function parseJson<T>(bytes: Uint8Array): T {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Storage through the admin client (service_role bypasses Storage RLS; §5.6: worker only). */
export function supabaseReleaseStorage(db: Pick<SupabaseClient, 'storage'>): ReleaseStorage {
  return {
    async upload(bucket, path, body, o) {
      // storage-js sends `cache-control: max-age=<cacheControl>`; the header option replaces it with
      // the complete value (§7.2).
      const { error } = await db.storage
        .from(bucket)
        .upload(path, body, { contentType: o.contentType, upsert: o.upsert, headers: { 'cache-control': o.cacheControl } });
      if (error) throw error;
    },
    async download(bucket, path) {
      const { data, error } = await db.storage.from(bucket).download(path);
      if (error || !data) throw error ?? new Error(`no data for ${bucket}/${path}`);
      return new Uint8Array(await data.arrayBuffer());
    },
    async copy(from, to) {
      const { error } = await db.storage.from(from.bucket).copy(from.path, to.path, { destinationBucket: to.bucket });
      if (!error) return 'copied';
      if (isAlreadyExists(error)) return 'exists';
      throw error;
    },
  };
}

function isAlreadyExists(error: unknown): boolean {
  const e = error as { statusCode?: unknown; status?: unknown; message?: unknown };
  return String(e.statusCode) === '409' || e.status === 409;
}
