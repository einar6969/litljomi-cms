// Decision 38.1 (as amended by Einar): the CMS's Playwright run (`pnpm --filter cms e2e`) runs
// outside the Bash sandbox and may reach only loopback and this repository, so pnpm must not check
// the registry for a newer pnpm. `updateNotifier: false` in pnpm-workspace.yaml turns that off, and
// `verifyDepsBeforeRun: error` makes `pnpm <script>` fail on out-of-date dependencies instead of
// installing them (which would reach the registry).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const workspace = readFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8');

/** The value of a top-level `key: value` setting (no YAML parser in the repository; the file is flat). */
const topLevel = (key: string): string[] =>
  workspace
    .split('\n')
    .map((line) => line.replace(/\s+#.*$/, ''))
    .filter((line) => line.startsWith(`${key}:`))
    .map((line) => line.slice(key.length + 1).trim());

it('turns off the pnpm update check (decision 38.1)', () => {
  expect(topLevel('updateNotifier')).toEqual(['false']);
});

it('fails a script run on out-of-date dependencies instead of installing them (decision 38.1)', () => {
  expect(topLevel('verifyDepsBeforeRun')).toEqual(['error']);
});
