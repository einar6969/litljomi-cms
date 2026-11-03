import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixtureServer, type FixtureServer } from './fixture-server.ts';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const nextBin = join(dirname(createRequire(join(appDir, 'package.json')).resolve('next/package.json')), 'dist', 'bin', 'next');

export const WEBHOOK_SECRETS = ['e2e-secret-old', 'e2e-secret-new'];
export const MEDIA_HOST = 'media.example.test';

export interface RunningSite {
  url: string;
  /** The fixture bundle server; null when the site reads another delivery base URL. */
  fixtures: FixtureServer | null;
  stop(): Promise<void>;
}

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve));
  const address = s.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => s.close(() => resolve()));
  return port;
}

function runNext(args: string[], env: NodeJS.ProcessEnv): { child: ChildProcess; output: () => string; done: Promise<number> } {
  const child = spawn(process.execPath, [nextBin, ...args], { cwd: appDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout?.on('data', (d: Buffer) => (log += d.toString()));
  child.stderr?.on('data', (d: Buffer) => (log += d.toString()));
  const done = new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
  return { child, output: () => log, done };
}

/**
 * Builds the site and starts it (`next build`, `next start`) against the fixture bundle server, or
 * against `deliveryBaseUrl` when given (the local stack's `delivery` bucket, for the CMS worker's
 * integration tests; plan M3-05).
 */
export async function startSite(o: { deliveryBaseUrl?: string } = {}): Promise<RunningSite> {
  const fixtures = o.deliveryBaseUrl === undefined ? await startFixtureServer() : null;
  // Next.js keeps fetched data in .next/cache across builds: a pointer fetched by an earlier build
  // would be served instead of the current one (the local stack's pointer changes between runs).
  if (o.deliveryBaseUrl !== undefined) rmSync(join(appDir, '.next'), { recursive: true, force: true });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    CMS_DELIVERY_BASE_URL: o.deliveryBaseUrl ?? `${fixtures!.origin}/delivery`,
    CMS_TENANT: 'demo',
    CMS_WEBHOOK_SECRETS: WEBHOOK_SECRETS.join(','),
    CMS_MEDIA_HOST: MEDIA_HOST,
  };
  let child: ChildProcess | undefined;
  try {
    const build = runNext(['build'], env);
    if ((await build.done) !== 0) throw new Error(`next build failed:\n${build.output().slice(-4000)}`);
    const port = await freePort();
    const start = runNext(['start', '-p', String(port), '-H', '127.0.0.1'], env);
    child = start.child;
    const url = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 60_000;
    for (;;) {
      if (child.exitCode !== null) throw new Error(`next start exited early:\n${start.output().slice(-4000)}`);
      try {
        if ((await fetch(`${url}/events`)).status === 200) break;
      } catch {
        // not listening yet
      }
      if (Date.now() > deadline) throw new Error(`next start did not become ready:\n${start.output().slice(-4000)}`);
      await new Promise((r) => setTimeout(r, 250));
    }
    const started = child;
    const exited = start.done;
    return {
      url,
      fixtures,
      async stop() {
        started.kill('SIGTERM');
        await exited; // the port and the .next handles are released before the run ends
        await fixtures?.close();
      },
    };
  } catch (e) {
    child?.kill('SIGTERM');
    await fixtures?.close();
    throw e;
  }
}
