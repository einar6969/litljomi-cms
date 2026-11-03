// The Delivery suite covers the §8.5 Delivery row (plan M3-16): every case of the row, read from
// docs/architecture.md, has an entry in apps/cms/delivery-suite.ts, and every test an entry names exists in
// its file under its describe. Runs in `pnpm test` (no database needed).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DELIVERY_SUITE, deliveryNamePattern, deliveryTests } from '../../../../delivery-suite';

const here = (file: string) => new URL(file, import.meta.url);
const architecture = readFileSync(here('../../../../../../docs/architecture.md'), 'utf8');

/** The cases of the §8.5 Delivery row, in order. */
function specCases(): string[] {
  const row = architecture.split('\n').find((l) => l.startsWith('| **Delivery** |'));
  if (!row) throw new Error('docs/architecture.md has no §8.5 Delivery row');
  const cells = row.split('|').map((c) => c.trim());
  return cells[2]!.split('; ').map((c) => c.trim());
}

/** Whether `source` declares `fn(<name>` with the name in any quote style (escapes undone). */
function declares(source: string, fn: 'describe' | 'it', name: string): boolean {
  const unescaped = source.replace(/\\(['"`])/g, '$1');
  return ["'", '"', '`'].some((q) => unescaped.includes(`${fn}(${q}${name}${q}`));
}

describe('the Delivery suite', () => {
  it('has exactly the cases of the §8.5 Delivery row, word for word, each with at least one test', () => {
    const cases = specCases();
    expect(cases).toHaveLength(8);
    expect(DELIVERY_SUITE.map((c) => c.case)).toEqual(cases);
    for (const c of DELIVERY_SUITE) expect(c.tests.length, c.case).toBeGreaterThan(0);
  });

  it.each(deliveryTests().map((t) => [`${t.file}: ${t.test}`, t] as const))('names a test its file has: %s', (_name, t) => {
    const source = readFileSync(here(t.file), 'utf8');
    expect(declares(source, 'describe', t.describe), `describe '${t.describe}'`).toBe(true);
    expect(declares(source, 'it', t.test), `it '${t.test}'`).toBe(true);
  });

  it("the name pattern selects each suite test by vitest's full name (describe and test), and not its neighbours", () => {
    const pattern = deliveryNamePattern();
    for (const t of deliveryTests()) expect(`${t.describe} ${t.test}`).toMatch(pattern);
    expect('processAndDeliver a site that does not revalidate is live not_confirmed, with the entry in last_error').not.toMatch(pattern);
    expect('buildRelease (labak) never copies the assets of drafts that were never published').not.toMatch(pattern);
  });
});
