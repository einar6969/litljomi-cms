// `check-schema` (`pnpm check:schema`): compares each module's content types with its committed
// schema snapshot, modules/<name>/schema.snapshot.json (spec §5.3: "CI compares each module's
// schema snapshot with the previous one and fails on a breaking change without a transform"; plan
// M2-18). The comparison rules are in @litljomi/cms-schema (snapshot.ts).
//
// Without flags it fails (exit 1) on a breaking change without a version bump and transform, on a
// field name reused with another kind, on a removed type, and on a module with no snapshot. Allowed
// changes pass and are listed, with a reminder to update the snapshot. `--update` writes the
// snapshots for intentional changes, keeping each type's retired field names; it refuses (exit 1,
// nothing written) while any module has an error, so a breaking change cannot be committed by
// updating the snapshot alone.
import { compareSchema, moduleSnapshot, updateSnapshot, type ModuleManifest, type ModuleSnapshot } from '@litljomi/cms-schema';

// The module name rule of cli.ts: a folder under modules/ is imported only if its name is one.
const MODULE_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export const CHECK_SCHEMA_USAGE = 'usage: check-schema [--update]';

export interface CheckSchemaDeps {
  /** The module names (folder names under modules/), sorted. */
  listModules: () => Promise<string[]>;
  /** The module's manifest (cli.ts imports `@litljomi/module-<name>`). */
  loadModule: (name: string) => Promise<ModuleManifest>;
  /** The committed snapshot's text, or null when the module has none. */
  readSnapshot: (name: string) => Promise<string | null>;
  writeSnapshot: (name: string, text: string) => Promise<void>;
}

interface Io {
  log: (line: string) => void;
  error: (line: string) => void;
}

/** The snapshot file's text: two-space JSON with a final newline. */
export function renderSnapshot(s: ModuleSnapshot): string {
  return JSON.stringify(s, null, 2) + '\n';
}

function parseSnapshot(name: string, text: string): ModuleSnapshot {
  const s = JSON.parse(text) as ModuleSnapshot;
  if (typeof s !== 'object' || s === null || typeof s.types !== 'object' || s.types === null) {
    throw new Error(`modules/${name}/schema.snapshot.json is not a schema snapshot`);
  }
  return s;
}

/** Returns the exit code: 0 ok, 1 a failing module (or a refused update), 2 usage. */
export async function runCheckSchema(args: string[], io: Io, deps: CheckSchemaDeps): Promise<number> {
  const update = args.includes('--update');
  if (args.some((a) => a !== '--update')) {
    io.error(CHECK_SCHEMA_USAGE);
    return 2;
  }
  const names = await deps.listModules();
  if (names.length === 0) {
    io.error('check:schema failed: no modules found');
    return 1;
  }
  let failed = false;
  const writes: Array<[string, string]> = [];
  for (const name of names) {
    let manifest: ModuleManifest;
    let previous: ModuleSnapshot | null;
    if (!MODULE_NAME.test(name)) {
      io.error(`${name}: not a module name (lower-case kebab); not loaded`);
      failed = true;
      continue;
    }
    try {
      manifest = await deps.loadModule(name);
      const text = await deps.readSnapshot(name);
      previous = text === null ? null : parseSnapshot(name, text);
    } catch (e) {
      io.error(`${name}: cannot load: ${e instanceof Error ? e.message : String(e)}`);
      failed = true;
      continue;
    }
    if (previous === null) {
      if (update) {
        writes.push([name, renderSnapshot(updateSnapshot(null, moduleSnapshot(manifest)))]);
        io.log(`${name}: new snapshot`);
      } else {
        io.error(`${name}: no schema snapshot (modules/${name}/schema.snapshot.json); run pnpm check:schema --update and commit it`);
        failed = true;
      }
      continue;
    }
    const { errors, changes } = compareSchema(previous, manifest);
    for (const line of errors) io.error(`${name}: ${line}`);
    for (const line of changes) io.log(`${name}: ${line}`);
    if (errors.length > 0) {
      failed = true;
      continue;
    }
    const next = renderSnapshot(updateSnapshot(previous, moduleSnapshot(manifest)));
    if (update) writes.push([name, next]);
    else if (changes.length > 0) io.log(`${name}: allowed changes; run pnpm check:schema --update and commit the snapshot`);
  }
  if (failed) {
    io.error(update ? 'check:schema --update refused: fix the errors above; no snapshot was written' : 'check:schema failed');
    return 1;
  }
  for (const [name, text] of writes) {
    const before = await deps.readSnapshot(name);
    if (before === text) continue;
    await deps.writeSnapshot(name, text);
    io.log(`${name}: snapshot written`);
  }
  io.log(`check:schema ok (${names.join(', ')})`);
  return 0;
}
