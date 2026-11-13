// `node tools/stack/supabase.ts <args>`: the Supabase CLI on the local stack CMS_STACK_SLOT names
// (tools/stack/slot.ts). The `pnpm db:*` scripts and tests/integration/scripts/cms-next.sh run the
// CLI through it. It runs `supabase <args>` from the repository root with the slot's config
// overrides and telemetry off, and passes the CLI's output and exit status through unchanged.
//
// Local stack only: it refuses `--linked` and `--db-url` (a hosted or other database), and
// `stop --all`, which would stop every stack on the machine, the other slot's too.
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { supabaseCliEnv } from './slot.ts';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/** Why `args` are refused, or null when they may run. */
export function refusal(args: readonly string[]): string | null {
  if (args.some((a) => a === '--linked' || a.startsWith('--linked='))) return 'refusing --linked: this script runs the local stack only';
  if (args.some((a) => a === '--db-url' || a.startsWith('--db-url='))) return 'refusing --db-url: this script runs the local stack only';
  if (args[0] === 'stop' && args.some((a) => a === '--all' || a.startsWith('--all='))) {
    return 'refusing stop --all: it stops every local stack, the other slot’s too';
  }
  return null;
}

/** The environment the CLI runs with: the slot's overrides, telemetry off. */
export function cliEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...supabaseCliEnv(base), SUPABASE_TELEMETRY_DISABLED: '1' };
}

/** Runs `supabase <args>` on the slot's stack; returns its exit status. */
export function runSupabase(args: readonly string[], base: NodeJS.ProcessEnv = process.env): number {
  const refused = refusal(args);
  if (refused) {
    console.error(`supabase.ts: ${refused}`);
    return 1;
  }
  const result = spawnSync('supabase', args, { cwd: repoRoot, stdio: 'inherit', env: cliEnv(base) });
  if (result.error) {
    console.error(`supabase.ts: could not run the Supabase CLI (${result.error.message}). Is \`supabase\` installed and on PATH?`);
    return 1;
  }
  return result.status ?? 1;
}

// Run as a script (argv[1] through realpath: Node runs the resolved file, and tmpdir is a link on macOS).
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  try {
    process.exitCode = runSupabase(process.argv.slice(2));
  } catch (error) {
    // An invalid CMS_STACK_SLOT.
    console.error(`supabase.ts: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
