import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

// Decision 23: sites import only the main entry point, which must never load Tiptap.
const src = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(src, '../package.json'), 'utf8')) as {
  exports: Record<string, string>;
};

function graph(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const code = readFileSync(entry, 'utf8');
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
});

it('the graph walker does see Tiptap from the editor entry point', () => {
  expect([...graph(resolve(src, 'tiptap.ts'))].some((f) => f.startsWith('@tiptap'))).toBe(true);
});

it('package.json exposes "." and "./editor" only', () => {
  expect(pkg.exports).toEqual({ '.': './src/index.ts', './editor': './src/tiptap.ts' });
});
