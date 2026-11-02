// The labak local-site script (`pnpm seed:labak-site`) is local-only: its site points at loopback,
// it reaches the stack only through env.ts (which refuses non-loopback hosts), and the shared seed
// never creates it (the design e2e expects labak to have no site after a reset).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('seed:labak-site', () => {
  it('points the site at loopback only', () => {
    const fixtures = read('tests/integration/src/fixtures.ts');
    const block = fixtures.slice(fixtures.indexOf('export const LABAK_LOCAL_SITE'));
    const urls = block.match(/https?:\/\/[^'"]+/g) ?? [];
    expect(urls).toHaveLength(2);
    for (const u of urls) expect(['localhost', '127.0.0.1']).toContain(new URL(u).hostname);
  });

  it('reaches the stack only through the loopback-checked clients and sql modules', () => {
    const script = read('tests/integration/scripts/seed-labak-site.ts');
    const imports = [...script.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual(['../src/clients.ts', '../src/fixtures.ts', '../src/sql.ts']);
    expect(script).not.toMatch(/https?:\/\//);
    expect(read('tests/integration/src/env.ts')).toContain('refusing a non-local stack');
  });

  it('is a root script and is not part of the shared seed', () => {
    expect(JSON.parse(read('package.json')).scripts['seed:labak-site']).toBe('node tests/integration/scripts/seed-labak-site.ts');
    expect(read('tests/integration/src/seed.ts')).not.toContain('LABAK_LOCAL_SITE');
  });
});
