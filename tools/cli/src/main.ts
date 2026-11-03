import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CheckSchemaDeps } from './check-schema.ts';
import type { BoundaryCheckDeps } from './boundary-check.ts';
import { runCli } from './cli.ts';
import type { MigrateDraftsDeps } from './migrate-drafts.ts';
import type { ProvisionDeps } from './provision.ts';
import { readStdinSync } from './stdin.ts';

const provision: ProvisionDeps = {
  fetch: (url, init) => fetch(url, init),
  readTextFile: (path) => readFile(path, 'utf8'),
  readStdin: async () => readStdinSync(),
};

const boundaryCheck: BoundaryCheckDeps = {
  fetch: (url, init) => fetch(url, init),
  readTextFile: (path) => readFile(path, 'utf8'),
};

const migrateDrafts: Omit<MigrateDraftsDeps, 'loadModule'> = {
  fetch: (url, init) => fetch(url, init),
  readTextFile: (path) => readFile(path, 'utf8'),
};

const modulesDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'modules');
const snapshotFile = (name: string) => join(modulesDir, name, 'schema.snapshot.json');
const checkSchema: Omit<CheckSchemaDeps, 'loadModule'> = {
  // Module names are the folder names under modules/, as for check:slugs (tools/checks/no-tenant-slugs.ts).
  listModules: async () =>
    (await readdir(modulesDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
      .map((e) => e.name)
      .sort(),
  readSnapshot: async (name) => {
    try {
      return await readFile(snapshotFile(name), 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  },
  writeSnapshot: (name, text) => writeFile(snapshotFile(name), text),
};

// Failing until runCli returns: if the runtime ends the process early, it never reports success.
process.exitCode = 1;
process.exitCode = await runCli(process.argv.slice(2), { log: console.log, error: console.error, provision, boundaryCheck, migrateDrafts, checkSchema });
