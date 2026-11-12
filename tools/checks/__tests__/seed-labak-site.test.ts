// The labak local-site script (`pnpm seed:labak-site`) is local-only: its site points at loopback,
// it reaches the stack only through env.ts (which refuses non-loopback hosts), and the shared seed
// never creates it (the design e2e expects labak to have no site after a reset).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LABAK_LOCAL_SITE } from '../../../tests/integration/src/fixtures.ts';
import { stackSlot } from '../../stack/slot.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('seed:labak-site', () => {
  it('points the site at loopback only, on either stack slot', () => {
    for (const u of [LABAK_LOCAL_SITE.baseUrl, LABAK_LOCAL_SITE.revalidateUrl]) expect(['localhost', '127.0.0.1']).toContain(new URL(u).hostname);
    expect(LABAK_LOCAL_SITE.baseUrl).toBe(stackSlot().labakSiteUrl);
    for (const slot of ['1', '2']) expect(new URL(stackSlot({ CMS_STACK_SLOT: slot }).labakSiteUrl).hostname).toBe('localhost');
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
