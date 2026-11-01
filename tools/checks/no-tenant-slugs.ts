import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export type SlugHit = { file: string; line: number; slug: string };

const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
const SKIPPED_DIRS = new Set(['node_modules', '__tests__', '.next', 'dist', '.turbo']);
const REGISTRY_SUFFIX = ['apps', 'cms', 'src', 'modules', 'registry.ts'].join(sep);

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIPPED_DIRS.has(name)) yield* walk(full);
    } else if (SOURCE_FILE.test(name) && !TEST_FILE.test(name) && !full.endsWith(sep + REGISTRY_SUFFIX)) {
      yield full;
    }
  }
}

/** Finds string and no-substitution template literals equal to a tenant slug. */
export function findTenantSlugLiterals(roots: string[], slugs: string[]): SlugHit[] {
  const wanted = new Set(slugs);
  const hits: SlugHit[] = [];
  if (wanted.size === 0) return hits;
  for (const root of roots) {
    if (!existsSync(root)) continue;
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

function main(): number {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const slugs = readTenantSlugs(join(repo, 'modules'));
  const roots = ['apps/cms/src', 'packages'].map((r) => join(repo, r));
  const hits = findTenantSlugLiterals(roots, slugs);
  for (const hit of hits) console.error(`${hit.file}:${hit.line}:${hit.slug}`);
  if (hits.length > 0) {
    console.error(`check:slugs failed: ${hits.length} tenant slug literal(s) in core code`);
    return 1;
  }
  console.log(`check:slugs ok (${slugs.length} tenant slug(s) checked)`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
