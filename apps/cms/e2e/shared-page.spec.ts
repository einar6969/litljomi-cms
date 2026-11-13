// A7: live confirmation for content with no page of its own (spec §3.2, §7.4, §7.5), as editor_demo,
// against the local CMS, the local stack and the real demo site on DEMO_SITE_URL (the `demo-site`
// webServer). The demo module's `events-page` singleton has a site integration without a path: it
// is shown, and checked, on the shared `/events` page only. Its title is never text, so it has no
// slug. The `site-info` singleton has no site integration at all: nothing on the site is checked
// for it, so it is delivered but never shown as confirmed.
//
// Every URL this file reaches is loopback (requireLoopback; the browser context aborts anything
// else, support/test.ts): the CMS, the demo site, and the local stack's public delivery bucket.
import { randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { parseEntryMarkers } from '@litljomi/cms-sdk/src/parse-markers.ts';
import { t } from '../src/i18n/is';
import { ensureDemoSite } from './support/demo-release';
import { DEMO_SITE_URL } from './support/demo-site';
import { CMS_URL, requireLoopback } from './support/local';
import { sessionState } from './support/session';
import { expect, test } from './support/test';

test.use({ storageState: sessionState('editor_demo') });

const SAVED = { timeout: 10_000 };
// The worker's build, notification and live check (polling up to 60 s, §7.4), plus the 2 s poll.
const CONFIRMED = { timeout: 150_000 };
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
// The demo module's own field labels (an English fixture tenant, decision 37.6).
const INTRO = 'Introduction';
const SITE_NAME = 'Site name';

const state = (page: Page) => page.getByTestId('publish-state');
const detail = (page: Page) => page.getByTestId('publish-detail');

/** Opens a demo singleton (created on first open) and returns its entry id. */
async function openSingleton(page: Page, type: string): Promise<string> {
  const url = new RegExp(`^${CMS_URL}/t/demo/${type}/(${UUID})$`);
  await page.goto(`/t/demo/${type}`);
  await page.waitForURL(url, { timeout: 30_000 });
  return url.exec(page.url())![1]!;
}

/**
 * The singleton persists between runs: one a run left published is withdrawn first, so this run's
 * publish starts from "not on the site" and its states can be told apart.
 */
async function startUnpublished(page: Page, withdrawn: string): Promise<void> {
  const unpublish = page.getByRole('button', { name: t.publish.unpublish });
  // The panel reads the status after load; give it the time to show the button when published.
  await expect(state(page)).not.toHaveText(t.publish.none, { timeout: 3_000 }).catch(() => undefined);
  if ((await unpublish.count()) === 0) return;
  await unpublish.click();
  await expect(state(page)).toHaveText(withdrawn, CONFIRMED);
}

async function sitePage(path: string): Promise<{ status: number; html: string; ids: string[] }> {
  const response = await fetch(requireLoopback(`${DEMO_SITE_URL}${path}`), { redirect: 'manual', cache: 'no-store' });
  const html = await response.text();
  return { status: response.status, html, ids: parseEntryMarkers(html).map((m) => m.id) };
}

test('a singleton shown on a shared page: publish and withdrawal confirmed there, and preview opens it', async ({ page }) => {
  test.setTimeout(20 * 60_000);
  await ensureDemoSite(page);
  const entryId = await openSingleton(page, 'events-page');
  await startUnpublished(page, t.publish.removed);

  // Publish: no slug is asked for, and the marker on /events confirms it.
  const tag = randomBytes(3).toString('hex');
  const published = `Kynning ${tag}`;
  await page.getByLabel(INTRO).fill(published);
  await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);
  await page.getByRole('button', { name: t.publish.publish }).click();
  await expect(state(page)).toHaveText(t.publish.live, CONFIRMED);
  const shown = await sitePage('/events');
  expect(shown.status).toBe(200);
  expect(shown.html).toContain(published);
  expect(shown.ids).toContain(entryId);

  // Preview: a draft change opens on the page that shows it, not the site's home page.
  const draft = `Uppkast kynningar ${tag}`;
  await page.getByLabel(INTRO).fill(draft);
  await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);
  const previewRoute = page.waitForRequest((r) => r.url().startsWith(`${DEMO_SITE_URL}/api/cms/preview?`));
  await page.getByRole('button', { name: t.preview.open }).click();
  expect(new URL((await previewRoute).url()).searchParams.get('path')).toBe('/events');
  await page.waitForURL(`${DEMO_SITE_URL}/events`, { timeout: 30_000 });
  await expect(page.getByText(draft)).toBeVisible();
  expect((await sitePage('/events')).html).not.toContain(draft);

  // Unpublish: confirmed once /events answers 200 without the entry (no 404 is asked of a shared page).
  await page.goto(`/t/demo/events-page/${entryId}`);
  await expect(state(page)).toHaveText(t.publish.live, CONFIRMED);
  await page.getByRole('button', { name: t.publish.unpublish }).click();
  await expect(state(page)).toHaveText(t.publish.removed, CONFIRMED);
  await expect(detail(page)).toHaveText(t.publish.removedDetail);
  const gone = await sitePage('/events');
  expect(gone.status).toBe(200);
  expect(gone.ids).not.toContain(entryId);
  expect(gone.html).not.toContain(published);
});

test('a singleton with no site integration: published but not confirmed, in words, never the tick', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  await ensureDemoSite(page);
  await openSingleton(page, 'site-info');
  await startUnpublished(page, t.publish.removedNothingChecked);

  await page.getByLabel(SITE_NAME).fill(`Demó ${randomBytes(3).toString('hex')}`);
  await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);
  await page.getByRole('button', { name: t.publish.publish }).click();
  await expect(state(page)).toHaveText(t.publish.liveNothingChecked, CONFIRMED);
  await expect(detail(page)).toHaveText(t.publish.liveNothingCheckedDetail);
  await expect(page.getByText(t.publish.live)).toHaveCount(0);

  // Withdrawn again, so the demo tenant's overview is as other specs expect it; never "Tekið af vef".
  await page.getByRole('button', { name: t.publish.unpublish }).click();
  await expect(state(page)).toHaveText(t.publish.removedNothingChecked, CONFIRMED);
  await expect(detail(page)).toHaveText(t.publish.removedNothingCheckedDetail);
});
