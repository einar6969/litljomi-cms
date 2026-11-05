// The platform_admin persona's side of console.spec.ts, on the local stack. The steps need the
// stack's secret key, which these tests never hold or name, so they run in
// tests/integration/scripts/console-admin.ts (as the global setup does the seed), with this Node
// binary and the CLIs' network calls off. Each prints one line of JSON, without any secret.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { NO_CLI_NETWORK_ENV } from './local';

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..');
const script = join(repoRoot, 'tests', 'integration', 'scripts', 'console-admin.ts');

async function run<T>(step: string): Promise<T> {
  const child = spawn(process.execPath, [script, step], {
    cwd: repoRoot,
    env: { ...process.env, ...NO_CLI_NETWORK_ENV },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => (output += chunk));
  const code = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (exitCode, signal) => resolve(exitCode ?? (signal ? 1 : 0)));
  });
  if (code !== 0) throw new Error(`console-admin.ts ${step} failed (exit ${code})`);
  return JSON.parse(output) as T;
}

/** Removes the admin's factors and sessions, so a rerun on the same stack enrols from nothing. */
export const resetAdmin = () => run<{ reset: true }>('reset');

/** Adds the console pages' fixture tenants (an active one with failures, a suspended one). */
export const arrangePages = () => run<{ arranged: true }>('arrange-pages');

/** Removes them again. */
export const cleanPages = () => run<{ cleaned: true }>('clean-pages');

/** How many verified and unverified factors the admin has. */
export const adminFactors = () => run<{ verified: number; unverified: number }>('factors');

/** Gives the admin a password, tries it on Auth, and says what Auth answered. */
export const adminPasswordSignIn = () => run<{ status: number; signedIn: boolean }>('password-sign-in');
