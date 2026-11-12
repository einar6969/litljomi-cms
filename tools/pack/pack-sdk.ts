import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// `pnpm pack:sdk <folder>`: packs the site SDK and the rich-text renderer for a site that lives in
// its own repository (spec §9.1; runbook operations.md section 2, step 11). Such a site commits the
// two `npm pack` tarballs and depends on them as `file:` paths. Beside the tarballs this writes a
// manifest naming each package's version, tarball, SHA-256 and the commit they were packed from.
//
// A version and a commit are only worth recording if the tarballs hold exactly that commit's files,
// so the command refuses when either package has uncommitted changes, and when npm would pack a
// file git does not track (an ignored file: `git status` cannot see it, npm still ships it).
// npm packs into a temp folder outside the repository and runs no package scripts, so nothing is
// left behind here; the destination is written only after every check has passed.
// It needs only Node's standard library, `git` and `npm`.

/** The packages a site depends on, relative to the repository root, in manifest order. */
export const PACKAGE_DIRS = ['packages/sdk', 'packages/rich-text'] as const;

export const MANIFEST_FILE = 'litljomi-packages.json';

export const USAGE = [
  'usage: pnpm pack:sdk <folder>',
  `Packs ${PACKAGE_DIRS.join(' and ')} into <folder>, a folder outside this repository (a site's`,
  `vendor folder), and writes ${MANIFEST_FILE} beside the tarballs. A relative <folder> starts at`,
  'the working directory, which under pnpm is the repository root.',
].join('\n');

export type PackedPackage = { name: string; version: string; file: string; sha256: string };
export type Manifest = { sourceCommit: string; packages: PackedPackage[] };
export type Result = { exitCode: number; output: string };

/** True when `child` is `parent` or below it. Both are absolute paths with links resolved. */
export function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

/** The packed files of one package that git does not track, as paths from the repository root. */
export function filesNotInCommit(packageDir: string, packedPaths: string[], tracked: ReadonlySet<string>): string[] {
  return packedPaths.map((path) => `${packageDir}/${path}`).filter((path) => !tracked.has(path));
}

type NpmPacked = { name: string; version: string; paths: string[] };

/** Reads `npm pack --json`. Throws on any other shape, so a changed npm cannot pass unchecked. */
export function parseNpmPackOutput(stdout: string): NpmPacked[] {
  const unexpected = new Error('npm pack --json printed something this command does not understand');
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw unexpected;
  }
  if (!Array.isArray(parsed)) throw unexpected;
  return parsed.map((entry: unknown) => {
    const { name, version, files } = (entry ?? {}) as { name?: unknown; version?: unknown; files?: unknown };
    if (typeof name !== 'string' || typeof version !== 'string' || !Array.isArray(files)) throw unexpected;
    const paths = files.map((file: unknown) => {
      const path = (file as { path?: unknown } | null)?.path;
      if (typeof path !== 'string') throw unexpected;
      return path;
    });
    return { name, version, paths };
  });
}

export function renderManifest(manifest: Manifest): string {
  const packages = manifest.packages.map(({ name, version, file, sha256 }) => ({ name, version, file, sha256 }));
  return `${JSON.stringify({ sourceCommit: manifest.sourceCommit, packages }, null, 2)}\n`;
}

/** Tarballs of the packed packages at another version, among the destination's file names. */
export function olderTarballs(existing: string[], packages: PackedPackage[]): string[] {
  return packages.flatMap((pkg) => {
    const prefix = pkg.file.slice(0, pkg.file.length - `${pkg.version}.tgz`.length);
    return existing.filter(
      (file) => file !== pkg.file && file.startsWith(prefix) && file.endsWith('.tgz') && /^\d/.test(file.slice(prefix.length)),
    );
  });
}

/** npm's tarball name: `@scope/name` at `1.2.3` is `scope-name-1.2.3.tgz`. */
const tarballName = (name: string, version: string) => `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`;

/** The path with links resolved, also when its last segments do not exist yet. */
function realPath(path: string): string {
  const missing: string[] = [];
  let existing = path;
  while (!existsSync(existing) && dirname(existing) !== existing) {
    missing.unshift(basename(existing));
    existing = dirname(existing);
  }
  return join(realpathSync(existing), ...missing);
}

/**
 * The environment for `git` and `npm`: without git's own variables, so git reads the repository at
 * the working directory and no other (inside a hook, GIT_DIR and GIT_INDEX_FILE name the hook's),
 * and with npm's update check off.
 */
export function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const kept = Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith('GIT_')));
  return { ...kept, npm_config_update_notifier: 'false' };
}

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: childEnv(process.env) });
}

function pack(repoRoot: string, destination: string): string[] {
  const root = realpathSync(repoRoot);
  const target = realPath(resolve(destination));
  if (isInside(root, target)) {
    throw new Error(`the destination is inside this repository (${target}). Give a folder in the site's repository.`);
  }

  const names = PACKAGE_DIRS.map((dir) => {
    const manifestPath = join(root, dir, 'package.json');
    if (!existsSync(manifestPath)) throw new Error(`${dir}/package.json does not exist`);
    return (JSON.parse(readFileSync(manifestPath, 'utf8')) as { name: string }).name;
  });

  const dirty = run('git', ['status', '--porcelain', '--untracked-files=all', '--', ...PACKAGE_DIRS], root).trimEnd();
  if (dirty !== '') {
    throw new Error(
      `${PACKAGE_DIRS.join(' or ')} has uncommitted changes, so no commit describes what would be packed. Commit or remove them:\n${dirty}`,
    );
  }
  const sourceCommit = run('git', ['rev-parse', 'HEAD'], root).trim();
  const tracked = new Set(run('git', ['ls-files', '-z', '--', ...PACKAGE_DIRS], root).split('\0'));

  const temp = mkdtempSync(join(tmpdir(), 'pack-sdk-'));
  try {
    const packageDirs = PACKAGE_DIRS.map((dir) => join(root, dir));
    const packed = parseNpmPackOutput(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temp, ...packageDirs], temp));

    const notInCommit: string[] = [];
    const packages = PACKAGE_DIRS.map((dir, i): PackedPackage => {
      const entry = packed.find((candidate) => candidate.name === names[i]);
      if (entry === undefined) throw new Error(`npm pack did not report ${names[i]} (${dir})`);
      notInCommit.push(...filesNotInCommit(dir, entry.paths, tracked));
      const file = tarballName(entry.name, entry.version);
      if (!existsSync(join(temp, file))) throw new Error(`npm pack did not write ${file}`);
      const sha256 = createHash('sha256').update(readFileSync(join(temp, file))).digest('hex');
      return { name: entry.name, version: entry.version, file, sha256 };
    });
    if (notInCommit.length > 0) {
      throw new Error(`npm would pack files that are not in commit ${sourceCommit}. Commit or remove them:\n${notInCommit.join('\n')}`);
    }

    mkdirSync(target, { recursive: true });
    const older = olderTarballs(readdirSync(target), packages);
    for (const { file } of packages) copyFileSync(join(temp, file), join(target, file));
    writeFileSync(join(target, MANIFEST_FILE), renderManifest({ sourceCommit, packages }));

    return [
      ...packages.map((pkg) => `${pkg.name} ${pkg.version}: ${pkg.file}, sha256 ${pkg.sha256}`),
      `source commit ${sourceCommit}`,
      `wrote ${packages.length} tarballs and ${MANIFEST_FILE} to ${target}`,
      ...older.map((file) => `older tarball still in the folder: ${file} (remove it once package.json names the new one)`),
    ];
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

/** Packs into `destination`, an absolute path. Exit code 0 done, 1 refused or failed. */
export function packSdk(input: { repoRoot: string; destination: string }): Result {
  try {
    return { exitCode: 0, output: pack(input.repoRoot, input.destination).join('\n') };
  } catch (error) {
    return { exitCode: 1, output: `pack:sdk failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** The command line: one argument, the destination folder. Exit code 2 for anything else. */
export function runPackSdk(args: string[], context: { repoRoot: string; cwd: string }): Result {
  const [destination] = args;
  if (args.length !== 1 || destination === undefined || destination.startsWith('-')) return { exitCode: 2, output: USAGE };
  return packSdk({ repoRoot: context.repoRoot, destination: resolve(context.cwd, destination) });
}

/** True when this file is the script Node was started with, also when started through a symlink. */
function isEntryPoint(): boolean {
  const started = process.argv[1];
  if (!started || !existsSync(started)) return false;
  return realpathSync(started) === realpathSync(fileURLToPath(import.meta.url));
}

if (isEntryPoint()) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const { exitCode, output } = runPackSdk(process.argv.slice(2), { repoRoot, cwd: process.cwd() });
  (exitCode === 0 ? console.log : console.error)(output);
  process.exitCode = exitCode;
}
