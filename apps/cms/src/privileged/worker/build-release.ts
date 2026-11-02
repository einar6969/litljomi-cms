// Worker step 2: build and deliver a tenant's release (spec §5.6, §7.1, §7.2; plan Task 20,
// decisions 10, 34 and 35; "Withdrawal and failure visibility").
//
// The bundle holds every entry the database says is published and not archived in one snapshot
// (withdrawal always wins), projected from its published revision. An entry that cannot be
// projected is left out (fail closed; the fallback rule is M3), recorded in releases.error and
// alerted, and resolves to null for every other entry. The switch is atomic: the bundle is written
// and read back, then the pointer is written and read back; any failure up to and including that
// read-back marks the release failed, and the pointer never names a bundle that was not verified.
import {
  ProjectionError,
  entryContentHash,
  projectEntry,
  type ContentType,
  type ModuleManifest,
} from '@litljomi/cms-schema';
import type { Bundle, BundleEntry, Pointer } from '@litljomi/cms-sdk';
import { getModule } from '@/modules/registry';
import type { SupabaseClient } from '../../lib/supabase/types';
import { createAdminClient } from '../admin-client';
import { alert } from './alerts';
import { buildProjectionContext, publicMediaUrl, type ContextAsset, type ContextEntry } from './projection-context';
import { callRpc } from './rpc';
import {
  deliveryBundlePath,
  deliveryPointerPath,
  pointerBundlePath,
  privateMediaPath,
  publicMediaPath,
} from './storage-paths';

/** §7.2. */
export const BUNDLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
/** §7.2. */
export const POINTER_CACHE_CONTROL = 'public, max-age=30';

const DELIVERY = 'delivery';
const MEDIA_PRIVATE = 'media-private';
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

export type BuildResult = {
  status: 'delivered' | 'failed' | 'busy';
  releaseId?: string;
  number?: number;
  omitted: OmittedEntry[];
  bundle?: Bundle;
  /** The tenant's previously delivered bundle (null for the first release), for the live checks. */
  previousBundle?: Bundle | null;
};

export type BuildOptions = {
  db?: SupabaseClient;
  storage?: ReleaseStorage;
  /** The public URL of a `media-public` path; defaults to the Supabase project's public object URL. */
  mediaUrl?: (publicPath: string) => string;
  now?: () => Date;
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
  refs: Array<{ path: string; kind: 'entry' | 'asset'; id: string }>;
};
type SnapshotAsset = ContextAsset & { original_path: string; archived: boolean };
type Snapshot = {
  release: { id: string; tenant_id: string; number: number; status: string };
  tenant: { id: string; slug: string };
  entries: SnapshotEntry[];
  assets: SnapshotAsset[];
  requests: Array<{ id: string; entry_id: string; action: string; revision_id: string | null }>;
};

/** A failure at a named step of the build; `pointerWritten` is null when it cannot be known. */
class BuildFailure extends Error {
  constructor(
    readonly step: string,
    readonly cause: unknown,
  ) {
    super(`${step}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

/**
 * Builds and delivers the tenant's next release (§7.1). Returns `busy` when the tenant already has
 * a building release. Never throws once the release has begun: a failure marks it failed (with the
 * step and whether the pointer was written) and raises an alert.
 */
export async function buildRelease(tenantId: string, options: BuildOptions = {}): Promise<BuildResult> {
  const db = options.db ?? createAdminClient();
  const storage = options.storage ?? supabaseReleaseStorage(db);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const mediaUrl = options.mediaUrl ?? ((path: string) => publicMediaUrl(supabaseUrl, path));
  const now = options.now ?? (() => new Date());

  // Step 1. A row of nulls when another build is running (decision 35).
  const begun = await callRpc<ReleaseRow | null>(db, 'worker_begin_release', { p_tenant_id: tenantId });
  if (begun?.id == null || begun.number == null) return { status: 'busy', omitted: [] };
  const releaseId = begun.id;
  const number = begun.number;

  let pointerWritten: boolean | null = false;
  let omitted: OmittedEntry[] = [];
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

    // Step 3. Project; leave out what fails (two passes or more, until no omission remains).
    step = 'project';
    const projected = projectAll(snapshot, module, tenantId, mediaUrl);
    omitted = projected.omitted;
    const generatedAt = now().toISOString();
    const bundle: Bundle = { format: 1, tenant: slug, release: number, generatedAt, entries: projected.entries };

    // Step 4. Copy the media that included entries reference and that is not public yet.
    const publicAssets = await at('copy_media', async () => {
      const copied: Array<{ id: string; public_path: string }> = [];
      for (const a of projected.assetsToCopy) {
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

    // Steps 7–8. Write the pointer, read it back, check the release.
    const pointer: Pointer = { format: 1, tenant: slug, release: number, bundle: pointerBundlePath(number), generatedAt };
    const pointerPath = deliveryPointerPath(slug);
    const readPointer = async () => parseJson<Pointer>(await storage.download(DELIVERY, pointerPath));
    step = 'pointer_upload';
    try {
      await storage.upload(DELIVERY, pointerPath, new TextEncoder().encode(JSON.stringify(pointer)), {
        cacheControl: POINTER_CACHE_CONTROL,
        contentType: 'application/json',
        upsert: true,
      });
      pointerWritten = true;
    } catch (error) {
      // The upload may have failed after the object was stored: look before saying it was not.
      pointerWritten = await readPointer().then(
        (p) => p.release === number,
        () => null,
      );
      throw new BuildFailure('pointer_upload', error);
    }
    await at('pointer_verify', async () => {
      const p = await readPointer();
      if (p.release !== number || p.bundle !== pointer.bundle) throw new Error(`the pointer reads back release ${String(p.release)}`);
    });

    // Step 9. Delivered: every request of the snapshot is linked; omissions are the release's error.
    const error = omitted.length > 0 ? { omitted } : null;
    await at('finish', () =>
      callRpc(db, 'worker_finish_release', {
        p_release_id: releaseId,
        p_status: 'delivered',
        p_bundle_path: bundlePath,
        p_error: error,
        p_request_ids: snapshot.requests.map((r) => r.id),
        p_public_assets: publicAssets,
      }),
    );

    // Step 10. Left-out entries are visible and alerted ("Withdrawal and failure visibility").
    if (omitted.length > 0) await alert('release.entry_omitted', { tenantId, releaseId, number, omitted });
    return { status: 'delivered', releaseId, number, omitted, bundle, previousBundle };
  } catch (error) {
    const failure = error instanceof BuildFailure ? error : new BuildFailure(step, error);
    const recorded = {
      code: 'build_failed',
      step: failure.step,
      message: failure.message,
      pointerWritten,
      ...(omitted.length > 0 ? { omitted } : {}),
    };
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
    await alert('release.failed', { tenantId, releaseId, number, step: failure.step, message: failure.message, pointerWritten });
    return { status: 'failed', releaseId, number, omitted, previousBundle };
  }
}

type Projected = {
  entries: Record<string, BundleEntry[]>;
  omitted: OmittedEntry[];
  assetsToCopy: SnapshotAsset[];
};

/**
 * Projects every entry of the snapshot. Entries that cannot be built are left out before
 * projection (unknown type, another schema version, an asset whose path is not valid) or by it
 * (any error). The context resolves only the entries still included, so the projection repeats
 * until a pass leaves nothing more out: the final projections never reference a left-out entry.
 */
function projectAll(snapshot: Snapshot, module: ModuleManifest, tenantId: string, mediaUrl: (p: string) => string): Projected {
  const slug = snapshot.tenant.slug;
  const errors = new Map<string, unknown>();

  // Assets that may be resolved: not archived, with valid private and public paths.
  const assetsById = new Map(snapshot.assets.map((a) => [a.id, a]));
  const validAsset = (a: SnapshotAsset): boolean => {
    try {
      return a.original_path === privateMediaPath(tenantId, a.id, a.filename) && publicMediaPath(slug, a.id, a.filename) !== '';
    } catch {
      return false;
    }
  };
  const contextAssets: ContextAsset[] = snapshot.assets
    .filter((a) => !a.archived && validAsset(a))
    .map((a) => ({ ...a, public_path: a.public_path ?? publicMediaPath(slug, a.id, a.filename) }));

  const types = new Map<string, ContentType>(module.types.map((t) => [t.name, t]));
  for (const e of snapshot.entries) {
    const type = types.get(e.type);
    if (!type) errors.set(e.entry_id, { code: 'unknown_type', type: e.type });
    else if (e.schema_version !== type.version) {
      // M1 has no upcast transforms (§5.3): another schema version cannot be projected.
      errors.set(e.entry_id, { code: 'schema_version', revisionSchemaVersion: e.schema_version, currentSchemaVersion: type.version });
    } else {
      const bad = e.refs.find((r) => r.kind === 'asset' && assetsById.has(r.id) && !assetsById.get(r.id)!.archived && !validAsset(assetsById.get(r.id)!));
      if (bad) errors.set(e.entry_id, { code: 'asset_path_invalid', assetId: bad.id });
    }
  }

  let built = new Map<string, BundleEntry>();
  for (;;) {
    const included = snapshot.entries.filter((e) => !errors.has(e.entry_id));
    const ctx = buildProjectionContext({
      module,
      entries: included.map(
        (e): ContextEntry => ({ id: e.entry_id, type: e.type, slug: e.slug, title: e.title, sortAt: e.sort_at === null ? null : iso(e.sort_at) }),
      ),
      assets: contextAssets,
      mediaUrl,
    });
    built = new Map();
    let leftOut = false;
    for (const e of included) {
      try {
        built.set(e.entry_id, bundleEntry(e, types.get(e.type)!, ctx));
      } catch (error) {
        errors.set(e.entry_id, projectionError(error));
        leftOut = true;
      }
    }
    if (!leftOut) break;
  }

  const entries: Record<string, BundleEntry[]> = {};
  const referenced = new Set<string>();
  for (const e of snapshot.entries) {
    const b = built.get(e.entry_id);
    if (!b) continue;
    (entries[e.type] ??= []).push(b);
    for (const r of e.refs) if (r.kind === 'asset') referenced.add(r.id);
  }
  const omitted = snapshot.entries
    .filter((e) => errors.has(e.entry_id))
    .map((e) => ({
      entryId: e.entry_id,
      requestIds: snapshot.requests.filter((r) => r.entry_id === e.entry_id).map((r) => r.id),
      error: errors.get(e.entry_id),
    }));
  const assetsToCopy = snapshot.assets.filter((a) => referenced.has(a.id) && !a.archived && a.public_path === null && validAsset(a));
  return { entries, omitted, assetsToCopy };
}

/** The §7.2 record of one entry; projection only through `projectEntry` (its depth cap applies). */
function bundleEntry(e: SnapshotEntry, type: ContentType, ctx: ReturnType<typeof buildProjectionContext>): BundleEntry {
  const data = projectEntry(type, e.data, ctx);
  const record = {
    id: e.entry_id,
    revisionId: e.revision_id,
    slug: e.slug,
    title: e.title,
    sortAt: e.sort_at === null ? null : iso(e.sort_at),
    firstPublishedAt: iso(e.first_published_at),
    lastPublishedAt: iso(e.last_published_at),
    schemaVersion: e.schema_version,
    data,
  };
  const contentHash = entryContentHash(record);
  return { id: record.id, revisionId: record.revisionId, contentHash, ...record };
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
