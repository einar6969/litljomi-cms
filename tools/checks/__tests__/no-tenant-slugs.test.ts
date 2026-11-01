import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findTenantSlugLiterals } from '../no-tenant-slugs.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => join(here, 'fixtures', name);

describe('findTenantSlugLiterals', () => {
  it('flags a tenant slug literal in core', () => {
    const hits = findTenantSlugLiterals([fixture('core-with-slug')], ['labak', 'demo']);
    expect(hits).toEqual([{ file: expect.stringMatching(/bad\.ts$/), line: 1, slug: 'labak' }]);
  });
  it('ignores the module registry and identifiers that merely contain the slug', () => {
    expect(findTenantSlugLiterals([fixture('core-clean')], ['labak', 'demo'])).toEqual([]);
  });
  it('returns nothing when there are no slugs or the root does not exist', () => {
    expect(findTenantSlugLiterals([fixture('core-with-slug')], [])).toEqual([]);
    expect(findTenantSlugLiterals([fixture('missing')], ['labak'])).toEqual([]);
  });
});
