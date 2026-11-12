// Playwright global setup: seeds the fixed test identities on the local stack with `pnpm
// seed:local`'s script, run directly with this Node binary (no package manager, so nothing is
// fetched; Einar, 2026-11-02). The script refuses a stack that is not on loopback.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { NO_CLI_NETWORK_ENV, STACK_SLOT_ENV } from './support/local';

const repoRoot = join(import.meta.dirname, '..', '..', '..');
const seedScript = join(repoRoot, 'tests', 'integration', 'scripts', 'seed-local.ts');

export default async function globalSetup(): Promise<void> {
  const child = spawn(process.execPath, [seedScript], {
    cwd: repoRoot,
    // The seed reads the slot's stack through `supabase status` (tests/integration/src/env.ts).
    env: { ...process.env, ...STACK_SLOT_ENV, ...NO_CLI_NETWORK_ENV },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const code = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (exitCode, signal) => resolve(exitCode ?? (signal ? 1 : 0)));
  });
  if (code !== 0) throw new Error(`seeding the local stack failed (exit ${code}); is it running (pnpm db:start)?`);
}
