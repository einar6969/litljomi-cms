// The Delivery suite (spec §8.5 Delivery row, §13.2 M3 criterion; plan M3-16): each case of the
// row, word for word, and the integration tests against the local stack that prove it. A test may
// prove more than one case. `pnpm test:delivery` runs exactly these tests
// (vitest.delivery.config.ts); `pnpm test:integration` runs them with all the others.
// src/privileged/worker/__tests__/delivery-suite.test.ts fails when a case of the row has no entry
// here, or an entry names a test that its file does not have. This file sits outside `privileged/`
// so that the config may import it (lint boundary); it imports nothing.

/** Where the suite's tests are, relative to apps/cms. */
export const TEST_DIR = 'src/privileged/worker/__tests__';

export interface DeliveryTest {
  /** The file, relative to `TEST_DIR`. */
  file: string;
  /** The enclosing `describe`. */
  describe: string;
  /** The `it` name. */
  test: string;
}

export interface DeliveryCase {
  /** The case as §8.5 words it. */
  case: string;
  tests: DeliveryTest[];
}

const demoFallback: DeliveryTest = {
  file: 'fallback.integration.test.ts',
  describe: 'fallback on the demo tenant, seen on the demo site',
  test: 'reuses only an unchanged revision whose references are allowed; everything else is left out and answers 404',
};
const labakArchivedAsset: DeliveryTest = {
  file: 'fallback.integration.test.ts',
  describe: 'fallback on labak: a referenced asset that is archived',
  test: 'refuses the fallback when a referenced asset is archived now, and reuses it while the asset is not',
};

export const DELIVERY_SUITE: DeliveryCase[] = [
  {
    case: 'Fallback never includes an unpublished, archived or never-published entry',
    tests: [demoFallback],
  },
  {
    case: "fallback refused when the published `revision_id` differs from the previous projection's",
    tests: [demoFallback],
  },
  {
    case: 'fallback refused when a referenced asset is archived or a referenced entry unpublished',
    // The asset half on labak (demo events have no image), the entry half on demo.
    tests: [labakArchivedAsset, demoFallback],
  },
  {
    case: "an omitted entry's page returns 404",
    tests: [demoFallback],
  },
  {
    case: "a `present` check fails while the page shows the old hash, even when the layout's release marker is newer",
    tests: [
      {
        file: 'pipeline.integration.test.ts',
        describe: 'processAndDeliver',
        test: "a present check fails while the page shows the old hash, even when the layout's release marker is newer",
      },
    ],
  },
  {
    case: '`absent` checks after unpublish',
    tests: [
      {
        file: 'pipeline.integration.test.ts',
        describe: 'processAndDeliver',
        test: 'an unpublish is live when the own path is 404 and no listing carries the marker',
      },
    ],
  },
  {
    case: 'media URLs return 200 only after publish',
    tests: [
      {
        file: 'build-release.integration.test.ts',
        describe: 'buildRelease (labak)',
        test: 'publishes the media of included entries: the object is in media-public and public_path is set',
      },
    ],
  },
  {
    case: 'unpublishing an entry that another published entry references succeeds, and the reference resolves to `null`',
    tests: [
      {
        file: 'reference.integration.test.ts',
        describe: 'reference field (demo event.related)',
        test: "resolves to the target's summary; unpublishing the target succeeds and the next release resolves it to null",
      },
    ],
  },
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The distinct tests of the suite. */
export function deliveryTests(): DeliveryTest[] {
  const seen = new Map<string, DeliveryTest>();
  for (const c of DELIVERY_SUITE) for (const t of c.tests) seen.set(`${t.file}\0${t.describe}\0${t.test}`, t);
  return [...seen.values()];
}

/**
 * Vitest's `testNamePattern` for the suite: vitest matches it against "<describe> <test>", so each
 * alternative is the describe and the test, anchored at both ends.
 */
export function deliveryNamePattern(): RegExp {
  return new RegExp(`^(?:${deliveryTests().map((t) => escape(`${t.describe} ${t.test}`)).join('|')})$`);
}
