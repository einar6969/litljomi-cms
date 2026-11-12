import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MANIFEST_FILE,
  PACKAGE_DIRS,
  USAGE,
  filesNotInCommit,
  isInside,
  olderTarballs,
  packSdk,
  parseNpmPackOutput,
  renderManifest,
  runPackSdk,
} from '../pack-sdk.ts';

// `pnpm pack:sdk <folder>` (enhancement A3, ruling D6): the SDK and the renderer reach a site in its
// own repository as vendored `npm pack` tarballs, with a manifest that names the version, the
// SHA-256 and the source commit of each. The tests that pack run the real `git` and `npm` against a
// small repository made in a temp folder, so they also prove that packing leaves nothing behind.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const tempDirs: string[] = [];
/** A fresh temp directory, removed after the test. Its real path: macOS's temp folder is a link. */
function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  const identity = ['-c', 'user.name=pack-sdk test', '-c', 'user.email=pack-sdk@example.invalid', '-c', 'commit.gpgsign=false'];
  return execFileSync('git', [...identity, ...args], { cwd, encoding: 'utf8' });
}

function write(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

const sdkManifest = (version: string) =>
  JSON.stringify({ name: '@fixture/cms-sdk', version, files: ['src', '!src/__tests__'], type: 'module', main: 'src/index.ts' });

/** A committed repository with the two package folders, a test file in each and an ignore rule. */
function fixtureRepo(): string {
  const root = tempDir('pack-sdk-repo-');
  write(root, {
    '.gitignore': '*.local.ts\n',
    'README.md': 'fixture\n',
    'packages/sdk/package.json': sdkManifest('1.2.3'),
    'packages/sdk/src/index.ts': 'export const sdk = 1;\n',
    'packages/sdk/src/__tests__/index.test.ts': 'export {};\n',
    'packages/rich-text/package.json': JSON.stringify({
      name: '@fixture/rich-text',
      version: '4.5.6',
      files: ['src', '!src/__tests__'],
      type: 'module',
      main: 'src/index.ts',
    }),
    'packages/rich-text/src/index.ts': 'export const richText = 1;\n',
    'packages/rich-text/src/__tests__/index.test.ts': 'export {};\n',
  });
  git(root, 'init', '--quiet', '--initial-branch', 'main');
  git(root, 'add', '.');
  git(root, 'commit', '--quiet', '-m', 'fixture');
  return root;
}

/** Everything git would report in the repository, ignored files included. Empty means untouched. */
const everything = (root: string) => git(root, 'status', '--porcelain', '--untracked-files=all', '--ignored');
const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const PACKS = { timeout: 60_000 };

describe('isInside', () => {
  it('is true for the folder itself and anything below it', () => {
    expect(isInside('/a/repo', '/a/repo')).toBe(true);
    expect(isInside('/a/repo', '/a/repo/vendor/x')).toBe(true);
  });
  it('is false for a parent, a sibling, and a sibling that shares the name as a prefix', () => {
    expect(isInside('/a/repo', '/a')).toBe(false);
    expect(isInside('/a/repo', '/a/site/vendor')).toBe(false);
    expect(isInside('/a/repo', '/a/repo-site/vendor')).toBe(false);
  });
});

describe('filesNotInCommit', () => {
  const tracked = new Set(['packages/sdk/package.json', 'packages/sdk/src/index.ts']);
  it('returns nothing when every packed file is tracked', () => {
    expect(filesNotInCommit('packages/sdk', ['package.json', 'src/index.ts'], tracked)).toEqual([]);
  });
  it('names each packed file git does not track, by its path in the repository', () => {
    expect(filesNotInCommit('packages/sdk', ['package.json', 'src/index.ts', 'src/notes.local.ts'], tracked)).toEqual([
      'packages/sdk/src/notes.local.ts',
    ]);
  });
});

describe('parseNpmPackOutput', () => {
  const one = { name: '@fixture/cms-sdk', version: '1.2.3', filename: 'fixture-cms-sdk-1.2.3.tgz', files: [{ path: 'package.json' }] };
  it('reads the name, version and file list of each package', () => {
    expect(parseNpmPackOutput(JSON.stringify([one]))).toEqual([
      { name: '@fixture/cms-sdk', version: '1.2.3', paths: ['package.json'] },
    ]);
  });
  it.each([
    ['text that is not JSON', 'npm notice'],
    ['an object instead of a list', JSON.stringify(one)],
    ['an entry without a file list', JSON.stringify([{ ...one, files: undefined }])],
    ['an entry without a version', JSON.stringify([{ ...one, version: undefined }])],
    ['a file without a path', JSON.stringify([{ ...one, files: [{ size: 1 }] }])],
  ])('throws on %s', (_what, stdout) => {
    expect(() => parseNpmPackOutput(stdout)).toThrow(/npm pack/);
  });
});

describe('renderManifest', () => {
  it('is JSON with the source commit and, per package, the name, version, file and SHA-256', () => {
    const text = renderManifest({
      sourceCommit: 'c'.repeat(40),
      packages: [{ name: '@fixture/cms-sdk', version: '1.2.3', file: 'fixture-cms-sdk-1.2.3.tgz', sha256: 'a'.repeat(64) }],
    });
    expect(text.endsWith('}\n')).toBe(true);
    expect(JSON.parse(text)).toEqual({
      sourceCommit: 'c'.repeat(40),
      packages: [{ name: '@fixture/cms-sdk', version: '1.2.3', file: 'fixture-cms-sdk-1.2.3.tgz', sha256: 'a'.repeat(64) }],
    });
  });
});

describe('olderTarballs', () => {
  const packed = [{ name: '@fixture/cms-sdk', version: '1.3.0', file: 'fixture-cms-sdk-1.3.0.tgz', sha256: '' }];
  it('names another version of a packed package', () => {
    expect(olderTarballs(['fixture-cms-sdk-1.2.3.tgz', 'fixture-cms-sdk-1.3.0.tgz', MANIFEST_FILE], packed)).toEqual([
      'fixture-cms-sdk-1.2.3.tgz',
    ]);
  });
  it('leaves other files alone, also a package whose name only starts the same way', () => {
    expect(olderTarballs(['fixture-cms-sdk-extras-1.0.0.tgz', 'other-2.0.0.tgz', 'README.md'], packed)).toEqual([]);
  });
});

describe('the package folders', () => {
  it('exist in this repository, each with a package.json that has a version', () => {
    for (const dir of PACKAGE_DIRS) {
      const manifest = JSON.parse(readFileSync(join(repoRoot, dir, 'package.json'), 'utf8')) as { version?: unknown };
      expect(manifest.version, dir).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});

describe('runPackSdk', () => {
  it.each([[[]], [['a', 'b']], [['--help']]])('prints the usage and exits 2 for the arguments %j', (args) => {
    expect(runPackSdk(args, { repoRoot, cwd: repoRoot })).toEqual({ exitCode: 2, output: USAGE });
  });

  it('resolves a relative destination from the working directory', () => {
    const repo = fixtureRepo();
    const result = runPackSdk(['vendor'], { repoRoot: repo, cwd: repo });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain(join(repo, 'vendor'));
  });
});

describe('packSdk', () => {
  it('packs both packages and writes the manifest beside them, leaving the repository untouched', PACKS, () => {
    const repo = fixtureRepo();
    const destination = join(tempDir('pack-sdk-site-'), 'vendor', 'cms');

    const result = packSdk({ repoRoot: repo, destination });

    expect(result.output).not.toContain('failed');
    expect(result.exitCode).toBe(0);
    expect(readdirSync(destination).sort()).toEqual(['fixture-cms-sdk-1.2.3.tgz', 'fixture-rich-text-4.5.6.tgz', MANIFEST_FILE].sort());
    const manifestText = readFileSync(join(destination, MANIFEST_FILE), 'utf8');
    expect(JSON.parse(manifestText)).toEqual({
      sourceCommit: git(repo, 'rev-parse', 'HEAD').trim(),
      packages: [
        {
          name: '@fixture/cms-sdk',
          version: '1.2.3',
          file: 'fixture-cms-sdk-1.2.3.tgz',
          sha256: sha256(join(destination, 'fixture-cms-sdk-1.2.3.tgz')),
        },
        {
          name: '@fixture/rich-text',
          version: '4.5.6',
          file: 'fixture-rich-text-4.5.6.tgz',
          sha256: sha256(join(destination, 'fixture-rich-text-4.5.6.tgz')),
        },
      ],
    });
    for (const line of ['@fixture/cms-sdk 1.2.3', '@fixture/rich-text 4.5.6', git(repo, 'rev-parse', 'HEAD').trim(), destination]) {
      expect(result.output).toContain(line);
    }
    expect(everything(repo)).toBe('');

    // The same commit packs to the same bytes, so a second run changes nothing in the site.
    expect(packSdk({ repoRoot: repo, destination }).exitCode).toBe(0);
    expect(readFileSync(join(destination, MANIFEST_FILE), 'utf8')).toBe(manifestText);
    expect(everything(repo)).toBe('');
  });

  it('ships what the package lists in `files`, and so no tests', PACKS, () => {
    const repo = fixtureRepo();
    const destination = tempDir('pack-sdk-site-');
    expect(packSdk({ repoRoot: repo, destination }).exitCode).toBe(0);
    const listing = execFileSync('tar', ['-tzf', join(destination, 'fixture-cms-sdk-1.2.3.tgz')], { encoding: 'utf8' });
    expect(listing.trim().split('\n').sort()).toEqual(['package/package.json', 'package/src/index.ts']);
  });

  it('ignores uncommitted changes outside the two packages', PACKS, () => {
    const repo = fixtureRepo();
    write(repo, { 'README.md': 'changed\n', 'docs/new.md': 'new\n' });
    const before = everything(repo);
    expect(packSdk({ repoRoot: repo, destination: tempDir('pack-sdk-site-') }).exitCode).toBe(0);
    expect(everything(repo)).toBe(before);
  });

  it('names an older tarball of the same package that is still in the folder', PACKS, () => {
    const repo = fixtureRepo();
    const destination = tempDir('pack-sdk-site-');
    expect(packSdk({ repoRoot: repo, destination }).exitCode).toBe(0);
    write(repo, { 'packages/sdk/package.json': sdkManifest('1.3.0') });
    git(repo, 'commit', '--quiet', '-am', 'sdk 1.3.0');

    const result = packSdk({ repoRoot: repo, destination });

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatch(/older tarball.*fixture-cms-sdk-1\.2\.3\.tgz/);
    expect(result.output).not.toMatch(/older tarball.*rich-text/);
    const manifest = JSON.parse(readFileSync(join(destination, MANIFEST_FILE), 'utf8')) as { packages: { file: string }[] };
    expect(manifest.packages.map((p) => p.file)).toEqual(['fixture-cms-sdk-1.3.0.tgz', 'fixture-rich-text-4.5.6.tgz']);
  });

  describe('refuses, and writes nothing,', () => {
    /** Packs into a folder that does not exist yet, so "nothing written" is "still does not exist". */
    function refused(repo: string): { output: string; exitCode: number } {
      const destination = join(tempDir('pack-sdk-site-'), 'vendor');
      const before = everything(repo);
      const result = packSdk({ repoRoot: repo, destination });
      expect(existsSync(destination)).toBe(false);
      expect(everything(repo)).toBe(before);
      return result;
    }

    it('when a tracked file of a package is modified', () => {
      const repo = fixtureRepo();
      write(repo, { 'packages/sdk/src/index.ts': 'export const sdk = 2;\n' });
      const result = refused(repo);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('pack:sdk failed');
      expect(result.output).toContain('packages/sdk/src/index.ts');
    });

    it('when a change to a package is staged but not committed', () => {
      const repo = fixtureRepo();
      write(repo, { 'packages/rich-text/package.json': '{"name":"@fixture/rich-text","version":"9.9.9"}' });
      git(repo, 'add', 'packages/rich-text/package.json');
      const result = refused(repo);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('packages/rich-text/package.json');
    });

    it('when a package holds an untracked file, a test file included', () => {
      const repo = fixtureRepo();
      write(repo, { 'packages/rich-text/src/__tests__/new.test.ts': 'export {};\n' });
      const result = refused(repo);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('packages/rich-text/src/__tests__/new.test.ts');
    });

    it('when npm would pack a file git ignores, which no commit holds', PACKS, () => {
      const repo = fixtureRepo();
      write(repo, { 'packages/sdk/src/notes.local.ts': 'export const local = 1;\n' });
      expect(git(repo, 'status', '--porcelain', '--untracked-files=all')).toBe('');
      const result = refused(repo);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('pack:sdk failed');
      expect(result.output).toContain('packages/sdk/src/notes.local.ts');
    });

    it('when the destination is inside this repository', () => {
      const repo = fixtureRepo();
      const before = everything(repo);
      const result = packSdk({ repoRoot: repo, destination: join(repo, 'vendor') });
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('pack:sdk failed');
      expect(result.output).toContain('inside this repository');
      expect(everything(repo)).toBe(before);
    });

    it('when a package folder is missing', () => {
      const repo = fixtureRepo();
      git(repo, 'rm', '--quiet', '-r', 'packages/rich-text');
      git(repo, 'commit', '--quiet', '-m', 'remove a package');
      const result = refused(repo);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('packages/rich-text');
    });
  });
});
