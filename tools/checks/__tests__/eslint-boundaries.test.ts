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

// The tests below build their inputs so this file never contains the bare key name as a whole
// string: the boundary rules forbid that here too.
describe('secret key name', () => {
  it.each([
    [`import { env } from 'node:process'; const k = env.SUPABASE_SECRET_KEY`],
    [`const e = process.env; const k = e.SUPABASE_SECRET_KEY`],
    [`const k = globalThis.process.env.SUPABASE_SECRET_KEY`],
    ['const k = process.env[`SUPABASE_SECRET_KEY`]'],
    [`const k = Reflect.get(process.env, 'SUPABASE_SECRET_KEY')`],
    [`type E = { SUPABASE_SECRET_KEY: string }`],
  ])('forbids %s outside privileged/', async (code) => {
    expect(await ruleIds('apps/cms/src/editor/x.ts', code)).toEqual([RESTRICTED_SYNTAX]);
  });
  it('forbids a central env schema that names the key', async () => {
    expect(
      await ruleIds(
        'apps/cms/src/env.ts',
        `import { z } from 'zod'; export const env = z.object({ SUPABASE_SECRET_KEY: z.string() }).parse(process.env)`,
      ),
    ).toEqual([RESTRICTED_SYNTAX]);
  });
  it('reports each access once', async () => {
    expect(
      await ruleIds('apps/cms/src/editor/x.ts', `const k = process.env.SUPABASE_SECRET_KEY; const { SUPABASE_SECRET_KEY: j } = process.env`),
    ).toEqual([RESTRICTED_SYNTAX, RESTRICTED_SYNTAX]);
  });
  it('allows other names and strings that merely contain the key', async () => {
    expect(
      await ruleIds(
        'apps/cms/src/editor/x.ts',
        `const a = process.env.OTHER; const SUPABASE_SECRET_KEY_HINT = 1; const s = 'SUPABASE_SECRET_KEY is set'`,
      ),
    ).toEqual([]);
  });
  it.each([['apps/cms/src/privileged/env.ts'], ['tools/cli/src/env.ts']])('allows the name in %s', async (path) => {
    const code =
      `import { env } from 'node:process'; import { z } from 'zod';` +
      ` export const e = z.object({ SUPABASE_SECRET_KEY: z.string() }).parse(env);` +
      ` const k = Reflect.get(env, 'SUPABASE_SECRET_KEY'); const j = globalThis.process.env.SUPABASE_SECRET_KEY`;
    expect(await ruleIds(path, code)).toEqual([]);
  });
  it('exempts only eslint.config.mjs among root files', async () => {
    const code = `const KEY = 'SUPABASE_` + `SECRET_KEY'`;
    expect(await ruleIds('eslint.config.mjs', code)).toEqual([]);
    expect(await ruleIds('vitest.workspace.ts', code)).toEqual([RESTRICTED_SYNTAX]);
  });
});

describe('inline configuration', () => {
  const secretRead = 'const k = process.env.SUPABASE_SECRET_KEY';
  it.each([
    ['// eslint-disable-next-line no-restricted-syntax'],
    ['/* eslint-disable */'],
    ['/* eslint no-restricted-syntax: off */'],
  ])('%s does not silence a secret read', async (comment) => {
    expect(await ruleIds('apps/cms/src/editor/x.ts', `${comment}\n${secretRead}`)).toContain(RESTRICTED_SYNTAX);
  });
  it('does not silence a forbidden import', async () => {
    const code = `// eslint-disable-next-line no-restricted-imports\nimport { c } from '@/privileged/admin-client'`;
    expect(await ruleIds('apps/cms/src/editor/x.ts', code)).toContain(IMPORT);
  });
});

describe('tools/cli', () => {
  const path = 'tools/cli/src/x.ts';
  const adminClient = '../../../apps/cms/src/privileged/admin-client';
  it('forbids importing the admin client statically', async () => {
    expect(await ruleIds(path, `import { c } from '${adminClient}'`)).toEqual([IMPORT]);
  });
  it('forbids importing the admin client dynamically', async () => {
    expect(await ruleIds(path, `import('${adminClient}')`)).toEqual([RESTRICTED_SYNTAX]);
    expect(await ruleIds(path, `require('${adminClient}')`)).toEqual([RESTRICTED_SYNTAX]);
  });
});

describe('alias forms', () => {
  it.each([
    [`import m from '~/modules/labak'`, IMPORT],
    [`import m from '#modules/labak'`, IMPORT],
    [`import m from 'modules/labak'`, IMPORT],
    [`import('~/modules/labak')`, RESTRICTED_SYNTAX],
    [`require('#modules/labak')`, RESTRICTED_SYNTAX],
    [`import('modules/labak')`, RESTRICTED_SYNTAX],
    [`import { c } from '#privileged/admin-client'`, IMPORT],
    [`import('#privileged/admin-client')`, RESTRICTED_SYNTAX],
  ])('forbids %s outside its zone', async (code, ruleId) => {
    expect(await ruleIds('apps/cms/src/editor/x.ts', code)).toEqual([ruleId]);
  });
  it('still allows the registry through each module form', async () => {
    const code = `import a from '~/modules/registry'; import b from '#modules/registry'; import c from 'modules/registry'; import('#modules/registry')`;
    expect(await ruleIds('apps/cms/src/editor/x.ts', code)).toEqual([]);
  });
});

describe('ignores', () => {
  it('lints __tests__/fixtures folders outside tools/checks', async () => {
    expect(await ruleIds('apps/cms/src/editor/__tests__/fixtures/x.ts', `const k = process.env.SUPABASE_SECRET_KEY`)).toEqual([
      RESTRICTED_SYNTAX,
    ]);
  });
  it('still ignores the tools/checks fixtures', async () => {
    expect(await eslint.isPathIgnored(join(root, 'tools/checks/__tests__/fixtures/core-with-slug/bad.ts'))).toBe(true);
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
