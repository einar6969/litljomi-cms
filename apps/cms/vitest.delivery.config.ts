// The Delivery suite (spec §8.5 Delivery row; plan M3-16): `pnpm test:delivery` runs only the tests
// that delivery-suite.ts maps to the row's cases, against the local
// stack, with the integration settings (global setup, one process). CI runs the same tests inside
// `pnpm test:integration`.
import { defineConfig, mergeConfig } from 'vitest/config';
import type { Reporter } from 'vitest/reporters';
import integration from './vitest.integration.config.ts';
import { deliveryNamePattern, deliveryTests, TEST_DIR } from './delivery-suite.ts';

/** Fails the run unless every test of the suite ran and passed: a renamed test is skipped, not failed. */
const allRan: Reporter = {
  onTestRunEnd(modules) {
    const passed = modules.flatMap((m) => [...m.children.allTests('passed')]).length;
    const expected = deliveryTests().length;
    if (passed !== expected) {
      console.error(`Delivery suite: ${passed} of its ${expected} tests passed (apps/cms/delivery-suite.ts)`);
      process.exitCode = 1;
    }
  },
};

const config = mergeConfig(
  integration,
  defineConfig({
    test: {
      name: 'cms-delivery',
      passWithNoTests: false,
      testNamePattern: deliveryNamePattern(),
      reporters: ['default', allRan],
    },
  }),
);
// Only the files of the suite (mergeConfig would append to the integration include list).
config.test!.include = [...new Set(deliveryTests().map((t) => `${TEST_DIR}/${t.file}`))];

export default config;
