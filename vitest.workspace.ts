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
]);
