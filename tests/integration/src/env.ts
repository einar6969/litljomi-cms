// The local stack's URLs and keys, read once from `supabase status -o json`
// (plan Task 12). Nothing is read from .env files, and nothing here is ever
// pointed at a hosted project: the URLs must be loopback, or loading fails.
// The stack is the one CMS_STACK_SLOT names (tools/stack/slot.ts): `supabase status` runs with the
// slot's overrides, and its URLs must be that slot's, or loading fails.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stackSlot, supabaseCliEnv, type StackSlot } from '../../../tools/stack/slot.ts';

export type Env = {
  apiUrl: string;
  dbUrl: string;
  mailUrl: string;
  publishableKey: string;
  secretKey: string;
};

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

/** The slot's ports and URLs: the CMS, demo site and fake-site ports the tests use. */
export const stack: StackSlot = stackSlot();

function loadEnv(): Env {
  let out: string;
  try {
    out = execFileSync('supabase', ['status', '-o', 'json'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      // No telemetry and no GitHub release check: the CMS's e2e run, which loads this file, runs
      // outside the Bash sandbox and must reach only loopback (decision 37.3).
      env: { ...supabaseCliEnv(process.env), SUPABASE_TELEMETRY_DISABLED: '1', SUPABASE_NO_UPDATE_NOTIFIER: '1' },
    });
  } catch (e) {
    throw new Error('`supabase status -o json` failed; is the Supabase CLI installed and the local stack running (pnpm db:start)?', {
      cause: e,
    });
  }
  const status = JSON.parse(out.slice(out.indexOf('{'))) as Record<string, string | undefined>;
  const pick = (...names: string[]) => {
    for (const n of names) if (status[n]) return status[n];
    throw new Error(`supabase status has none of ${names.join(', ')}; is the local stack running (pnpm db:start)?`);
  };
  const env: Env = {
    apiUrl: pick('API_URL'),
    dbUrl: pick('DB_URL'),
    mailUrl: pick('MAILPIT_URL', 'INBUCKET_URL'),
    publishableKey: pick('PUBLISHABLE_KEY', 'ANON_KEY'),
    secretKey: pick('SECRET_KEY', 'SERVICE_ROLE_KEY'),
  };
  for (const url of [env.apiUrl, env.dbUrl, env.mailUrl]) {
    const host = new URL(url).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') throw new Error(`refusing a non-local stack: ${host}`);
  }
  // Another slot's stack is refused too: the ports say which stack answered.
  for (const [url, port] of [
    [env.apiUrl, stack.ports.api],
    [env.dbUrl, stack.ports.db],
    [env.mailUrl, stack.ports.mailpit],
  ] as const) {
    if (new URL(url).port !== String(port)) throw new Error(`refusing the stack at ${new URL(url).host}: slot ${stack.slot}'s stack uses port ${port}`);
  }
  return env;
}

export const env: Env = loadEnv();
