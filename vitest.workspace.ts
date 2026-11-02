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
      name: 'rich-text',
      include: ['packages/rich-text/src/__tests__/**/*.test.{ts,tsx}'],
      environment: 'jsdom',
    },
  },
  {
    test: {
      name: 'sdk',
      include: ['packages/sdk/src/__tests__/**/*.test.{ts,tsx}'],
    },
  },
  {
    // Unit tests of the CMS app. Tests against the local stack are named *.integration.test.ts and
    // run only through `pnpm test:integration` (apps/cms/vitest.integration.config.ts).
    resolve: { alias: { '@': fileURLToPath(new URL('./apps/cms/src', import.meta.url)) } },
    test: {
      name: 'cms',
      include: ['apps/cms/src/**/__tests__/**/*.test.{ts,tsx}'],
      exclude: ['**/*.integration.test.ts', '**/node_modules/**'],
    },
  },
]);
