// The local stack's URLs and keys, read once from `supabase status -o json`
// (plan Task 12). Nothing is read from .env files, and nothing here is ever
// pointed at a hosted project: the URLs must be loopback, or loading fails.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export type Env = {
  apiUrl: string;
  dbUrl: string;
  mailUrl: string;
  publishableKey: string;
  secretKey: string;
};

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

function loadEnv(): Env {
  const out = execFileSync('supabase', ['status', '-o', 'json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' },
  });
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
  return env;
}

export const env: Env = loadEnv();
