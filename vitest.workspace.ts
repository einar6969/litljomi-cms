import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      name: 'checks',
      include: ['tools/checks/__tests__/**/*.test.ts'],
      exclude: ['**/fixtures/**', '**/node_modules/**'],
    },
  },
]);
