import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const eslint = new ESLint({ cwd: root });

async function ruleIds(path: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: join(root, path) });
  return (result?.messages ?? []).map((m) => m.ruleId ?? `fatal:${m.message}`);
}

const RESTRICTED_SYNTAX = 'no-restricted-syntax';
const IMPORT = 'no-restricted-imports';

describe('module imports', () => {
  it('forbids importing a module outside the registry', async () => {
    expect(await ruleIds('apps/cms/src/editor/x.ts', `import m from '@litljomi/module-labak'`)).toContain(IMPORT);
  });
  it('forbids a relative path into modules/ from packages', async () => {
    expect(await ruleIds('packages/sdk/src/x.ts', `import m from '../../../modules/labak/src/index'`)).toContain(IMPORT);
  });
  it.each([
    [`import('@litljomi/module-labak')`],
    [`require('@litljomi/module-labak')`],
    ['import(`@litljomi/module-labak`)'],
    [`import m from '@/modules/labak/x'`],
    [`import m from './modules/labak/x'`],
    [`import('@/modules/labak/x')`],
    [`require('./modules/labak/x')`],
    [`import('../../modules/labak/x')`],
  ])('forbids %s outside the registry', async (code) => {
    const ids = await ruleIds('apps/cms/src/editor/x.ts', code);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(1);
    expect([IMPORT, RESTRICTED_SYNTAX]).toContain(ids[0]);
  });
  it('reports a static module import under exactly the import rule', async () => {
    expect(await ruleIds('apps/cms/src/editor/x.ts', `import m from '@litljomi/module-labak'`)).toEqual([IMPORT]);
  });
  it('reports a dynamic module import under exactly the syntax rule', async () => {
    expect(await ruleIds('apps/cms/src/editor/x.ts', `import('@litljomi/module-labak')`)).toEqual([RESTRICTED_SYNTAX]);
  });
  it('forbids dynamic module imports from packages', async () => {
    expect(await ruleIds('packages/sdk/src/x.ts', `import('@litljomi/module-labak')`)).toEqual([RESTRICTED_SYNTAX]);
    expect(await ruleIds('packages/sdk/src/x.ts', `require('../../../modules/labak/src/index')`)).toEqual([RESTRICTED_SYNTAX]);
  });
  it('still forbids module imports, static and dynamic, inside privileged/', async () => {
    const path = 'apps/cms/src/privileged/worker/x.ts';
    expect(await ruleIds(path, `import m from '@litljomi/module-labak'`)).toEqual([IMPORT]);
    expect(await ruleIds(path, `import m from '@/modules/labak/x'`)).toEqual([IMPORT]);
    expect(await ruleIds(path, `import('@litljomi/module-labak')`)).toEqual([RESTRICTED_SYNTAX]);
    expect(await ruleIds(path, `require('@litljomi/module-labak')`)).toEqual([RESTRICTED_SYNTAX]);
    expect(await ruleIds(path, `require('../../modules/labak/x')`)).toEqual([RESTRICTED_SYNTAX]);
  });
  it('does not let the registry read the secret key', async () => {
    expect(await ruleIds('apps/cms/src/modules/registry.ts', `const k = process.env.SUPABASE_SECRET_KEY`)).toEqual([RESTRICTED_SYNTAX]);
  });
  it('allows dynamic imports of the registry and of unrelated packages', async () => {
    expect(await ruleIds('apps/cms/src/editor/x.ts', `import('@/modules/registry'); import('./modules/registry'); require('zod')`)).toEqual([]);
  });
  it('allows the registry to import modules dynamically', async () => {
    expect(await ruleIds('apps/cms/src/modules/registry.ts', `import('@litljomi/module-labak'); require('@litljomi/module-labak')`)).toEqual([]);
  });
  it('allows the registry to import modules', async () => {
    expect(await ruleIds('apps/cms/src/modules/registry.ts', `import m from '@litljomi/module-labak'`)).toEqual([]);
  });
  it('allows core to import the registry', async () => {
    expect(await ruleIds('apps/cms/src/editor/x.ts', `import r from '@/modules/registry'; import s from '../modules/registry'`)).toEqual([]);
  });
});

describe('admin client', () => {
  it('forbids the admin client outside privileged/', async () => {
    expect(await ruleIds('apps/cms/src/editor/x.ts', `import { createAdminClient } from '@/privileged/admin-client'`)).toContain(IMPORT);
  });
  it('forbids a relative path into privileged/ outside privileged/', async () => {
    expect(await ruleIds('apps/cms/src/editor/x.ts', `import { c } from '../privileged/admin-client'`)).toContain(IMPORT);
  });
  it.each([
    [`import('@/privileged/admin-client')`],
    [`require('../privileged/admin-client')`],
    [`import('./privileged/admin-client')`],
  ])('forbids %s outside privileged/', async (code) => {
    expect(await ruleIds('apps/cms/src/editor/x.ts', code)).toEqual([RESTRICTED_SYNTAX]);
  });
  it('forbids the dynamic admin client from packages and modules', async () => {
    expect(await ruleIds('packages/sdk/src/x.ts', `import('@/privileged/admin-client')`)).toEqual([RESTRICTED_SYNTAX]);
    expect(await ruleIds('modules/labak/src/x.ts', `require('../../../apps/cms/src/privileged/admin-client')`)).toEqual([
      RESTRICTED_SYNTAX,
      RESTRICTED_SYNTAX,
    ]);
  });
  it('allows the dynamic admin client inside privileged/', async () => {
    expect(await ruleIds('apps/cms/src/privileged/worker/x.ts', `import('@/privileged/admin-client'); require('./admin-client')`)).toEqual([]);
  });
  it('allows other environment variables', async () => {
    expect(await ruleIds('apps/cms/src/editor/x.ts', `const a = process.env.OTHER; const b = process.env['OTHER']; const { OTHER } = process.env`)).toEqual([]);
  });
  it.each([
    [`const k = process['env'].SUPABASE_SECRET_KEY`],
    [`const k = process['env']['SUPABASE_SECRET_KEY']`],
    [`const { SUPABASE_SECRET_KEY } = process['env']`],
  ])('forbids %s', async (code) => {
    expect(await ruleIds('apps/cms/src/editor/x.ts', code)).toEqual([RESTRICTED_SYNTAX]);
  });
  it('forbids reading SUPABASE_SECRET_KEY outside privileged/', async () => {
    expect(await ruleIds('apps/cms/src/editor/x.ts', `const k = process.env.SUPABASE_SECRET_KEY`)).toContain(RESTRICTED_SYNTAX);
  });
  it('forbids the computed spelling', async () => {
    expect(await ruleIds('apps/cms/src/editor/x.ts', `const k = process.env['SUPABASE_SECRET_KEY']`)).toContain(RESTRICTED_SYNTAX);
  });
  it('forbids destructuring', async () => {
    expect(await ruleIds('apps/cms/src/editor/x.ts', `const { SUPABASE_SECRET_KEY } = process.env`)).toContain(RESTRICTED_SYNTAX);
    expect(await ruleIds('apps/cms/src/editor/x.ts', `const { SUPABASE_SECRET_KEY: k } = process.env`)).toContain(RESTRICTED_SYNTAX);
  });
  it('applies outside apps/cms too', async () => {
    expect(await ruleIds('packages/sdk/src/x.ts', `const k = process.env.SUPABASE_SECRET_KEY`)).toContain(RESTRICTED_SYNTAX);
  });
  it('allows both inside privileged/', async () => {
    expect(
      await ruleIds(
        'apps/cms/src/privileged/worker/x.ts',
        `import { createAdminClient } from '@/privileged/admin-client'; const k = process.env.SUPABASE_SECRET_KEY`,
      ),
    ).toEqual([]);
  });
  it('allows the secret key in tools/cli', async () => {
    expect(await ruleIds('tools/cli/src/x.ts', `const k = process.env.SUPABASE_SECRET_KEY; const { SUPABASE_SECRET_KEY } = process.env`)).toEqual([]);
  });
});

describe('apps boundary', () => {
  it('forbids packages importing from apps', async () => {
    expect(await ruleIds('packages/sdk/src/x.ts', `import x from '../../../apps/cms/src/x'`)).toContain(IMPORT);
  });
  it('forbids modules importing from apps', async () => {
    expect(await ruleIds('modules/labak/src/x.ts', `import x from '../../../apps/cms/src/x'`)).toContain(IMPORT);
  });
});
