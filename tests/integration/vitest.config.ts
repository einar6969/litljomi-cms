// Integration tests against the local Supabase stack (plan Task 12). They share
// one database, one Auth server and its rate limits, so files run one after
// another in a single process; editorClient() sessions are cached across files.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'integration',
    root: import.meta.dirname,
    include: ['src/**/*.test.ts'],
    // Opt-in only: `pnpm test:e2e-local` (vitest.e2e-local.config.ts).
    exclude: ['src/end-to-end-local.test.ts', '**/node_modules/**'],
    globalSetup: ['src/global-setup.ts'],
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    isolate: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
