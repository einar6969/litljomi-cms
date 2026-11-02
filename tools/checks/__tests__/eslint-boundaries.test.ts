import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { afterEach, describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const eslint = new ESLint({ cwd: root });

async function ruleIds(path: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: join(root, path) });
  // Messages without a rule id are parse errors ("fatal:") or ESLint's own notes ("note:").
  return (result?.messages ?? []).map((m) => m.ruleId ?? `${m.fatal ? 'fatal' : 'note'}:${m.message}`);
}

const RESTRICTED_SYNTAX = 'no-restricted-syntax';
const IMPORT = 'no-restricted-imports';

const tempDirs: string[] = [];
/** A fresh temp directory, removed after the test. */
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('module imports', () => {
  it('forbids importing a module outside the registry', async () => {
    expect(await ruleIds('apps/cms/src/editor/x.ts', `import m from '@litljomi/module-labak'`)).toEqual([IMPORT]);
  });
  it('forbids a relative path into modules/ from packages', async () => {
    expect(await ruleIds('packages/sdk/src/x.ts', `import m from '../../../modules/labak/src/index'`)).toEqual([IMPORT]);
  });
  // Static imports are reported by the import rule, dynamic ones by the syntax rule.
  it.each([
    [`import m from '@/modules/labak/x'`, IMPORT],
    [`import m from './modules/labak/x'`, IMPORT],
    [`import('@litljomi/module-labak')`, RESTRICTED_SYNTAX],
    [`require('@litljomi/module-labak')`, RESTRICTED_SYNTAX],
    ['import(`@litljomi/module-labak`)', RESTRICTED_SYNTAX],
    [`import('@/modules/labak/x')`, RESTRICTED_SYNTAX],
    [`require('./modules/labak/x')`, RESTRICTED_SYNTAX],
    [`import('../../modules/labak/x')`, RESTRICTED_SYNTAX],
  ])('forbids %s outside the registry', async (code, ruleId) => {
    expect(await ruleIds('apps/cms/src/editor/x.ts', code)).toEqual([ruleId]);
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
  it('allows the registry with a file extension', async () => {
    expect(await ruleIds('apps/cms/src/editor/x.ts', `import r from '@/modules/registry.ts'; import('./modules/registry.js')`)).toEqual([]);
  });
});

// The registry is exempt only when `registry` (optionally with an extension) is the last segment,
// so a path that normalizes elsewhere (`registry.x/../labak`) or climbs out with `..` is not.
describe('registry exception', () => {
  it.each([
    [`import m from '@/modules/registry.ts/../labak'`, IMPORT],
    [`import m from '@/modules/registry./../labak'`, IMPORT],
    [`import m from '#modules/registry.x/../labak'`, IMPORT],
    [`import m from '../../../../modules/registry.x/../labak/src'`, IMPORT],
    [`import('modules/registry.x/../labak')`, RESTRICTED_SYNTAX],
    [`import m from '@/modules/registry/../labak'`, IMPORT],
    [`import m from '@/modules/../modules/registry'`, IMPORT],
    [`require('./modules/registry/..')`, RESTRICTED_SYNTAX],
  ])('forbids %s in apps', async (code, ruleId) => {
    expect(await ruleIds('apps/cms/src/editor/x.ts', code)).toEqual([ruleId]);
  });
  it.each([
    [`import m from '../../../modules/registry.x/../labak/src/index'`, IMPORT],
    [`require('../../../modules/registry.x/../labak/src/index')`, RESTRICTED_SYNTAX],
  ])('forbids %s in packages', async (code, ruleId) => {
    expect(await ruleIds('packages/sdk/src/x.ts', code)).toEqual([ruleId]);
  });
  it.each([
    [`import { c } from '@/privileged/../privileged/admin-client'`, IMPORT],
    [`import('#privileged/x/../admin-client')`, RESTRICTED_SYNTAX],
  ])('forbids %s outside privileged/ (a `..` after privileged/ is not exempt either)', async (code, ruleId) => {
    expect(await ruleIds('apps/cms/src/editor/x.ts', code)).toEqual([ruleId]);
  });
});

describe('admin client', () => {
  it('forbids the admin client outside privileged/', async () => {
    expect(await ruleIds('apps/cms/src/editor/x.ts', `import { createAdminClient } from '@/privileged/admin-client'`)).toEqual([IMPORT]);
  });
  it('forbids a relative path into privileged/ outside privileged/', async () => {
    expect(await ruleIds('apps/cms/src/editor/x.ts', `import { c } from '../privileged/admin-client'`)).toEqual([IMPORT]);
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
    // Two reports, not a typo: the path matches both the privileged/ selector and the apps/ selector.
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
    expect(await ruleIds('apps/cms/src/editor/x.ts', `const k = process.env.SUPABASE_SECRET_KEY`)).toEqual([RESTRICTED_SYNTAX]);
  });
  it('forbids the computed spelling', async () => {
    expect(await ruleIds('apps/cms/src/editor/x.ts', `const k = process.env['SUPABASE_SECRET_KEY']`)).toEqual([RESTRICTED_SYNTAX]);
  });
  it('forbids destructuring', async () => {
    expect(await ruleIds('apps/cms/src/editor/x.ts', `const { SUPABASE_SECRET_KEY } = process.env`)).toEqual([RESTRICTED_SYNTAX]);
    expect(await ruleIds('apps/cms/src/editor/x.ts', `const { SUPABASE_SECRET_KEY: k } = process.env`)).toEqual([RESTRICTED_SYNTAX]);
  });
  it('applies outside apps/cms too', async () => {
    expect(await ruleIds('packages/sdk/src/x.ts', `const k = process.env.SUPABASE_SECRET_KEY`)).toEqual([RESTRICTED_SYNTAX]);
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
  // Shorthand syntax holds the name in two nodes at the same place; it is still one report.
  it.each([
    [`const { env: { SUPABASE_SECRET_KEY } } = process`],
    [`function f({ SUPABASE_SECRET_KEY } = process.env) {}`],
    [`const { SUPABASE_SECRET_KEY } = process.env as Record<string, string>`],
    [`({ SUPABASE_SECRET_KEY } = process.env)`],
    [`const { SUPABASE_SECRET_KEY = 'x' } = env`],
    [`const o = { SUPABASE_SECRET_KEY }`],
    [`import { SUPABASE_SECRET_KEY } from '@/env'`],
    [`export { SUPABASE_SECRET_KEY } from '@/env'`],
  ])('reports the shorthand %s exactly once', async (code) => {
    expect(await ruleIds('apps/cms/src/editor/x.ts', code)).toEqual([RESTRICTED_SYNTAX]);
  });
  it.each([
    [`import { SUPABASE_SECRET_KEY as k } from '@/env'`],
    [`import { k as SUPABASE_SECRET_KEY } from '@/env'`],
    [`export { SUPABASE_SECRET_KEY as k } from '@/env'`],
    [`export { k as SUPABASE_SECRET_KEY } from '@/env'`],
    [`const { k: SUPABASE_SECRET_KEY } = env`],
    [`const { SUPABASE_SECRET_KEY: k = 'x' } = env`],
  ])('still reports the renamed %s', async (code) => {
    expect(await ruleIds('apps/cms/src/editor/x.ts', code)).toEqual([RESTRICTED_SYNTAX]);
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
  // ESLint notes that the comment has no effect, then reports the violation.
  const ignoredComment = expect.stringMatching(/^note:.*noInlineConfig/);
  it.each([
    ['// eslint-disable-next-line no-restricted-syntax'],
    ['/* eslint-disable */'],
    ['/* eslint no-restricted-syntax: off */'],
  ])('%s does not silence a secret read', async (comment) => {
    expect(await ruleIds('apps/cms/src/editor/x.ts', `${comment}\n${secretRead}`)).toEqual([ignoredComment, RESTRICTED_SYNTAX]);
  });
  it('does not silence a forbidden import', async () => {
    const code = `// eslint-disable-next-line no-restricted-imports\nimport { c } from '@/privileged/admin-client'`;
    expect(await ruleIds('apps/cms/src/editor/x.ts', code)).toEqual([ignoredComment, IMPORT]);
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
    expect(await ruleIds('packages/sdk/src/x.ts', `import x from '../../../apps/cms/src/x'`)).toEqual([IMPORT]);
  });
  it('forbids modules importing from apps', async () => {
    expect(await ruleIds('modules/labak/src/x.ts', `import x from '../../../apps/cms/src/x'`)).toEqual([IMPORT]);
  });
});

// ESLint 10 (and ESLint 9 with the v10_config_lookup_from_file flag) looks up the config next to
// each file, so a nested eslint.config.* would replace the root config for its folder. The lint
// script names the root config, which keeps it in force everywhere.
describe('lint script', () => {
  const lintArgs = (): string[] => {
    const script: string = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts.lint;
    const [command, ...args] = script.split(/\s+/);
    expect(command).toBe('eslint');
    return args;
  };
  const eslintBin = join(root, 'node_modules', 'eslint', 'bin', 'eslint.js');

  it('ignores a nested config that turns the boundary rules off', () => {
    const dir = tempDir('lint-lookup-');
    copyFileSync(join(root, 'eslint.config.mjs'), join(dir, 'eslint.config.mjs'));
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'));
    mkdirSync(join(dir, 'apps', 'cms', 'src', 'editor'), { recursive: true });
    writeFileSync(
      join(dir, 'apps', 'cms', 'eslint.config.mjs'),
      `export default [{ files: ['**/*.ts'], rules: { 'no-restricted-syntax': 'off', 'no-restricted-imports': 'off' } }];\n`,
    );
    writeFileSync(join(dir, 'apps', 'cms', 'src', 'editor', 'x.ts'), 'export const k = process.env.SUPABASE_SECRET_KEY;\n');
    const lint = (args: string[]) =>
      spawnSync(process.execPath, [eslintBin, ...args], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, ESLINT_FLAGS: 'v10_config_lookup_from_file' },
      });

    // Without the root config named, the nested config wins: the setup really is a bypass.
    expect(lint(['.']).status).toBe(0);

    const result = lint(lintArgs());
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(join('apps', 'cms', 'src', 'editor', 'x.ts'));
    expect(result.stdout).toContain('no-restricted-syntax');
  }, 30_000);
});

describe('rich-text editor entry', () => {
  it.each([
    [`import { x } from '@litljomi/rich-text/editor'`, IMPORT],
    [`import { x } from '@litljomi/rich-text/editor/extra'`, IMPORT],
    [`import { x } from '../../rich-text/src/tiptap'`, IMPORT],
    [`import { x } from '../../rich-text/src/./tiptap'`, IMPORT],
    [`import { x } from '../../rich-text/./src/tiptap.ts'`, IMPORT],
    [`import { x } from '../../rich-text/src/../src/tiptap'`, IMPORT],
    [`import { x } from '..\\\\..\\\\rich-text\\\\src\\\\tiptap'`, IMPORT],
    [`import('@litljomi/rich-text/editor')`, RESTRICTED_SYNTAX],
    [`require('@litljomi/rich-text/editor')`, RESTRICTED_SYNTAX],
    ['import(`@litljomi/rich-text/editor`)', RESTRICTED_SYNTAX],
  ])('forbids %s in packages and modules', async (code, ruleId) => {
    expect(await ruleIds('packages/schema/src/x.ts', code)).toEqual([ruleId]);
    expect(await ruleIds('modules/labak/src/x.ts', code)).toEqual([ruleId]);
  });
  it('allows the CMS app to import the editor entry', async () => {
    expect(await ruleIds('apps/cms/src/editor/x.ts', `import { x } from '@litljomi/rich-text/editor'; import('@litljomi/rich-text/editor')`)).toEqual([]);
  });
  it('allows the main entry from packages', async () => {
    expect(await ruleIds('packages/schema/src/x.ts', `import { x } from '@litljomi/rich-text'`)).toEqual([]);
  });
  // Spec §3.1: a module depends only on the schema package and core extension-point types.
  it.each([
    [`import { x } from '@litljomi/rich-text'`, IMPORT],
    [`import { x } from '../../../packages/rich-text/src/index'`, IMPORT],
    [`import('@litljomi/rich-text')`, RESTRICTED_SYNTAX],
  ])('forbids %s in modules', async (code, ruleId) => {
    expect(await ruleIds('modules/labak/src/x.ts', code)).toEqual([ruleId]);
  });
  it('lets the rich-text package import its own files', async () => {
    expect(await ruleIds('packages/rich-text/src/x.ts', `import { x } from './tiptap.ts'; import { y } from '../tiptap'`)).toEqual([]);
  });
});

describe('module-to-module imports', () => {
  it.each([
    [`import m from '@litljomi/module-demo'`, IMPORT],
    [`import m from '@litljomi/module-demo/src/index'`, IMPORT],
    [`import m from '../../../modules/demo/src/index'`, IMPORT],
    [`import m from 'modules/demo'`, IMPORT],
    [`import('@litljomi/module-demo')`, RESTRICTED_SYNTAX],
    [`require('../../../modules/demo/src/index')`, RESTRICTED_SYNTAX],
    ['import(`@litljomi/module-demo`)', RESTRICTED_SYNTAX],
  ])('forbids %s inside a module', async (code, ruleId) => {
    expect(await ruleIds('modules/labak/src/x.ts', code)).toEqual([ruleId]);
  });
  it('allows a module to import the schema package, its own files and its fixtures', async () => {
    expect(
      await ruleIds('modules/labak/src/x.ts', `import { x } from '@litljomi/cms-schema'; import { y } from './y.ts'; import f from '../fixtures/news.json'`),
    ).toEqual([]);
  });
});

// Decision 35: the worker and cron route handlers may import the pipeline entry from privileged/
// (and internal-auth, their secret check), and nothing else from it; the secret-key and module
// rules still apply to them.
describe('worker and cron route exception', () => {
  const ROUTES = ['apps/cms/src/app/api/internal/worker/route.ts', 'apps/cms/src/app/api/cron/sweep/route.ts'];
  const pipelineImports = [
    `import { sweep } from '@/privileged/worker/pipeline'`,
    `import { sweep } from '@/privileged/worker/pipeline.ts'`,
    `import { sweep } from '../../../../privileged/worker/pipeline'`,
    `import('@/privileged/worker/pipeline')`,
    `import { verifyCronSecret } from '@/privileged/internal-auth'`,
    `import { verifyCronSecret } from '../../../../privileged/internal-auth.ts'`,
  ];
  it.each(ROUTES)('lets %s import the pipeline entry', async (path) => {
    expect(await ruleIds(path, pipelineImports.join('; '))).toEqual([]);
  });
  it.each(ROUTES.flatMap((path) => [
    [path, `import { createAdminClient } from '@/privileged/admin-client'`, IMPORT],
    [path, `import { x } from '@/privileged/worker/process-request'`, IMPORT],
    [path, `import { x } from '@/privileged/worker/pipeline/../../admin-client'`, IMPORT],
    [path, `import { x } from '@/privileged/worker/pipeline.ts/../../admin-client'`, IMPORT],
    [path, `import { x } from '@/privileged/./worker/pipeline'`, IMPORT],
    [path, `import { x } from '@/privileged\\\\worker\\\\pipeline'`, IMPORT],
    [path, `import { x } from '@/privileged\\\\worker/pipeline'`, IMPORT],
    [path, `import { x } from '@/privileged/worker'`, IMPORT],
    [path, `import { x } from '@/privileged/internal-auth/../admin-client'`, IMPORT],
    [path, `import { x } from '@/privileged/worker/internal-auth'`, IMPORT],
    [path, `import('@/privileged/admin-client')`, RESTRICTED_SYNTAX],
    [path, `require('../../../../privileged/admin-client')`, RESTRICTED_SYNTAX],
  ]))('still forbids, in %s, %s', async (path, code, ruleId) => {
    expect(await ruleIds(path, code)).toEqual([ruleId]);
  });
  it.each(ROUTES)('keeps the secret-key and module rules in %s', async (path) => {
    expect(await ruleIds(path, `const k = process.env.SUPABASE_SECRET_KEY`)).toEqual([RESTRICTED_SYNTAX]);
    expect(await ruleIds(path, `import m from '@litljomi/module-labak'`)).toEqual([IMPORT]);
    expect(await ruleIds(path, `import('@/modules/labak/x')`)).toEqual([RESTRICTED_SYNTAX]);
  });
  // The exception is the two exact files: siblings, other routes and other extensions are not covered.
  it.each([
    'apps/cms/src/app/api/internal/worker/handler.ts',
    'apps/cms/src/app/api/internal/worker/route.tsx',
    'apps/cms/src/app/api/internal/worker/x/route.ts',
    'apps/cms/src/app/api/internal/other/route.ts',
    'apps/cms/src/app/api/cron/route.ts',
    'apps/cms/src/app/api/cron/sweep/route.js',
    'apps/cms/src/app/api/cron/sweep/__tests__/route.ts',
    'apps/cms/src/app/(editor)/route.ts',
    'apps/cms/src/app/route.ts',
    'apps/demo-site/src/app/api/cron/sweep/route.ts',
  ])('does not cover %s', async (path) => {
    expect(await ruleIds(path, `import { sweep } from '@/privileged/worker/pipeline'`)).toEqual([IMPORT]);
  });
  it('applies the exception to exactly the two route files', async () => {
    const config = (path: string) => eslint.calculateConfigForFile(join(root, path));
    const rule = async (path: string) => JSON.stringify((await config(path)).rules['no-restricted-imports']);
    const exempt = await rule(ROUTES[0]!);
    expect(await rule(ROUTES[1]!)).toBe(exempt);
    expect(await rule('apps/cms/src/app/api/internal/worker/x.ts')).not.toBe(exempt);
  });
});

// Decision 35 (Task 19): triggerWorker lives outside privileged/, in lib/, so the editor's publish
// action can call it. It needs no Supabase credentials, and lib/ (outside lib/supabase) gets no
// exception: privileged/, the secret key and Supabase libraries stay forbidden there.
describe('lib/worker-trigger.ts', () => {
  const PATH = 'apps/cms/src/lib/worker-trigger.ts';
  it('lints clean as written', async () => {
    const code = readFileSync(join(root, PATH), 'utf8');
    expect(await ruleIds(PATH, code)).toEqual([]);
  });
  it.each([
    [`import { createAdminClient } from '@/privileged/admin-client'`, IMPORT],
    [`import { processRequestById } from '../privileged/worker/process-request'`, IMPORT],
    [`import { createClient } from '@supabase/supabase-js'`, IMPORT],
    [`const k = process.env.SUPABASE_SECRET_KEY`, RESTRICTED_SYNTAX],
  ])('forbids %s there', async (code, ruleId) => {
    expect(await ruleIds(PATH, code)).toEqual([ruleId]);
  });
});

describe('admin client from editor routes', () => {
  it.each([
    'apps/cms/src/app/(editor)/t/[tenant]/actions.ts',
    'apps/cms/src/app/(editor)/t/[tenant]/[type]/page.tsx',
    'apps/cms/src/app/(editor)/layout.tsx',
  ])('forbids importing admin-client from %s', async (path) => {
    expect(await ruleIds(path, `import { createAdminClient } from '@/privileged/admin-client'`)).toEqual([IMPORT]);
    expect(await ruleIds(path, `import { createAdminClient } from '../../../../privileged/admin-client'`)).toEqual([IMPORT]);
    expect(await ruleIds(path, `import('@/privileged/admin-client')`)).toEqual([RESTRICTED_SYNTAX]);
  });
});

// Decision C-S2b (Task 17): in apps/cms, Supabase clients are created only in src/lib/supabase
// (publishable key) and src/privileged (secret key). Other code takes a client from those files.
describe('Supabase client libraries', () => {
  const code = [
    `import { createClient } from '@supabase/supabase-js'`,
    `import type { SupabaseClient } from '@supabase/supabase-js'`,
    `import { createServerClient } from '@supabase/ssr'`,
    `import { x } from '@supabase/supabase-js/dist/module'`,
  ];
  it.each(code)('forbids %s in apps/cms outside lib/supabase and privileged/', async (line) => {
    expect(await ruleIds('apps/cms/src/app/(editor)/t/[tenant]/actions.ts', line)).toEqual([IMPORT]);
    expect(await ruleIds('apps/cms/src/editor/x.ts', line)).toEqual([IMPORT]);
  });
  it('forbids the dynamic form', async () => {
    expect(await ruleIds('apps/cms/src/editor/x.ts', `import('@supabase/supabase-js')`)).toEqual([RESTRICTED_SYNTAX]);
  });
  it.each(['apps/cms/src/lib/supabase/server.ts', 'apps/cms/src/lib/supabase/browser.ts', 'apps/cms/src/privileged/admin-client.ts'])(
    'allows them in %s',
    async (path) => {
      expect(await ruleIds(path, code.join('; '))).toEqual([]);
    },
  );
  it('keeps the secret key out of lib/supabase', async () => {
    expect(await ruleIds('apps/cms/src/lib/supabase/server.ts', `const k = process.env.SUPABASE_SECRET_KEY`)).toEqual([RESTRICTED_SYNTAX]);
    expect(await ruleIds('apps/cms/src/lib/supabase/server.ts', `import { c } from '@/privileged/admin-client'`)).toEqual([IMPORT]);
  });
  it.each(['packages/sdk/src/x.ts', 'modules/labak/src/x.ts'])('forbids them in %s', async (path) => {
    expect(await ruleIds(path, `import { createClient } from '@supabase/supabase-js'`)).toEqual([IMPORT]);
    expect(await ruleIds(path, `require('@supabase/ssr')`)).toEqual([RESTRICTED_SYNTAX]);
  });
});

// tests/integration holds the local secret key at run time (secretClient()), so app code reaches
// it only from test files.
describe('integration-test helpers', () => {
  it.each([
    `import { secretClient } from '../../../../tests/integration/src/clients'`,
    `import { secretClient } from '@litljomi/integration-tests/src/clients'`,
  ])('forbids %s in app source', async (line) => {
    expect(await ruleIds('apps/cms/src/privileged/worker/x.ts', line)).toEqual([IMPORT]);
    expect(await ruleIds('apps/cms/src/editor/x.ts', line)).toEqual([IMPORT]);
  });
  it('allows them in app test files', async () => {
    const line = `import { secretClient } from '../../../../../tests/integration/src/clients'`;
    expect(await ruleIds('apps/cms/src/privileged/worker/__tests__/x.integration.test.ts', line)).toEqual([]);
  });
});

// S6: packages and modules must not reach an app through its workspace package name either.
describe('app package names', () => {
  it.each([
    [`import x from 'cms'`, IMPORT],
    [`import x from 'cms/src/privileged/admin-client'`, IMPORT],
    [`import x from 'demo-site/src/x'`, IMPORT],
    [`import('cms')`, RESTRICTED_SYNTAX],
  ])('forbids %s in packages and modules', async (code, ruleId) => {
    expect(await ruleIds('packages/sdk/src/x.ts', code)).toContain(ruleId);
    expect(await ruleIds('modules/labak/src/x.ts', code)).toContain(ruleId);
  });
  it('allows packages whose names merely start with an app name', async () => {
    expect(await ruleIds('packages/sdk/src/x.ts', `import x from 'cmsx'; import y from 'demo-sites'`)).toEqual([]);
  });
});

// Task 14 review: only the editor entry (packages/rich-text/src/tiptap.ts) and its tests load Tiptap.
describe('Tiptap and ProseMirror imports', () => {
  it.each([
    [`import { Editor } from '@tiptap/core'`, IMPORT],
    [`import { EditorState } from '@tiptap/pm/state'`, IMPORT],
    [`import { Schema } from 'prosemirror-model'`, IMPORT],
    [`import('@tiptap/core')`, RESTRICTED_SYNTAX],
    [`require('prosemirror-state')`, RESTRICTED_SYNTAX],
  ])('forbids %s in packages outside the editor entry', async (code, ruleId) => {
    expect(await ruleIds('packages/rich-text/src/index.ts', code)).toEqual([ruleId]);
    expect(await ruleIds('packages/rich-text/src/renderer.tsx', code)).toEqual([ruleId]);
    expect(await ruleIds('packages/schema/src/x.ts', code)).toEqual([ruleId]);
    expect(await ruleIds('packages/sdk/src/x.ts', code)).toEqual([ruleId]);
  });
  it('forbids them in modules', async () => {
    expect(await ruleIds('modules/labak/src/x.ts', `import { Editor } from '@tiptap/core'`)).toEqual([IMPORT]);
  });
  it('allows them in the editor entry and its tests', async () => {
    const code = `import { Editor } from '@tiptap/core'; import StarterKit from '@tiptap/starter-kit'; import { Schema } from 'prosemirror-model'`;
    expect(await ruleIds('packages/rich-text/src/tiptap.ts', code)).toEqual([]);
    expect(await ruleIds('packages/rich-text/src/__tests__/tiptap.test.ts', code)).toEqual([]);
  });
  it('keeps the other package rules in the editor entry', async () => {
    expect(await ruleIds('packages/rich-text/src/tiptap.ts', `const k = process.env.SUPABASE_SECRET_KEY`)).toEqual([RESTRICTED_SYNTAX]);
    expect(await ruleIds('packages/rich-text/src/tiptap.ts', `import m from '@litljomi/module-labak'`)).toEqual([IMPORT]);
    expect(await ruleIds('packages/rich-text/src/tiptap.ts', `import x from '../../../apps/cms/src/x'`)).toEqual([IMPORT]);
  });
  it('allows the CMS app to use Tiptap', async () => {
    expect(await ruleIds('apps/cms/src/editor/x.ts', `import { Editor } from '@tiptap/core'`)).toEqual([]);
  });
});

// N1: a backslash counts as a path separator in every boundary path rule.
describe('backslash separators', () => {
  it.each([
    ['apps/cms/src/editor/x.ts', `import { c } from '../privileged\\\\admin-client'`, IMPORT],
    ['apps/cms/src/editor/x.ts', `import('@/privileged\\\\admin-client')`, RESTRICTED_SYNTAX],
    ['apps/cms/src/editor/x.ts', `import m from '@/modules\\\\labak'`, IMPORT],
    ['apps/cms/src/editor/x.ts', `import m from '@/modules/registry.x\\\\..\\\\labak'`, IMPORT],
    ['apps/cms/src/editor/x.ts', `import('./modules/registry.x\\\\..\\\\labak')`, RESTRICTED_SYNTAX],
    ['apps/cms/src/editor/x.ts', `import m from '..\\\\modules\\\\registry.x\\\\..\\\\labak'`, IMPORT],
    ['packages/sdk/src/x.ts', `import x from '..\\\\..\\\\..\\\\apps\\\\cms/src/x'`, IMPORT],
    ['modules/labak/src/x.ts', `import m from '..\\\\..\\\\demo\\\\src\\\\index'`, IMPORT],
  ])('in %s, forbids %s', async (path, code, ruleId) => {
    expect(await ruleIds(path, code)).toEqual([ruleId]);
  });
  it('still allows the registry', async () => {
    expect(await ruleIds('apps/cms/src/editor/x.ts', `import r from '..\\\\modules\\\\registry'`)).toEqual([]);
  });
});

// Task 16 review: a module reaching a sibling module by a relative path. The rule matches the
// names of the folders under modules/ as path segments of a relative specifier.
describe('module-to-module relative imports', () => {
  it.each([
    [`import m from '../../demo/src/index'`, IMPORT],
    [`import m from '../../demo'`, IMPORT],
    [`import('../../demo/src/index.ts')`, RESTRICTED_SYNTAX],
    [`export * from '../../demo/src/index'`, IMPORT],
    [`import '../../demo/fixtures/event.json'`, IMPORT],
    [`import m from '../../labak/../demo/src/index'`, IMPORT],
  ])('forbids %s from modules/labak', async (code, ruleId) => {
    expect(await ruleIds('modules/labak/src/x.ts', code)).toEqual([ruleId]);
  });
  it('forbids the reverse direction too', async () => {
    expect(await ruleIds('modules/demo/src/x.ts', `import m from '../../labak/src/index'`)).toEqual([IMPORT]);
  });
  it('allows a module its own files by relative path, including through its own folder name', async () => {
    expect(await ruleIds('modules/labak/src/a/x.ts', `import a from '../b'; import f from '../../fixtures/news.json'; import i from '../../../labak/src/index'`)).toEqual([]);
  });
  // Documented limit: a specifier that reaches a sibling without naming it (an absolute path, a
  // path built at run time, or `..` past the modules folder and back through a link) is not caught.
  it('does not catch an absolute path to a sibling module (documented limit)', async () => {
    expect(await ruleIds('modules/labak/src/x.ts', `import m from '/repo/modules-copy/x'`)).toEqual([]);
  });
});
