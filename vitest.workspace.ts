import { fileURLToPath } from 'node:url';
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      name: 'checks',
      include: ['tools/checks/__tests__/**/*.test.ts'],
      exclude: ['**/fixtures/**', '**/node_modules/**'],
    },
  },
  {
    // `pnpm pack:sdk`. Its tests run the real git and npm against a repository in a temp folder.
    test: {
      name: 'pack',
      include: ['tools/pack/__tests__/**/*.test.ts'],
    },
  },
  {
    test: {
      name: 'schema',
      include: ['packages/schema/src/__tests__/**/*.test.ts'],
    },
  },
  {
    test: {
      name: 'labak',
      include: ['modules/labak/src/__tests__/**/*.test.ts'],
    },
  },
  {
    test: {
      name: 'demo',
      include: ['modules/demo/src/__tests__/**/*.test.ts'],
    },
  },
  {
    test: {
      name: 'dld',
      include: ['modules/dld/src/__tests__/**/*.test.ts'],
    },
  },
  {
    test: {
      name: 'm4-probe',
      include: ['modules/m4-probe/src/__tests__/**/*.test.ts'],
    },
  },
  {
    test: {
      name: 'rich-text',
      include: ['packages/rich-text/src/__tests__/**/*.test.{ts,tsx}'],
      environment: 'jsdom',
    },
  },
  // The SDK suite runs once per supported Next.js major (spec §7.3, plan M3-13). CMS_SDK_NEXT names
  // the package next-compat.test.ts loads: npm aliases of next@15 and next@16 (packages/sdk).
  ...(['next15', 'next16'] as const).map((next) => ({
    test: {
      name: `sdk-${next}`,
      include: ['packages/sdk/src/__tests__/**/*.test.{ts,tsx}'],
      env: { CMS_SDK_NEXT: next },
    },
  })),
  {
    // Unit tests of the CMS app. Tests against the local stack are named *.integration.test.ts and
    // run only through `pnpm test:integration` (apps/cms/vitest.integration.config.ts).
    // `server-only` is resolved by Next.js for server code; in tests it is Next.js's own empty module.
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./apps/cms/src', import.meta.url)),
        'server-only': fileURLToPath(new URL('./apps/cms/node_modules/next/dist/compiled/server-only/empty.js', import.meta.url)),
      },
    },
    test: {
      name: 'cms',
      include: ['apps/cms/src/**/__tests__/**/*.test.{ts,tsx}'],
      exclude: ['**/*.integration.test.ts', '**/node_modules/**'],
    },
  },
  {
    test: {
      name: 'cli',
      include: ['tools/cli/src/__tests__/**/*.test.ts'],
    },
  },
  {
    test: {
      name: 'demo-site',
      include: ['apps/demo-site/e2e/fixtures.test.ts', 'apps/demo-site/src/**/__tests__/**/*.test.ts'],
    },
  },
]);
