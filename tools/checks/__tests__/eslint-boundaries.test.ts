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

const SECRET = 'no-restricted-syntax';
const IMPORT = 'no-restricted-imports';

describe('module imports', () => {
  it('forbids importing a module outside the registry', async () => {
    expect(await ruleIds('apps/cms/src/editor/x.ts', `import m from '@litljomi/module-labak'`)).toContain(IMPORT);
  });
  it('forbids a relative path into modules/ from packages', async () => {
    expect(await ruleIds('packages/sdk/src/x.ts', `import m from '../../../modules/labak/src/index'`)).toContain(IMPORT);
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
  it('forbids reading SUPABASE_SECRET_KEY outside privileged/', async () => {
    expect(await ruleIds('apps/cms/src/editor/x.ts', `const k = process.env.SUPABASE_SECRET_KEY`)).toContain(SECRET);
  });
  it('forbids the computed spelling', async () => {
    expect(await ruleIds('apps/cms/src/editor/x.ts', `const k = process.env['SUPABASE_SECRET_KEY']`)).toContain(SECRET);
  });
  it('forbids destructuring', async () => {
    expect(await ruleIds('apps/cms/src/editor/x.ts', `const { SUPABASE_SECRET_KEY } = process.env`)).toContain(SECRET);
    expect(await ruleIds('apps/cms/src/editor/x.ts', `const { SUPABASE_SECRET_KEY: k } = process.env`)).toContain(SECRET);
  });
  it('applies outside apps/cms too', async () => {
    expect(await ruleIds('packages/sdk/src/x.ts', `const k = process.env.SUPABASE_SECRET_KEY`)).toContain(SECRET);
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
