import { defineConfig } from 'vitest/config';

// Builds the site and starts it against the fixture bundle server; run with `pnpm --filter demo-site test:e2e`.
// Not part of the root workspace, so `pnpm test` stays fast.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    name: 'demo-site-e2e',
    include: ['e2e/site.spec.ts'],
    hookTimeout: 300_000,
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
