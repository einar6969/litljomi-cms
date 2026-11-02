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

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The variables every Supabase CLI call on the e2e path must carry. */
const SUPABASE_QUIET = { SUPABASE_NO_UPDATE_NOTIFIER: '1', SUPABASE_TELEMETRY_DISABLED: '1' };

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
 * stack's status in the format asked for (`-o env` or `-o json`).
 */
function fakeSupabase(binDir: string): void {
  mkdirSync(binDir, { recursive: true });
  const bin = join(binDir, 'supabase');
  writeFileSync(
    bin,
    [
      '#!/bin/sh',
      'env > "$FAKE_ENV_OUT"',
      'case "$*" in',
      '  *json*) printf \'%s\\n\' \'{"API_URL":"http://127.0.0.1:54321","DB_URL":"postgresql://postgres:postgres@127.0.0.1:54322/postgres","MAILPIT_URL":"http://127.0.0.1:54324","PUBLISHABLE_KEY":"pk","SECRET_KEY":"sk"}\' ;;',
      '  *) printf \'%s\\n\' \'API_URL="http://127.0.0.1:54321"\' \'PUBLISHABLE_KEY="pk"\' \'SECRET_KEY="sk"\' ;;',
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

/** The env of this process without the variables under test, so a pass never comes from the caller. */
function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  for (const k of ['SUPABASE_NO_UPDATE_NOTIFIER', 'SUPABASE_TELEMETRY_DISABLED', 'NEXT_TELEMETRY_DISABLED']) delete env[k];
  return env;
}

describe('tests/integration/scripts/cms-next.sh', () => {
  /** A copy of the script in a scratch repository whose `next` writes its environment to a file. */
  function scratchRepo(): { script: string; cmsDir: string; bin: string } {
    const script = join(tmp, 'repo', 'tests', 'integration', 'scripts', 'cms-next.sh');
    mkdirSync(dirname(script), { recursive: true });
    copyFileSync(join(repoRoot, 'tests', 'integration', 'scripts', 'cms-next.sh'), script);
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

  function run(script: string, bin: string) {
    return spawnSync('sh', [script, 'build'], {
      encoding: 'utf8',
      env: cleanEnv({
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        FAKE_ENV_OUT: join(tmp, 'supabase.env'),
        FAKE_NEXT_OUT: join(tmp, 'next.env'),
      }),
    });
  }

  it('runs `supabase status` with the update check and telemetry off', () => {
    const { script, bin } = scratchRepo();
    const result = run(script, bin);
    expect(result.status, result.stderr).toBe(0);
    expect(readEnvDump(join(tmp, 'supabase.env'))).toMatchObject(SUPABASE_QUIET);
  });

  it('runs `next` with Next.js telemetry off', () => {
    const { script, bin } = scratchRepo();
    const result = run(script, bin);
    expect(result.status, result.stderr).toBe(0);
    expect(readEnvDump(join(tmp, 'next.env'))).toMatchObject({ NEXT_TELEMETRY_DISABLED: '1' });
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
  it('runs `supabase status` with the update check and telemetry off', () => {
    const bin = join(tmp, 'bin');
    fakeSupabase(bin);
    const envTs = pathToFileURL(join(repoRoot, 'tests', 'integration', 'src', 'env.ts')).href;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(envTs)});`], {
      encoding: 'utf8',
      env: cleanEnv({ PATH: `${bin}:${process.env.PATH ?? ''}`, FAKE_ENV_OUT: join(tmp, 'supabase.env') }),
    });
    expect(result.status, result.stderr).toBe(0);
    expect(readEnvDump(join(tmp, 'supabase.env'))).toMatchObject(SUPABASE_QUIET);
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
  it('starts the web server with Supabase CLI and Next.js network calls off', async () => {
    const path = pathToFileURL(join(repoRoot, 'apps', 'cms', 'playwright.config.ts')).href;
    const { default: config } = (await import(/* @vite-ignore */ path)) as {
      default: { webServer: { env: Record<string, string> } };
    };
    expect(config.webServer.env).toMatchObject({ ...SUPABASE_QUIET, NEXT_TELEMETRY_DISABLED: '1' });
  });
});
