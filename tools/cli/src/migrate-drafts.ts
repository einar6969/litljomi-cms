// `migrate-drafts`: brings every draft of a tenant's type to the type's current schema version
// (spec §5.3, "On deploy, a migration script applies transforms to all drafts of that type, each as
// a normal versioned draft update"; plan M2-13). Run by Einar only, against staging with his
// approval (plan M2 "Local acceptance" step 6); the tests run it against the local stack.
//
// For each draft written below the current version, in entry id order:
// - upcast in memory through the type's transforms (`ContentType.upcast`), then checked and stripped
//   of unknown keys by the type's draft validator, and `title`/`sort_at` taken from the type, as the
//   editor's autosave does (apps/cms saveDraftAction);
// - saved with api.admin_migrate_draft, which changes the draft only if it is still at the version
//   and schema version that were read. A draft changed meanwhile is re-read and tried once more
//   (skipped if it is now current); a second conflict is reported, and nothing of it is changed.
// A second run finds nothing to do (idempotent). Revisions are never read or written: the release
// build upcasts them when reading (M2-05).
//
// It reads its key as `provision` and `boundary-check` do (./hosted.ts): the env file is read as
// text with the runbook's `env_value` rules, the URL must be https://<--expect-ref>.supabase.co,
// requests go only to that origin with the key in headers, and server errors are reduced to status,
// code and message with the key redacted. Output is entry ids, versions and counts, never draft data.
import type { ContentType, ModuleManifest } from '@litljomi/cms-schema';
import { UpcastError } from '@litljomi/cms-schema';
import {
  Failure,
  UUID_RE,
  UsageError,
  guardedFetch,
  parseArgs,
  readTarget,
  redactAll,
  requiredFlag as required,
  type ArgSpec,
  type FetchFn,
  type Target,
} from './hosted.ts';

export interface MigrateDraftsDeps {
  fetch: FetchFn;
  /** The env file's text. */
  readTextFile: (path: string) => Promise<string>;
  /** The tenant's module manifest (cli.ts imports `@litljomi/module-<slug>`). */
  loadModule: (slug: string) => Promise<ModuleManifest>;
}

export interface MigrateDraftsIo {
  log: (line: string) => void;
  error: (line: string) => void;
}

export const MIGRATE_DRAFTS_USAGE =
  'usage: migrate-drafts --tenant <slug> --type <name> --expect-ref <ref> [--env-file=<absolute path>]';

const SPEC: ArgSpec = { positionals: 0, flags: ['--tenant', '--type'] };
// cms.tenants' slug constraint, which is also the module package's name.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TYPE_RE = /^[A-Za-z][A-Za-z0-9_-]{0,99}$/;
/** Drafts read per request; well under PostgREST's max_rows (1000). */
export const PAGE_SIZE = 100;

interface OutdatedDraft {
  entry_id: string;
  version: number;
  schema_version: number;
  data: unknown;
}

type ApiResult = { ok: true; body: unknown } | { ok: false; detail: string; message: string | undefined };

class Api {
  constructor(
    private readonly target: Target,
    private readonly fetchFn: FetchFn,
    private readonly secrets: readonly string[],
  ) {}

  async rpc(name: string, args: Record<string, unknown>): Promise<ApiResult> {
    const result = await guardedFetch(this.fetchFn, this.target.origin, this.secrets, {
      method: 'POST',
      path: `/rest/v1/rpc/${name}`,
      headers: {
        apikey: this.target.key,
        Authorization: `Bearer ${this.target.key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Content-Profile': 'api',
      },
      body: JSON.stringify(args),
    });
    if (result.kind === 'network') return { ok: false, detail: result.detail, message: undefined };
    if (result.ok) return { ok: true, body: result.body };
    return { ok: false, detail: result.detail, message: result.message };
  }
}

const isDraftRow = (x: unknown): x is OutdatedDraft => {
  const r = x as Partial<OutdatedDraft> | null;
  return (
    r !== null &&
    typeof r === 'object' &&
    typeof r.entry_id === 'string' &&
    UUID_RE.test(r.entry_id) &&
    Number.isSafeInteger(r.version) &&
    Number.isSafeInteger(r.schema_version) &&
    typeof r.data === 'object' &&
    r.data !== null
  );
};

interface Context {
  api: Api;
  tenant: string;
  type: ContentType;
  log: (line: string) => void;
  error: (line: string) => void;
}

async function outdated(ctx: Context, after: string | null, entryId: string | null = null): Promise<OutdatedDraft[]> {
  const result = await ctx.api.rpc('admin_outdated_drafts', {
    p_tenant_slug: ctx.tenant,
    p_type: ctx.type.name,
    p_current_version: ctx.type.version,
    p_after: after,
    p_limit: PAGE_SIZE,
    p_entry_id: entryId,
  });
  if (!result.ok) {
    if (result.message === 'not_found') throw new Failure(`FAILED: tenant ${ctx.tenant} does not exist on the target (not_found); nothing was changed`);
    throw new Failure(`FAILED: reading outdated drafts: ${result.detail}`);
  }
  if (!Array.isArray(result.body) || !result.body.every(isDraftRow)) throw new Failure('FAILED: unexpected response from admin_outdated_drafts');
  return result.body;
}

type Outcome = 'migrated' | 'current' | 'reported';

/** The draft at the current version, as autosave would save it, or the reason it cannot be. */
function prepare(type: ContentType, draft: OutdatedDraft): { ok: true; data: unknown } | { ok: false; reason: string } {
  let upcast: unknown;
  try {
    upcast = type.upcast(draft.data, draft.schema_version);
  } catch (e) {
    if (e instanceof UpcastError) return { ok: false, reason: `cannot upcast (${e.code}${e.atVersion === undefined ? '' : ` at ${e.atVersion}`})` };
    throw e;
  }
  const parsed = type.draftValidator().safeParse(upcast);
  if (!parsed.success) {
    // Field paths only: a message could repeat draft content.
    const paths = [...new Set(parsed.error.issues.map((i) => i.path.join('.') || '(root)'))].join(', ');
    return { ok: false, reason: `invalid after upcast (${paths})` };
  }
  return { ok: true, data: parsed.data };
}

async function migrateOne(ctx: Context, first: OutdatedDraft): Promise<Outcome> {
  let draft = first;
  for (let attempt = 1; ; attempt++) {
    const prepared = prepare(ctx.type, draft);
    if (!prepared.ok) {
      ctx.error(`REPORTED ${draft.entry_id}: ${prepared.reason}; draft left at schema version ${draft.schema_version}`);
      return 'reported';
    }
    const { title, sortAt } = ctx.type.queryColumns(prepared.data);
    const saved = await ctx.api.rpc('admin_migrate_draft', {
      p_entry_id: draft.entry_id,
      p_expected_version: draft.version,
      p_from_schema_version: draft.schema_version,
      p_data: prepared.data,
      p_schema_version: ctx.type.version,
      p_title: title,
      p_sort_at: sortAt,
    });
    if (saved.ok) {
      if (!Number.isSafeInteger(saved.body)) throw new Failure('FAILED: unexpected response from admin_migrate_draft');
      ctx.log(
        `migrated ${draft.entry_id}: schema version ${draft.schema_version} -> ${ctx.type.version}, draft version ${draft.version} -> ${String(saved.body)}`,
      );
      return 'migrated';
    }
    if (saved.message === 'not_found') {
      ctx.error(`REPORTED ${draft.entry_id}: the draft no longer exists (not_found)`);
      return 'reported';
    }
    if (saved.message !== 'version_conflict') throw new Failure(`FAILED: saving draft ${draft.entry_id}: ${saved.detail}`);
    if (attempt === 2) {
      ctx.error(`REPORTED ${draft.entry_id}: changed during the migration twice (version_conflict); draft left as it is`);
      return 'reported';
    }
    // Changed since it was read: read it again and try once more, unless it is now current.
    const [again] = await outdated(ctx, null, draft.entry_id);
    if (again === undefined) {
      ctx.log(`current ${draft.entry_id}: saved at the current schema version meanwhile`);
      return 'current';
    }
    ctx.log(`retrying ${draft.entry_id}: changed since it was read (draft version ${draft.version} -> ${again.version})`);
    draft = again;
  }
}

async function migrate(ctx: Context): Promise<number> {
  const counts: Record<Outcome, number> = { migrated: 0, current: 0, reported: 0 };
  let after: string | null = null;
  for (;;) {
    const page = await outdated(ctx, after);
    for (const draft of page) counts[await migrateOne(ctx, draft)] += 1;
    if (page.length < PAGE_SIZE) break;
    after = page[page.length - 1]!.entry_id;
  }
  ctx.log(
    `${ctx.tenant}/${ctx.type.name} at schema version ${ctx.type.version}: ${counts.migrated} migrated, ` +
      `${counts.current} already current, ${counts.reported} reported`,
  );
  return counts.reported === 0 ? 0 : 1;
}

/** Runs `migrate-drafts ...`; returns the exit code (0 ok, 1 refused, failed or a draft reported, 2 usage). */
export async function runMigrateDrafts(args: string[], io: MigrateDraftsIo, deps: MigrateDraftsDeps): Promise<number> {
  const secrets: string[] = [];
  const log = (line: string) => io.log(redactAll(line, secrets));
  const error = (line: string) => io.error(redactAll(line, secrets));

  let tenant: string;
  let typeName: string;
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs(args, SPEC);
    tenant = required(parsed, '--tenant', SLUG_RE);
    typeName = required(parsed, '--type', TYPE_RE);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    error(`migrate-drafts: ${e.message}`);
    error(MIGRATE_DRAFTS_USAGE);
    return 2;
  }

  try {
    let manifest: ModuleManifest;
    try {
      manifest = await deps.loadModule(tenant);
    } catch {
      throw new Failure(`FAILED: no module for tenant ${tenant}; nothing was sent`);
    }
    if (manifest.tenant !== tenant) throw new Failure(`FAILED: the module loaded for ${tenant} is not that tenant's; nothing was sent`);
    const type = manifest.types.find((t) => t.name === typeName);
    if (type === undefined) throw new Failure(`FAILED: tenant ${tenant} has no type ${typeName}; nothing was sent`);

    const target = await readTarget(parsed, deps.readTextFile);
    secrets.push(target.key);
    log(`target: ${target.origin.slice('https://'.length)}`);
    return await migrate({ api: new Api(target, deps.fetch, secrets), tenant, type, log, error });
  } catch (e) {
    // Our own refusals are printed; anything else only by its kind, never its text.
    error(e instanceof Failure ? e.message : `FAILED: unexpected error (${e instanceof Error ? e.name : 'unknown'})`);
    return 1;
  }
}
