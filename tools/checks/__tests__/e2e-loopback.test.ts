// The CMS's Playwright run (`pnpm --filter cms e2e`) runs outside the Bash sandbox on Einar's
// condition that it reaches only loopback and this repository (decision 37.3; Einar, 2026-11-02).
// Everything on that path that starts a CLI must turn the CLI's own network calls off: the Supabase
// CLI's GitHub release check (only SUPABASE_NO_UPDATE_NOTIFIER stops it), its telemetry, and Next.js
// telemetry. And cms-next.sh must refuse to run when Next.js would load an apps/cms/.env* file,
// since outside the sandbox the .env read denial no longer applies.
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MANAGED_CLI_VARIABLES, stackSlot } from '../../stack/slot.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The variables every Supabase CLI call on the e2e path must carry. */
const SUPABASE_QUIET = { SUPABASE_NO_UPDATE_NOTIFIER: '1', SUPABASE_TELEMETRY_DISABLED: '1' };
/** The stack slot this test run is in (the modules imported below read it too). */
const STACK = stackSlot();
const SLOT_2 = stackSlot({ CMS_STACK_SLOT: '2' });

// Only `spawn` is replaced (global-setup.ts starts the seed with it); `spawnSync`, which these tests
// use to run cms-next.sh for real, keeps Node's own implementation.
const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: spawnMock };
});

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'e2e-loopback-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  spawnMock.mockReset();
});

/**
 * A fake `supabase` on PATH: it writes its environment to $FAKE_ENV_OUT and prints a loopback
 * stack's status in the format asked for (`-o env` or `-o json`), on the ports the slot's
 * SUPABASE_*_PORT overrides name, as the real CLI does. $FAKE_API_URL replaces the env format's
 * API_URL, $FAKE_JSON_API_PORT the json format's API port; $FAKE_STATUS_ERROR makes it fail with that
 * message on stderr, as the real CLI does without a running stack.
 */
function fakeSupabase(binDir: string): void {
  mkdirSync(binDir, { recursive: true });
  const bin = join(binDir, 'supabase');
  writeFileSync(
    bin,
    [
      '#!/bin/sh',
      'env > "$FAKE_ENV_OUT"',
      'if [ -n "${FAKE_STATUS_ERROR:-}" ]; then echo "$FAKE_STATUS_ERROR" >&2; exit 1; fi',
      'case "$*" in',
      '  *json*) printf \'{"API_URL":"http://127.0.0.1:%s","DB_URL":"postgresql://postgres:postgres@127.0.0.1:%s/postgres","MAILPIT_URL":"http://127.0.0.1:%s","PUBLISHABLE_KEY":"pk","SECRET_KEY":"sk"}\\n\' "${FAKE_JSON_API_PORT:-${SUPABASE_API_PORT:-54321}}" "${SUPABASE_DB_PORT:-54322}" "${SUPABASE_LOCAL_SMTP_PORT:-54324}" ;;',
      '  *) printf \'%s\\n\' "API_URL=\\"${FAKE_API_URL:-http://127.0.0.1:${SUPABASE_API_PORT:-54321}}\\"" \'PUBLISHABLE_KEY="pk"\' \'SECRET_KEY="sk"\' ;;',
      'esac',
      '',
    ].join('\n'),
  );
  chmodSync(bin, 0o755);
}

/** Reads a file written by `env` into a map. */
function readEnvDump(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

/**
 * The env of this process without the variables under test (the quieting ones, the stack slot and
 * its CLI overrides), so a pass never comes from the caller; then `extra`.
 */
function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of ['SUPABASE_NO_UPDATE_NOTIFIER', 'SUPABASE_TELEMETRY_DISABLED', 'NEXT_TELEMETRY_DISABLED', 'CMS_STACK_SLOT', ...MANAGED_CLI_VARIABLES]) delete env[k];
  return { ...env, ...extra };
}

describe('tests/integration/scripts/cms-next.sh', () => {
  /** A copy of the script in a scratch repository whose `next` writes its environment to a file. */
  function scratchRepo(): { script: string; cmsDir: string; bin: string } {
    const script = join(tmp, 'repo', 'tests', 'integration', 'scripts', 'cms-next.sh');
    mkdirSync(dirname(script), { recursive: true });
    copyFileSync(join(repoRoot, 'tests', 'integration', 'scripts', 'cms-next.sh'), script);
    // cms-next.sh runs `supabase status` through the stack slot's wrapper.
    const stackDir = join(tmp, 'repo', 'tools', 'stack');
    mkdirSync(stackDir, { recursive: true });
    for (const f of ['slot.ts', 'supabase.ts', 'package.json']) copyFileSync(join(repoRoot, 'tools', 'stack', f), join(stackDir, f));
    const cmsDir = join(tmp, 'repo', 'apps', 'cms');
    const nextBin = join(cmsDir, 'node_modules', 'next', 'dist', 'bin', 'next');
    mkdirSync(dirname(nextBin), { recursive: true });
    writeFileSync(
      nextBin,
      "require('node:fs').writeFileSync(process.env.FAKE_NEXT_OUT, Object.entries(process.env).map(([k, v]) => k + '=' + v).join('\\n'));\n",
    );
    const bin = join(tmp, 'bin');
    fakeSupabase(bin);
    return { script, cmsDir, bin };
  }

  function run(script: string, bin: string, fake: Record<string, string> = {}) {
    return spawnSync('sh', [script, 'build'], {
      encoding: 'utf8',
      env: cleanEnv({
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        FAKE_ENV_OUT: join(tmp, 'supabase.env'),
        FAKE_NEXT_OUT: join(tmp, 'next.env'),
        ...fake,
      }),
    });
  }

  it('runs `supabase status` with the update check and telemetry off', () => {
    const { script, bin } = scratchRepo();
    const result = run(script, bin);
    expect(result.status, result.stderr).toBe(0);
    expect(readEnvDump(join(tmp, 'supabase.env'))).toMatchObject(SUPABASE_QUIET);
  });

  it('runs `supabase status` on slot 1 with no stack overrides', () => {
    const { script, bin } = scratchRepo();
    const result = run(script, bin);
    expect(result.status, result.stderr).toBe(0);
    const supabaseEnv = readEnvDump(join(tmp, 'supabase.env'));
    for (const name of MANAGED_CLI_VARIABLES) expect(supabaseEnv, name).not.toHaveProperty(name);
    expect(readEnvDump(join(tmp, 'next.env'))).toMatchObject({ NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' });
  });

  it('runs `supabase status` on slot 2 with its overrides, and gives next slot 2’s stack', () => {
    const { script, bin } = scratchRepo();
    const result = run(script, bin, { CMS_STACK_SLOT: '2' });
    expect(result.status, result.stderr).toBe(0);
    expect(readEnvDump(join(tmp, 'supabase.env'))).toMatchObject({ ...SUPABASE_QUIET, ...SLOT_2.cliEnv });
    expect(readEnvDump(join(tmp, 'next.env'))).toMatchObject({ NEXT_PUBLIC_SUPABASE_URL: SLOT_2.apiUrl });
  });

  it('refuses an invalid slot before running next', () => {
    const { script, bin } = scratchRepo();
    const result = run(script, bin, { CMS_STACK_SLOT: '9' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('CMS_STACK_SLOT must be unset, 1 or 2');
    expect(() => readFileSync(join(tmp, 'next.env'))).toThrow();
  });

  it('runs `next` with Next.js telemetry off', () => {
    const { script, bin } = scratchRepo();
    const result = run(script, bin);
    expect(result.status, result.stderr).toBe(0);
    expect(readEnvDump(join(tmp, 'next.env'))).toMatchObject({ NEXT_TELEMETRY_DISABLED: '1' });
  });

  it.each(['http://127.0.0.1:54321', 'http://localhost:54321'])('accepts the loopback stack at %s', (url) => {
    const { script, bin } = scratchRepo();
    const result = run(script, bin, { FAKE_API_URL: url });
    expect(result.status, result.stderr).toBe(0);
    expect(readEnvDump(join(tmp, 'next.env'))).toMatchObject({ NEXT_PUBLIC_SUPABASE_URL: url });
  });

  // C2 cleanup security r1: the port must be digits only, so userinfo cannot smuggle in another host.
  it.each([
    'http://localhost:x@evil.example',
    'http://127.0.0.1:54321@evil.example',
    'http://localhost:54321/@evil.example',
    'http://localhost:',
    'http://localhost:54321x',
    'https://evil.example',
  ])('refuses the stack URL %s before running next', (url) => {
    const { script, bin } = scratchRepo();
    const result = run(script, bin, { FAKE_API_URL: url });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('refusing a non-local stack');
    expect(() => readFileSync(join(tmp, 'next.env'))).toThrow();
  });

  // C2 cleanup security r1: stdout (the keys) is captured; the CLI's own error on stderr is shown.
  it('shows the error of a failing `supabase status`, with a hint, and runs nothing else', () => {
    const { script, bin } = scratchRepo();
    const result = run(script, bin, { FAKE_STATUS_ERROR: 'failed to inspect container health: No such container' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('failed to inspect container health: No such container');
    expect(result.stderr).toContain('pnpm db:start');
    expect(result.stdout).toBe('');
    expect(() => readFileSync(join(tmp, 'next.env'))).toThrow();
  });

  it.each(['.env', '.env.local', '.env.production', '.env.test.local'])(
    'refuses to run when apps/cms/%s exists, before calling supabase or next',
    (name) => {
      const { script, cmsDir, bin } = scratchRepo();
      writeFileSync(join(cmsDir, name), 'X=1\n');
      const result = run(script, bin);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(`apps/cms/${name}`);
      expect(result.stderr).toMatch(/refusing/);
      expect(() => readFileSync(join(tmp, 'supabase.env'))).toThrow();
      expect(() => readFileSync(join(tmp, 'next.env'))).toThrow();
    },
  );
});

describe('tests/integration/src/env.ts', () => {
  const envTs = pathToFileURL(join(repoRoot, 'tests', 'integration', 'src', 'env.ts')).href;
  function load(extra: Record<string, string> = {}) {
    const bin = join(tmp, 'bin');
    fakeSupabase(bin);
    return spawnSync(process.execPath, ['--input-type=module', '-e', `const m = await import(${JSON.stringify(envTs)}); console.log(m.env.apiUrl);`], {
      encoding: 'utf8',
      env: cleanEnv({ PATH: `${bin}:${process.env.PATH ?? ''}`, FAKE_ENV_OUT: join(tmp, 'supabase.env'), ...extra }),
    });
  }

  it('runs `supabase status` with the update check and telemetry off', () => {
    const result = load();
    expect(result.status, result.stderr).toBe(0);
    expect(readEnvDump(join(tmp, 'supabase.env'))).toMatchObject(SUPABASE_QUIET);
    expect(result.stdout.trim()).toBe('http://127.0.0.1:54321');
  });

  it('reads slot 2’s stack with its overrides', () => {
    const result = load({ CMS_STACK_SLOT: '2' });
    expect(result.status, result.stderr).toBe(0);
    expect(readEnvDump(join(tmp, 'supabase.env'))).toMatchObject({ ...SUPABASE_QUIET, ...SLOT_2.cliEnv });
    expect(result.stdout.trim()).toBe(SLOT_2.apiUrl);
  });

  it('refuses a stack that is not the slot’s', () => {
    const result = load({ CMS_STACK_SLOT: '2', FAKE_JSON_API_PORT: '54321' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("refusing the stack at 127.0.0.1:54321: slot 2's stack uses port 54331");
  });
});

describe('apps/cms/e2e/global-setup.ts', () => {
  it('starts the seed script with the update check and telemetry off', async () => {
    spawnMock.mockImplementation(() => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('exit', 0, null));
      return child;
    });
    const path = pathToFileURL(join(repoRoot, 'apps', 'cms', 'e2e', 'global-setup.ts')).href;
    const { default: globalSetup } = (await import(/* @vite-ignore */ path)) as { default: () => Promise<void> };
    await globalSetup();
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0]![2].env).toMatchObject(SUPABASE_QUIET);
  });
});

describe('apps/cms/playwright.config.ts', () => {
  it('starts every web server with Supabase CLI and Next.js network calls off', async () => {
    const path = pathToFileURL(join(repoRoot, 'apps', 'cms', 'playwright.config.ts')).href;
    const { default: config } = (await import(/* @vite-ignore */ path)) as {
      default: { webServer: Array<{ name: string; command: string; env: Record<string, string> }> };
    };
    expect(config.webServer.map((w) => w.name)).toEqual(['cms', 'demo-site']);
    for (const server of config.webServer) expect(server.env, server.name).toMatchObject({ ...SUPABASE_QUIET, NEXT_TELEMETRY_DISABLED: '1' });
    // Each server is given the run's stack slot, so all of them read the same stack.
    for (const server of config.webServer) expect(server.env, server.name).toMatchObject({ CMS_STACK_SLOT: String(STACK.slot) });
    expect(config.webServer[0]!.command).toContain(`start -p ${STACK.ports.cms} -H 127.0.0.1`);
    // The demo site is started by the guarded script, with this Node binary (no package manager).
    expect(config.webServer[1]!.command).toBe(`${JSON.stringify(process.execPath)} e2e/demo-site-server.ts`);
  });
});

describe('apps/cms/e2e/demo-site-server.ts', () => {
  const serverPath = pathToFileURL(join(repoRoot, 'apps', 'cms', 'e2e', 'demo-site-server.ts')).href;
  type Server = { main: (o?: { siteDir?: string }) => Promise<void>; siteEnv: (base?: NodeJS.ProcessEnv) => NodeJS.ProcessEnv };
  const load = async () => (await import(/* @vite-ignore */ serverPath)) as Server;
  const fetchMock = vi.fn<typeof fetch>();
  let exit: { mockRestore(): void };

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    spawnMock.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
      queueMicrotask(() => child.emit('exit', 0, null));
      return child;
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    exit.mockRestore();
    process.exitCode = undefined;
  });

  /** Nothing listens on the demo site's port; the demo tenant's pointer is public. */
  const freePortAndPointer = () =>
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/demo/current.json')) return Response.json({ format: 1, release: 1 });
      throw new TypeError('fetch failed');
    });

  it('gives the site the loopback stack, the seeded secret and Next.js telemetry off', async () => {
    const { siteEnv } = await load();
    const env = siteEnv({});
    expect(env).toMatchObject({ NEXT_TELEMETRY_DISABLED: '1', NODE_ENV: 'production', CMS_TENANT: 'demo' });
    // The slot's stack and CMS (slot 1: 54321 and 3100).
    expect(env.CMS_DELIVERY_BASE_URL).toBe(`${STACK.apiUrl}/storage/v1/object/public/delivery`);
    // Preview (M3-12): the seeded preview secret and the loopback CMS.
    expect(env).toMatchObject({ CMS_PREVIEW_SECRETS: 'demo-preview-s3cr3t-local-test-value-0123', CMS_PREVIEW_BASE_URL: STACK.cmsUrl });
  });

  // Task 25 security r1: the site gets an allowlisted environment, not the whole parent one.
  it('passes the site only the allowlisted parent variables, never a key or secret of the run', async () => {
    const { siteEnv } = await load();
    const env = siteEnv({
      PATH: '/usr/bin',
      HOME: '/home/x',
      TMPDIR: '/tmp/x',
      LANG: 'is_IS.UTF-8',
      SOME_API_KEY: 'key',
      CMS_INTERNAL_SECRET: 'internal',
      CRON_SECRET: 'cron',
      GITHUB_TOKEN: 'gh',
      NODE_OPTIONS: '--require ./x.js',
    });
    expect(env).toMatchObject({ PATH: '/usr/bin', HOME: '/home/x', TMPDIR: '/tmp/x', LANG: 'is_IS.UTF-8' });
    for (const name of ['SOME_API_KEY', 'CMS_INTERNAL_SECRET', 'CRON_SECRET', 'GITHUB_TOKEN', 'NODE_OPTIONS']) expect(env, name).not.toHaveProperty(name);
  });

  it('builds and starts the site on 127.0.0.1 on the slot’s demo-site port (3101 on slot 1), reaching only loopback', async () => {
    freePortAndPointer();
    const siteDir = mkdtempSync(join(tmp, 'site-'));
    const { main } = await load();
    await main({ siteDir });
    expect(spawnMock).toHaveBeenCalledTimes(2);
    type Call = [string, string[], { cwd: string; env: NodeJS.ProcessEnv }];
    const [build, start] = spawnMock.mock.calls as unknown as [Call, Call];
    expect(build[1].slice(1)).toEqual(['build']);
    expect(start[1].slice(1)).toEqual(['start', '-p', String(STACK.ports.demoSite), '-H', '127.0.0.1']);
    for (const call of [build, start]) {
      expect(call[0]).toBe(process.execPath);
      expect(call[2].cwd).toBe(siteDir);
      expect(call[2].env).toMatchObject({ ...SUPABASE_QUIET, NEXT_TELEMETRY_DISABLED: '1' });
    }
    const reached = fetchMock.mock.calls.map(([input]) => new URL(String(input)).hostname);
    expect(reached.length).toBeGreaterThan(0);
    expect(new Set(reached)).toEqual(new Set(['localhost', '127.0.0.1']));
  });

  it.each(['.env', '.env.local', '.env.production'])('refuses to run when apps/demo-site/%s exists, before any request', async (name) => {
    freePortAndPointer();
    const siteDir = mkdtempSync(join(tmp, 'site-'));
    writeFileSync(join(siteDir, name), 'X=1\n');
    const { main } = await load();
    await expect(main({ siteDir })).rejects.toThrow('exit 1');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('refuses to run when the demo site port is already in use', async () => {
    fetchMock.mockResolvedValue(new Response('busy'));
    const { main } = await load();
    await expect(main({ siteDir: mkdtempSync(join(tmp, 'site-')) })).rejects.toThrow('exit 1');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('uses the seeded demo site of the integration fixtures', async () => {
    const demo = (await import(/* @vite-ignore */ pathToFileURL(join(repoRoot, 'apps', 'cms', 'e2e', 'support', 'demo-site.ts')).href)) as {
      DEMO_SITE_URL: string;
      DEMO_SITE_WEBHOOK_SECRET: string;
    };
    const { DEMO_SITE } = (await import(/* @vite-ignore */ pathToFileURL(join(repoRoot, 'tests', 'integration', 'src', 'fixtures.ts')).href)) as {
      DEMO_SITE: { baseUrl: string; webhookSecret: string };
    };
    expect(demo.DEMO_SITE_URL).toBe(DEMO_SITE.baseUrl);
    expect(demo.DEMO_SITE_WEBHOOK_SECRET).toBe(DEMO_SITE.webhookSecret);
  });
});
