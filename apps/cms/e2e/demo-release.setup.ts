// Setup project (after `editor-session`): gives the demo tenant a delivered release and waits for
// the demo site to serve it (support/demo-release.ts), so that every spec that publishes a demo
// event can see it confirmed ("Birt á vef ✓"), from a freshly reset database and in any order.
import { ensureDemoSite } from './support/demo-release';
import { sessionState } from './support/session';
import { test } from './support/test';

test.use({ storageState: sessionState('editor_demo') });

test('the demo tenant has a release and the demo site serves it', async ({ page }) => {
  // The first release, then the demo site's `next build` and start.
  test.setTimeout(15 * 60_000);
  await ensureDemoSite(page);
});
