// The demo site for the publish e2e (plan Task 25), started by Playwright as a `webServer` and run
// with this Node binary directly (no package manager, so nothing is fetched). Like the local end to
// end (tests/integration/src/end-to-end-local.test.ts), it serves apps/demo-site on DEMO_SITE_PORT,
// the seeded demo site's URL, with the seeded webhook secret, reading the demo tenant's bundles
// from the local stack's public `delivery` bucket.
//
// The site's build reads the tenant's current release, so it can only be built once the demo
// tenant has one. This script therefore announces itself (Playwright's `wait` pattern, so the run
// can go on), waits for the public pointer, then builds and starts the site; the `demo-release` setup
// project (demo-release.setup.ts) makes the first release through the editor when none exists yet,
// then waits for the site.
//
// The e2e run is outside the Bash sandbox on the condition that it reaches only loopback and this
// repository (Einar, 2026-11-02): every URL here passes requireLoopback, the site listens on
// 127.0.0.1 only, Next.js telemetry is off (NO_CLI_NETWORK_ENV), and the script refuses to run when
// an apps/demo-site/.env* file exists, since Next.js would load it. Checked by
// tools/checks/__tests__/e2e-loopback.test.ts.
import { spawn } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import {
  DEMO_DELIVERY_BASE_URL,
  DEMO_SITE_MEDIA_HOST,
  DEMO_SITE_PORT,
  DEMO_SITE_READY_LINE,
  DEMO_SITE_URL,
  DEMO_SITE_WEBHOOK_SECRET,
} from './support/demo-site.ts';
import { NO_CLI_NETWORK_ENV, requireLoopback } from './support/local.ts';

const demoSiteDir = join(import.meta.dirname, '..', '..', 'demo-site');
const nextBin = () => join(dirname(createRequire(join(demoSiteDir, 'package.json')).resolve('next/package.json')), 'dist', 'bin', 'next');
const POINTER_TIMEOUT_MS = 15 * 60_000;
const POLL_MS = 1000;

const fail = (message: string): never => {
  console.error(`demo-site-server: ${message}`);
  process.exit(1);
};

async function reachable(url: string): Promise<boolean> {
  try {
    await fetch(requireLoopback(url), { signal: AbortSignal.timeout(2000), redirect: 'manual' });
    return true;
  } catch {
    return false;
  }
}

/** True once the demo tenant's pointer is public and names a release. */
async function pointerExists(): Promise<boolean> {
  try {
    const response = await fetch(requireLoopback(`${DEMO_DELIVERY_BASE_URL}/demo/current.json`), { redirect: 'error', cache: 'no-store' });
    if (!response.ok) return false;
    const pointer = (await response.json()) as { format?: unknown; release?: unknown };
    return pointer.format === 1 && Number.isSafeInteger(pointer.release);
  } catch {
    return false;
  }
}

function run(siteDir: string, args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const child = spawn(process.execPath, [nextBin(), ...args], { cwd: siteDir, env, stdio: ['ignore', 'inherit', 'inherit'] });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => child.kill(signal));
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

/**
 * The only variables of the parent environment the demo site gets (Task 25 security r1): what Node
 * and Next.js need to run, and nothing of the run's own keys or secrets (the CMS webServer's
 * CMS_INTERNAL_SECRET and CRON_SECRET, or anything else in the caller's shell).
 */
export const SITE_ENV_ALLOWLIST = ['PATH', 'HOME', 'USER', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TZ'] as const;

/** The demo site's environment for `next build` and `next start`: loopback stack, telemetry off. */
export function siteEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const allowed = Object.fromEntries(SITE_ENV_ALLOWLIST.filter((name) => base[name] !== undefined).map((name) => [name, base[name]]));
  return {
    ...allowed,
    ...NO_CLI_NETWORK_ENV,
    NODE_ENV: 'production',
    CMS_DELIVERY_BASE_URL: requireLoopback(DEMO_DELIVERY_BASE_URL).href.replace(/\/$/, ''),
    CMS_TENANT: 'demo',
    CMS_WEBHOOK_SECRETS: DEMO_SITE_WEBHOOK_SECRET,
    CMS_MEDIA_HOST: DEMO_SITE_MEDIA_HOST,
  };
}

/** `siteDir` is the demo site's directory (a scratch directory in tests). */
export async function main({ siteDir = demoSiteDir }: { siteDir?: string } = {}): Promise<void> {
  const envFiles = readdirSync(siteDir).filter((name) => name.startsWith('.env'));
  if (envFiles.length > 0) fail(`refusing to run: apps/demo-site/${envFiles[0]} exists, and Next.js would load it`);
  requireLoopback(DEMO_SITE_URL);
  if ((await reachable(DEMO_SITE_URL)) || (await reachable(`http://127.0.0.1:${DEMO_SITE_PORT}`))) {
    fail(`${DEMO_SITE_URL} is already in use; stop whatever runs there first`);
  }

  console.log(DEMO_SITE_READY_LINE);
  const deadline = Date.now() + POINTER_TIMEOUT_MS;
  while (!(await pointerExists())) {
    if (Date.now() > deadline) fail('the demo tenant has no delivered release; demo-release.setup.ts creates the first one');
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  // Next.js keeps fetched data in .next/cache across builds, and bundles are cached as immutable by
  // path (releases/N.json, §7.3), while a database reset starts release numbers again: an earlier
  // run's releases/N.json would be served instead of this run's. (Production never reuses a path.)
  rmSync(join(siteDir, '.next'), { recursive: true, force: true });
  const env = siteEnv();
  if ((await run(siteDir, ['build'], env)) !== 0) fail('next build failed');
  process.exitCode = await run(siteDir, ['start', '-p', String(DEMO_SITE_PORT), '-H', '127.0.0.1'], env);
}

if (process.argv[1] && import.meta.filename === process.argv[1]) await main();
