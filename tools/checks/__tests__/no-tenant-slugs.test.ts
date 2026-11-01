import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findTenantSlugLiterals, runCheck } from '../no-tenant-slugs.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => join(here, 'fixtures', name);
const SLUGS = ['labak', 'demo'];

/** Writes the files into a fresh temp directory and scans it. */
function scan(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'slugs-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return findTenantSlugLiterals([dir], SLUGS);
}

describe('findTenantSlugLiterals', () => {
  it('flags a tenant slug literal in core', () => {
    const hits = findTenantSlugLiterals([fixture('core-with-slug')], SLUGS);
    expect(hits).toEqual([{ file: expect.stringMatching(/bad\.ts$/), line: 1, slug: 'labak' }]);
  });
  it('ignores the module registry and identifiers that merely contain the slug', () => {
    expect(findTenantSlugLiterals([fixture('core-clean')], SLUGS)).toEqual([]);
  });
  it('ignores the module registry', () => {
    expect(scan({ 'apps/cms/src/modules/registry.ts': `export const r = ['labak'];` })).toEqual([]);
  });
  it('does not ignore other files in the modules folder', () => {
    expect(scan({ 'apps/cms/src/modules/other.ts': `export const r = 'labak';` })).toHaveLength(1);
  });
  it('ignores files under __tests__', () => {
    expect(scan({ '__tests__/x.ts': `export const r = 'labak';` })).toEqual([]);
  });
  it('ignores *.test.ts files', () => {
    expect(scan({ 'x.test.ts': `export const r = 'labak';` })).toEqual([]);
  });
  it('ignores identifiers that merely contain the slug', () => {
    expect(scan({ 'x.ts': 'export const labakThing = 1; export const demoUrl = 2;' })).toEqual([]);
  });
  it('ignores longer strings and templates with substitutions', () => {
    expect(scan({ 'x.ts': "export const a = 'demo-site'; export const b = `labak${1}`;" })).toEqual([]);
  });
  it('ignores comments', () => {
    expect(scan({ 'x.ts': "// 'labak' in a comment\nexport const a = 1;" })).toEqual([]);
  });
  it('returns nothing when there are no slugs', () => {
    expect(findTenantSlugLiterals([fixture('core-with-slug')], [])).toEqual([]);
  });
  it('throws, naming the root, when a root does not exist', () => {
    expect(() => findTenantSlugLiterals([fixture('missing')], ['labak'])).toThrow(/does not exist.*missing/);
    expect(() => findTenantSlugLiterals([fixture('missing')], [])).toThrow(/does not exist/);
  });
  it('does not follow symlinks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'slugs-'));
    mkdirSync(join(dir, 'real'));
    writeFileSync(join(dir, 'real', 'a.ts'), 'export const a = 1;\n');
    symlinkSync(dir, join(dir, 'real', 'loop'));
    expect(findTenantSlugLiterals([dir], SLUGS)).toEqual([]);
  });
});

describe('runCheck', () => {
  it('exits 1 and prints file:line:slug for a slug literal in core', () => {
    const { exitCode, output } = runCheck(fixture('repo-with-slug'));
    expect(exitCode).toBe(1);
    expect(output).toContain(`${join('apps', 'cms', 'src', 'leak.ts')}:2:labak`);
  });
  it('exits 0 and states scanned and absent roots and the slug count', () => {
    const { exitCode, output } = runCheck(fixture('repo-clean'));
    expect(exitCode).toBe(0);
    expect(output).toContain('roots scanned: apps/cms/src');
    expect(output).toContain('roots absent: packages');
    expect(output).toContain('1 tenant slug(s) checked');
  });
  it('states that modules/ is absent and zero slugs were checked', () => {
    const { exitCode, output } = runCheck(fixture('core-clean'));
    expect(exitCode).toBe(0);
    expect(output).toContain('0 tenant slug(s) checked (modules/ is absent)');
  });
});

describe('check:slugs command line', () => {
  const run = (repo: string) =>
    spawnSync(process.execPath, [join(here, '..', 'no-tenant-slugs.ts'), repo], { encoding: 'utf8' });
  it('exits 1 with file:line:slug on stderr', () => {
    const result = run(fixture('repo-with-slug'));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${join('apps', 'cms', 'src', 'leak.ts')}:2:labak`);
  });
  it('exits 0 on a clean repository', () => {
    const result = run(fixture('repo-clean'));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('check:slugs ok');
  });
});
