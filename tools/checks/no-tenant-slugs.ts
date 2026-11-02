import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export type SlugHit = { file: string; line: number; slug: string };

const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
const SKIPPED_DIRS = new Set(['node_modules', '__tests__', '.next', 'dist', '.turbo']);
const REGISTRY_SUFFIX = sep + ['apps', 'cms', 'src', 'modules', 'registry.ts'].join(sep);

/** Core source: a script file that is neither a test nor the module registry (the one place slugs may appear). */
function isCoreSourceFile(name: string, fullPath: string): boolean {
  return SOURCE_FILE.test(name) && !TEST_FILE.test(name) && !fullPath.endsWith(REGISTRY_SUFFIX);
}

function* walk(dir: string): Generator<string> {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) yield* walk(full);
    } else if (isCoreSourceFile(entry.name, full)) {
      yield full;
    }
  }
}

/**
 * Finds string and no-substitution template literals equal to a tenant slug.
 * Throws when a root does not exist, so a mistyped or moved root cannot pass silently.
 */
export function findTenantSlugLiterals(roots: string[], slugs: string[]): SlugHit[] {
  for (const root of roots) {
    if (!existsSync(root)) throw new Error(`check:slugs root does not exist: ${root}`);
  }
  const wanted = new Set(slugs);
  const hits: SlugHit[] = [];
  if (wanted.size === 0) return hits;
  for (const root of roots) {
    for (const file of walk(root)) {
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && wanted.has(node.text)) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
          hits.push({ file, line: line + 1, slug: node.text });
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  return hits;
}

/** Tenant slugs are the folder names under modules/. */
export function readTenantSlugs(modulesDir: string): string[] {
  if (!existsSync(modulesDir)) return [];
  return readdirSync(modulesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
    .map((entry) => entry.name)
    .sort();
}

/** Core roots to scan, relative to the repository root. Each must exist (C-F1): a missing root fails the check. */
const CORE_ROOTS = ['apps/cms/src', 'packages'];

export function runCheck(repoRoot: string): { exitCode: number; output: string } {
  const modulesDir = join(repoRoot, 'modules');
  const slugs = readTenantSlugs(modulesDir);
  const missing = CORE_ROOTS.filter((r) => !existsSync(join(repoRoot, r)));
  if (missing.length > 0) {
    return { exitCode: 1, output: `check:slugs failed: core root(s) missing: ${missing.join(', ')}` };
  }
  const modulesNote = existsSync(modulesDir) ? '' : ' (modules/ is absent)';
  const summary = [`roots scanned: ${CORE_ROOTS.join(', ')}`, `${slugs.length} tenant slug(s) checked${modulesNote}`];
  const hits = findTenantSlugLiterals(
    CORE_ROOTS.map((r) => join(repoRoot, r)),
    slugs,
  );
  if (hits.length > 0) {
    const lines = hits.map((hit) => `${relative(repoRoot, hit.file)}:${hit.line}:${hit.slug}`);
    return {
      exitCode: 1,
      output: [...lines, `check:slugs failed: ${hits.length} tenant slug literal(s) in core code`, ...summary].join('\n'),
    };
  }
  return { exitCode: 0, output: ['check:slugs ok', ...summary].join('\n') };
}

/** True when this file is the script Node was started with, also when started through a symlink. */
function isEntryPoint(): boolean {
  const started = process.argv[1];
  if (!started || !existsSync(started)) return false;
  return realpathSync(started) === realpathSync(fileURLToPath(import.meta.url));
}

if (isEntryPoint()) {
  const repoRoot = process.argv[2]
    ? resolve(process.argv[2])
    : resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const { exitCode, output } = runCheck(repoRoot);
  (exitCode === 0 ? console.log : console.error)(output);
  process.exitCode = exitCode;
}
