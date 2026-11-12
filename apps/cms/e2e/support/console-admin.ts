// The platform_admin persona's side of console.spec.ts, on the local stack. The steps need the
// stack's secret key, which these tests never hold or name, so they run in
// tests/integration/scripts/console-admin.ts (as the global setup does the seed), with this Node
// binary and the CLIs' network calls off. Each prints one line of JSON, never the secret key, a
// password or a session (recoveryTokenHash's step prints a one-time link token).
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { NO_CLI_NETWORK_ENV } from './local';
import type { E2ePersona } from './personas';

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..');
const script = join(repoRoot, 'tests', 'integration', 'scripts', 'console-admin.ts');

async function run<T>(step: string, arg?: string): Promise<T> {
  const child = spawn(process.execPath, [script, step, ...(arg === undefined ? [] : [arg])], {
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

/** The tenant overview's states: a fixture tenant of the m4-probe module, with editor_demo a member. */
export type OverviewState = 'proven' | 'no-site' | 'nothing-proven' | 'withdrawn';
export const arrangeOverview = (state: OverviewState) => run<{ arranged: string }>('arrange-overview', state);

/** Removes the fixture tenant and its membership. */
export const cleanOverview = () => run<{ cleaned: true }>('clean-overview');

/** Takes SELECT on api.publication_status from editors on the local database, so the read really fails. */
export const revokeStatusRead = () => run<{ revoked: true }>('revoke-status-read');

/** Gives it back. */
export const grantStatusRead = () => run<{ granted: true }>('grant-status-read');

/** How many verified and unverified factors the admin has. */
export const adminFactors = () => run<{ verified: number; unverified: number }>('factors');

/** A throwaway account with an email change requested: Auth has mailed both addresses (M5-03). */
export const arrangeEmailChange = () => run<{ id: string; oldAddress: string; newAddress: string }>('arrange-email-change');

/** The address Auth holds for an account. */
export const addressOf = (id: string) => run<{ email: string }>('address-of', id);

/** Removes a throwaway account. */
export const removeUser = (id: string) => run<{ removed: true }>('remove-user', id);

/**
 * A one-time token hash of a password-reset link for a fixed persona (PW-03). The confirm page
 * refuses magic links, so its tests get their links here; following one leads to the set-password
 * page and changes no password.
 */
export const recoveryTokenHash = (persona: E2ePersona) => run<{ tokenHash: string }>('recovery-link', persona);

/** A throwaway account invited by Auth, whose invitation mail is in Mailpit (PW-03). */
export const inviteAccount = () => run<{ id: string; email: string }>('invite-account');

/** A throwaway account with the personas' fixture password, for a reset (PW-03). */
export const arrangeAccount = () => run<{ id: string; email: string }>('arrange-account');
