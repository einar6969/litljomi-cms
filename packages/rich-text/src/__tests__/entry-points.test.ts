import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

// Decision 23: sites import only the main entry point, which must never load Tiptap.
const src = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(src, '../package.json'), 'utf8')) as {
  exports: Record<string, string>;
};

// A textual walker, not a bundler: it follows string-literal specifiers in `from '...'`,
// `import '...'` and `import('...')`. It cannot resolve an import whose specifier is computed
// (`import(name)`, `require(x)`, a template with substitutions), so any such call in the graph is
// recorded as the marker below and fails the first test instead of being missed.
// The pattern is textual, so it also matches `import(` inside comments and strings: that only
// ever fails closed (a false alarm, never a missed import). ESLint
// (`eslint.config.mjs`, packages/**) separately forbids importing the editor entry by name.
const COMPUTED_IMPORT = '<computed import>';

function graph(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const code = readFileSync(entry, 'utf8');
  if (/\b(?:import|require)\s*\(\s*(?!['"][^'"]*['"]\s*\))/.test(code)) seen.add(COMPUTED_IMPORT);
  for (const m of code.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
    const spec = m[1]!;
    if (spec.startsWith('.')) graph(resolve(dirname(entry), spec), seen);
    else seen.add(spec);
  }
  return seen;
}

it('the main entry point does not import Tiptap, directly or transitively', () => {
  const files = [...graph(resolve(src, 'index.ts'))];
  expect(files.some((f) => f.endsWith('tiptap.ts'))).toBe(false);
  expect(files.filter((f) => f.startsWith('@tiptap'))).toEqual([]);
  expect(files.filter((f) => f.startsWith('prosemirror'))).toEqual([]);
  expect(files).not.toContain(COMPUTED_IMPORT);
});

it('the graph walker does see Tiptap from the editor entry point', () => {
  expect([...graph(resolve(src, 'tiptap.ts'))].some((f) => f.startsWith('@tiptap'))).toBe(true);
});

it('the graph walker records a computed import instead of missing it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'entry-points-'));
  try {
    const cases = ["const n = '@tiptap/core'; await import(n);", 'require(`@tiptap/${x}`);'];
    for (const [i, code] of cases.entries()) {
      const file = join(dir, `c${i}.ts`);
      writeFileSync(file, code);
      expect(graph(file), code).toContain(COMPUTED_IMPORT);
    }
    const literal = join(dir, 'literal.ts');
    writeFileSync(literal, "await import('zod');");
    expect(graph(literal)).not.toContain(COMPUTED_IMPORT);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('package.json exposes "." and "./editor" only', () => {
  expect(pkg.exports).toEqual({ '.': './src/index.ts', './editor': './src/tiptap.ts' });
});
