import { spawnSync } from 'node:child_process';
import { constants, openSync, readSync } from 'node:fs';
import { lstat, open, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { isatty } from 'node:tty';
import { fileURLToPath } from 'node:url';
import type { CheckSchemaDeps } from './check-schema.ts';
import { PASSWORD_ENV, type ImportDeps } from './import.ts';
import { imageInspector } from './import/media.ts';
import { readPassword } from './password.ts';
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

// `import` (docs/plans/import.md). The terminal's echo is restored if the operator presses Ctrl-C at
// the password prompt.
let tty: number | null = null;
const stty = (arg: string) => spawnSync('stty', [arg], { stdio: ['inherit', 'ignore', 'ignore'] }).status === 0;
const restoreEcho = () => {
  stty('echo');
  process.exit(130);
};
const setEcho = (on: boolean): boolean => {
  if (on) {
    process.off('SIGINT', restoreEcho);
    return stty('echo');
  }
  process.once('SIGINT', restoreEcho);
  return stty('-echo');
};
const importDeps: Omit<ImportDeps, 'loadModule'> = {
  fetch: (url, init) => fetch(url, init),
  readTextFile: (path) => readFile(path, 'utf8'),
  lstat: async (path) => {
    try {
      const st = await lstat(path);
      const kind = st.isSymbolicLink() ? 'symlink' : st.isFile() ? 'file' : st.isDirectory() ? 'directory' : 'other';
      return { kind, size: st.size };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'ENOTDIR') return null;
      throw e;
    }
  },
  // O_NOFOLLOW: a symlink swapped in after the dry run's check is refused, not followed.
  readBytes: async (path) => {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      return new Uint8Array(await handle.readFile());
    } finally {
      await handle.close();
    }
  },
  read: async (path) => {
    try {
      return await readFile(path, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  },
  // Atomic: a temporary file beside it, then a rename. Owner-only, like the env file it sits near.
  write: async (path, text) => {
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, text, { mode: 0o600 });
    await rename(tmp, path);
  },
  readPassword: async () =>
    readPassword({
      takeEnv: () => {
        const value = process.env[PASSWORD_ENV];
        delete process.env[PASSWORD_ENV];
        return value;
      },
      stdinIsTerminal: () => isatty(0),
      readPiped: () => readStdinSync() ?? '',
      prompt: (text) => process.stderr.write(text),
      setEcho,
      readByte: () => {
        tty ??= openSync('/dev/tty', 'r');
        const buf = Buffer.alloc(1);
        return readSync(tty, buf, 0, 1, null) === 0 ? null : (buf[0] as number);
      },
    }),
  // sharp is loaded only when `import` inspects a file.
  inspectImage: imageInspector(async (bytes) => {
    const { default: sharp } = await import('sharp');
    return sharp(bytes).metadata();
  }),
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

// Failing until runCli returns: if the runtime ends the process early, it never reports success.
process.exitCode = 1;
process.exitCode = await runCli(process.argv.slice(2), { log: console.log, error: console.error, provision, boundaryCheck, migrateDrafts, checkSchema, import: importDeps });
