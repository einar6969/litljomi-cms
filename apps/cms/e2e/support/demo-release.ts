// The demo tenant's first release and the demo site being up, before any spec publishes (plan
// Task 25; the `demo-release` setup project). The demo site can be built only from a current
// release, so after a database reset its first release cannot be confirmed: the worker's
// notification to DEMO_SITE_URL fails while nothing listens there, and only the per-minute sweep,
// which does not run under the e2e, would retry it. A spec that publishes and waits for
// "Birt á vef ✓" therefore needs the site up first, whatever the order the specs run in.
//
// Every URL this file reaches is loopback (requireLoopback; the browser context aborts anything
// else, support/test.ts): the CMS, the demo site, and the local stack's public delivery bucket.
import { slugify } from '@litljomi/cms-schema/src/slugify.ts';
import type { Page } from '@playwright/test';
import { t } from '../../src/i18n/is';
import { DEMO_DELIVERY_BASE_URL, DEMO_SITE_URL } from './demo-site';
import { createEvent } from './editor';
import { requireLoopback } from './local';
import { expect } from './test';

// The demo module's own field labels (an English fixture tenant, decision 37.6).
export const TITLE = 'Title';
const START = 'Start date';
const SAVED = { timeout: 10_000 };
/** How long the first release may take to reach the public pointer (worker build and pointer write). */
const POINTER_TIMEOUT_MS = 120_000;
/** How long the demo site may take to start: demo-site-server.ts runs `next build`, then `next start`. */
const SITE_START_TIMEOUT_MS = 600_000;

export type DemoPointer = { release: number; bundle: string };

export async function getJson<T>(url: string): Promise<T | null> {
  const response = await fetch(requireLoopback(url), { redirect: 'error', cache: 'no-store' });
  return response.ok ? ((await response.json()) as T) : null;
}

/** The demo tenant's public pointer, or null when it has no delivered release. */
export const demoPointer = () => getJson<DemoPointer>(`${DEMO_DELIVERY_BASE_URL}/demo/current.json`);

/**
 * Creates a demo event, fills its required fields and waits for the autosave, which also sets the
 * slug from the title. The returned slug is exact for a title no earlier run has used.
 */
export async function newDemoEvent(page: Page, title: string): Promise<{ entryId: string; slug: string }> {
  const entryId = await createEvent(page);
  await page.getByLabel(TITLE).fill(title);
  await page.getByLabel(START).fill('2026-12-01');
  await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);
  return { entryId, slug: slugify(title) };
}

/**
 * Makes sure the demo tenant has a delivered release and the demo site serves it. When there is
 * no release yet (after a database reset), a first event is published through the editor (its own
 * delivery is not confirmed, as the site is not up yet), and the demo-site webServer builds and
 * starts the site once the pointer is public. Then waits for the site to answer.
 */
export async function ensureDemoSite(page: Page): Promise<void> {
  if (!(await demoPointer())) {
    await newDemoEvent(page, 'Fyrsti viðburður');
    await page.getByRole('button', { name: t.publish.publish }).click();
    await expect.poll(demoPointer, { timeout: POINTER_TIMEOUT_MS, intervals: [1000] }).not.toBeNull();
  }
  await expect
    .poll(async () => (await fetch(requireLoopback(`${DEMO_SITE_URL}/events`), { redirect: 'error' }).catch(() => null))?.status ?? 0, {
      timeout: SITE_START_TIMEOUT_MS,
      intervals: [2000],
      message: 'the demo site did not start (see the demo-site webServer output)',
    })
    .toBe(200);
}
