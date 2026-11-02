// The opt-in local end to end (plan Task 21): `pnpm test:e2e-local`. It builds and starts the CMS
// app and the demo site against the local stack, so it is excluded from `pnpm test:integration`.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'e2e-local',
    root: import.meta.dirname,
    include: ['src/end-to-end-local.test.ts'],
    globalSetup: ['src/global-setup.ts'],
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 300_000,
    hookTimeout: 900_000,
  },
});
