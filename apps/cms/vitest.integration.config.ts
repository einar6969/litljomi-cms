// The CMS app's tests against the local Supabase stack (*.integration.test.ts), run by
// `pnpm test:integration` after tests/integration. They reuse its global setup (the fixed
// identities) and its one-process settings, because they share the same database and Auth server.
// Until the first such test exists (Task 19), the run passes with no files; Vitest runs the global
// setup only when there are files to run.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    name: 'cms-integration',
    root: import.meta.dirname,
    include: ['src/**/*.integration.test.ts'],
    globalSetup: [fileURLToPath(new URL('../../tests/integration/src/global-setup.ts', import.meta.url))],
    passWithNoTests: true,
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    isolate: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
