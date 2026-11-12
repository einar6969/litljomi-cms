import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RESERVED_TYPE_NAMES } from '@litljomi/cms-schema';
import { expect, it } from 'vitest';

// A10: a content type's list is /t/<tenant>/<type>, the dynamic [type] folder beside this one. Every
// other folder here is an editor page of its own, and its name must be one no module can give a type
// (packages/schema, `RESERVED_TYPE_NAMES`, refused by `defineModule`).
const TENANT_PAGES = fileURLToPath(new URL('..', import.meta.url));

it('reserves the name of every editor page under /t/<tenant>/ as a type name', () => {
  const pages = readdirSync(TENANT_PAGES, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('[') && !d.name.startsWith('_') && !d.name.startsWith('(') && d.name !== '__tests__')
    .map((d) => d.name);
  expect(pages.length).toBeGreaterThan(0);
  for (const page of pages) expect(RESERVED_TYPE_NAMES).toContain(page);
});
