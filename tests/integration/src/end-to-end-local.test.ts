// The local end to end (plan Task 21, moved from Task 26; decision 35). Opt-in: `pnpm test:e2e-local`,
// never part of `pnpm test` or `pnpm test:integration`. Needs the local stack (pnpm db:start; best
// after pnpm db:reset). It builds and starts the real CMS app and the real demo site, then:
//
//   1. makes sure the demo tenant has a delivered release (the site's build reads it), publishing a
//      first event through the CMS if needed;
//   2. starts the demo site on port 3101, the seeded demo site's URL, with the seeded webhook secret;
//   3. publishes /events/x as editor_demo through the `api` functions (the editor UI is Phase 4) and
//      triggers the worker with POST /api/internal/worker, as the editor's action will;
//   4. waits for the demo site's delivery of that release: live_status must be 'ok' (confirmed);
//   5. stops the CMS and fetches /events/x again: still 200 with the same marker.
//
// The CMS is run through scripts/cms-next.sh, which reads the stack's URL and keys from
// `supabase status` at run time; this file never handles the secret key. No .env file is written.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseEntryMarkers } from '../../../packages/sdk/src/parse-markers.ts';
import { editorClient, publicUrl, sleep } from './clients.ts';
import { env } from './env.ts';
import { DEMO_SITE, TENANT } from './fixtures.ts';
import { closeAll, ownerQuery } from './sql.ts';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const demoSiteDir = join(repoRoot, 'apps', 'demo-site');
const cmsScript = join(repoRoot, 'tests', 'integration', 'scripts', 'cms-next.sh');
const nextBin = join(dirname(createRequire(join(demoSiteDir, 'package.json')).resolve('next/package.json')), 'dist', 'bin', 'next');

const SLUG = 'x';
const SITE_URL = DEMO_SITE.baseUrl; // http://localhost:3101
/** next.config.ts needs an https media host; demo events have no images, so a reserved test name. */
const MEDIA_HOST = 'media.example.test';
const INTERNAL_SECRET = randomBytes(24).toString('hex');

// Insurance for an interrupted run (SIGINT, SIGTERM, a crashed worker) where afterAll never runs:
// the spawned servers would otherwise keep ports 3100/3101 and fail the next run's guard.
// The signal handlers end the process with process.exit, which is right only because this file runs
// in a forked child process (`pool: 'forks'` in vitest.e2e-local.config.ts); under the threads pool
// it would stop only the worker thread, which Vitest reports as an error, not the run.
function killStarted(): void {
  for (const child of started) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}
process.once('exit', killStarted);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    killStarted();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
}

type Proc = { child: ChildProcess; output: () => string; done: Promise<number> };
const started: ChildProcess[] = [];

function run(command: string, args: string[], cwd: string, extraEnv: NodeJS.ProcessEnv): Proc {
  const child = spawn(command, args, { cwd, env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  started.push(child);
  let log = '';
  child.stdout?.on('data', (d: Buffer) => (log += d.toString()));
  child.stderr?.on('data', (d: Buffer) => (log += d.toString()));
  const done = new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
  return { child, output: () => log, done };
}

async function stop(p: Proc | undefined): Promise<void> {
  if (!p || p.child.exitCode !== null || p.child.signalCode !== null) return;
  p.child.kill('SIGTERM');
  const killed = await Promise.race([p.done.then(() => true), sleep(10_000).then(() => false)]);
  if (!killed) p.child.kill('SIGKILL');
}

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve));
  const address = s.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => s.close(() => resolve()));
  return port;
}

async function reachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return true;
  } catch {
    return false;
  }
}

async function waitUntilServing(p: Proc, url: string, what: string): Promise<void> {
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (p.child.exitCode !== null) throw new Error(`${what} exited early:\n${p.output().slice(-4000)}`);
    if (await reachable(url)) return;
    if (Date.now() > deadline) throw new Error(`${what} did not start:\n${p.output().slice(-4000)}`);
    await sleep(500);
  }
}

async function waitFor<T>(what: string, fn: () => Promise<T | null | undefined>, timeoutMs = 180_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== null && value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(1_000);
  }
}

let cms: Proc | undefined;
let site: Proc | undefined;
let cmsUrl = '';

const editorRpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await (await editorClient('editor_demo')).schema('api').rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.code} ${error.message}`);
  return data as T;
};

/** Saves a new draft of the demo event with this slug (creating it if needed) and requests its publication. */
async function requestEvent(slug: string, title: string): Promise<{ entryId: string; requestId: string }> {
  const [existing] = await ownerQuery<{ id: string; version: number }>(
    `select e.id, d.version from cms.entries e join cms.drafts d on d.entry_id = e.id where e.tenant_id = $1 and e.slug = $2`,
    [TENANT.demo, slug],
  );
  const entryId = existing?.id ?? (await editorRpc<string>('create_entry', { p_tenant_id: TENANT.demo, p_type: 'event', p_slug: slug }));
  const version = await editorRpc<number>('save_draft', {
    p_entry_id: entryId,
    p_expected_version: existing?.version ?? 1,
    p_data: { title, startDate: '2026-12-01', location: 'Reykjavík' },
    p_schema_version: 1,
    p_title: null,
    p_sort_at: null,
  });
  const requestId = await editorRpc<string>('request_publish', { p_entry_id: entryId, p_expected_draft_version: version });
  return { entryId, requestId };
}

/** POST /api/internal/worker, as the editor's publish action does (decision 9). */
async function triggerWorker(requestId: string): Promise<void> {
  const res = await fetch(`${cmsUrl}/api/internal/worker`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cms-internal-secret': INTERNAL_SECRET },
    body: JSON.stringify({ requestId }),
    redirect: 'manual',
  });
  expect(res.status).toBe(202);
}

type ReleaseRow = { status: string; release_id: string | null; number: number | null; release_status: string | null };
const requestRelease = async (requestId: string) =>
  (
    await ownerQuery<ReleaseRow>(
      `select pr.status, pr.release_id, r.number, r.status as release_status
       from cms.publish_requests pr left join cms.releases r on r.id = pr.release_id where pr.id = $1`,
      [requestId],
    )
  )[0];

beforeAll(async () => {
  if (await reachable(SITE_URL)) throw new Error(`${SITE_URL} is already in use; stop whatever runs there first`);

  // The CMS app, built and started against the local stack.
  const cmsPort = await freePort();
  cmsUrl = `http://127.0.0.1:${cmsPort}`;
  const cmsEnv = { CMS_INTERNAL_SECRET: INTERNAL_SECRET, CRON_SECRET: randomBytes(24).toString('hex'), CMS_PUBLIC_URL: cmsUrl };
  const build = run('sh', [cmsScript, 'build'], repoRoot, cmsEnv);
  if ((await build.done) !== 0) throw new Error(`CMS next build failed:\n${build.output().slice(-4000)}`);
  cms = run('sh', [cmsScript, 'start', '-p', String(cmsPort), '-H', '127.0.0.1'], repoRoot, cmsEnv);
  await waitUntilServing(cms, cmsUrl, 'the CMS app');

  // A first demo release, so the site's build has content to read.
  const delivered = await ownerQuery(`select 1 from cms.releases where tenant_id = $1 and status = 'delivered'`, [TENANT.demo]);
  if (delivered.length === 0) {
    const first = await requestEvent('fyrsti-vidburdur', 'Fyrsti viðburður');
    await triggerWorker(first.requestId);
    await waitFor('the first demo release', async () => {
      const r = await requestRelease(first.requestId);
      return r?.release_status === 'delivered' ? r : null;
    });
  }

  // The demo site on the seeded site's port and secret. Its build output is removed first: Next.js
  // keeps fetched data in .next/cache across builds, and bundles are cached as immutable by path
  // (releases/N.json, §7.3), while a database reset starts release numbers again, so an earlier
  // run's releases/N.json would be served instead of this run's. (Production never reuses a path.)
  rmSync(join(demoSiteDir, '.next'), { recursive: true, force: true });
  const siteEnv = {
    CMS_DELIVERY_BASE_URL: `${env.apiUrl}/storage/v1/object/public/delivery`,
    CMS_TENANT: 'demo',
    CMS_WEBHOOK_SECRETS: DEMO_SITE.webhookSecret,
    CMS_MEDIA_HOST: MEDIA_HOST,
  };
  const siteBuild = run(process.execPath, [nextBin, 'build'], demoSiteDir, siteEnv);
  if ((await siteBuild.done) !== 0) throw new Error(`demo-site next build failed:\n${siteBuild.output().slice(-4000)}`);
  site = run(process.execPath, [nextBin, 'start', '-p', '3101'], demoSiteDir, siteEnv);
  await waitUntilServing(site, `${SITE_URL}/events`, 'the demo site');
}, 900_000);

afterAll(async () => {
  await stop(cms);
  await stop(site);
  killStarted();
  await closeAll();
});

describe('local end to end (editor_demo → worker → demo site)', () => {
  it('publishing /events/x reaches live_status ok, and the site keeps serving it with the CMS stopped', async () => {
    const title = `Viðburður x ${new Date().toISOString()}`;
    const { entryId, requestId } = await requestEvent(SLUG, title);
    await triggerWorker(requestId);

    // The request is committed and in a delivered release; the demo site's delivery is confirmed.
    const release = await waitFor('the release of /events/x', async () => {
      const r = await requestRelease(requestId);
      return r?.release_status === 'delivered' ? r : null;
    });
    const [demoSite] = await ownerQuery<{ id: string }>('select id from cms.sites where tenant_id = $1 and base_url = $2', [TENANT.demo, SITE_URL]);
    const delivery = await waitFor('the demo site’s live status', async () => {
      const [d] = await ownerQuery<{ notify_status: string; live_status: string; last_error: unknown }>(
        'select notify_status, live_status, last_error from cms.site_deliveries where release_id = $1 and site_id = $2',
        [release.release_id, demoSite!.id],
      );
      return d && d.live_status !== 'pending' ? d : d?.notify_status === 'failed' ? d : null;
    });
    console.info('[e2e-local]', { requestId, entryId, release: release.number, delivery });
    expect(release.status).toBe('committed');
    expect(delivery).toMatchObject({ notify_status: 'ok', live_status: 'ok', last_error: null });

    // The marker the release's bundle gives the entry.
    const bundle = (await (await fetch(publicUrl('delivery', `demo/releases/${release.number}.json`))).json()) as {
      entries: Record<string, Array<{ id: string; contentHash: string }>>;
    };
    const hash = bundle.entries['event']?.find((e) => e.id === entryId)?.contentHash;
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const before = await fetch(`${SITE_URL}/events/${SLUG}`);
    expect(before.status).toBe(200);
    expect(parseEntryMarkers(await before.text())).toContainEqual({ id: entryId, hash });

    // The CMS stopped: the site does not depend on it (§7.3).
    await stop(cms);
    expect(await reachable(cmsUrl)).toBe(false);
    const after = await fetch(`${SITE_URL}/events/${SLUG}`);
    expect(after.status).toBe(200);
    const markers = parseEntryMarkers(await after.text());
    console.info('[e2e-local] after stopping the CMS', { status: after.status, markers: markers.filter((m) => m.id === entryId) });
    expect(markers).toContainEqual({ id: entryId, hash });
  });
});
