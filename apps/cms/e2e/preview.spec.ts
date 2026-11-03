// M3-12: preview a demo draft through "Forskoða" (spec §7.5), as editor_demo, against the local CMS,
// the local stack and the real demo site (the `demo-site` webServer). The event is published
// first, then its title is changed in the draft: the editor's preview shows the draft on the demo
// site in draft mode, and a normal visitor still gets the published page.
//
// The seeded demo site has a preview URL and secret (seedIntegration, M3-12); demo-site-server.ts
// gives the site the same secret and the local CMS as its preview endpoint. Every URL this file
// reaches is loopback (requireLoopback; the browser context aborts anything else, support/test.ts).
import { randomBytes } from 'node:crypto';
import { parseEntryMarkers } from '@litljomi/cms-sdk/src/parse-markers.ts';
import { t } from '../src/i18n/is';
import { ensureDemoSite, newDemoEvent, TITLE } from './support/demo-release';
import { DEMO_SITE_URL } from './support/demo-site';
import { requireLoopback } from './support/local';
import { sessionState } from './support/session';
import { expect, newLoopbackContext, test } from './support/test';

test.use({ storageState: sessionState('editor_demo') });

const SAVED = { timeout: 10_000 };
const CONFIRMED = { timeout: 150_000 };
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The demo site's page as a visitor without cookies gets it. */
async function visitorPage(path: string): Promise<{ status: number; html: string }> {
  const response = await fetch(requireLoopback(`${DEMO_SITE_URL}${path}`), { redirect: 'manual', cache: 'no-store' });
  return { status: response.status, html: await response.text() };
}

test('Forskoða shows the draft on the demo site in draft mode; visitors keep the published page', async ({ page, browser }) => {
  test.setTimeout(10 * 60_000);
  await ensureDemoSite(page);

  const tag = randomBytes(3).toString('hex');
  const published = `Birtur viðburður ${tag}`;
  const draft = `Uppkast viðburðar ${tag}`;
  const { entryId, slug } = await newDemoEvent(page, published);
  await page.getByRole('button', { name: t.publish.publish }).click();
  await expect(page.getByTestId('publish-state')).toHaveText(t.publish.live, CONFIRMED);

  // A draft change, saved but not published.
  await page.getByLabel(TITLE).fill(draft);
  await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);

  // Forskoða: token route, then the site's preview route, then the entry's path in draft mode.
  const previewRoute = page.waitForRequest((r) => r.url().startsWith(`${DEMO_SITE_URL}/api/cms/preview?`));
  await page.getByRole('button', { name: t.preview.open }).click();
  const routeUrl = new URL((await previewRoute).url());
  expect(routeUrl.searchParams.get('path')).toBe(`/events/${slug}`);
  await page.waitForURL(`${DEMO_SITE_URL}/events/${slug}`);
  await expect(page.getByRole('heading', { name: draft })).toBeVisible();
  const previewHtml = await page.content();
  expect(previewHtml).not.toContain(published);
  expect(parseEntryMarkers(previewHtml).map((m) => m.id)).toContain(entryId);
  const cookies = await page.context().cookies(DEMO_SITE_URL);
  const token = cookies.find((c) => c.name === 'cms-preview');
  expect(token?.httpOnly).toBe(true);

  // A normal visitor: the published page, unchanged.
  const visitor = await visitorPage(`/events/${slug}`);
  expect(visitor.status).toBe(200);
  expect(visitor.html).toContain(published);
  expect(visitor.html).not.toContain(draft);
  // And another browser, without the editor's cookies.
  const other = await newLoopbackContext(browser);
  try {
    const otherPage = await other.newPage();
    await otherPage.goto(`${DEMO_SITE_URL}/events/${slug}`);
    await expect(otherPage.getByRole('heading', { name: published })).toBeVisible();
    await expect(otherPage.getByText(new RegExp(escape(draft)))).toHaveCount(0);

    // The preview route refuses a tampered token, and turns no draft mode on.
    const tampered = `${routeUrl.searchParams.get('token') ?? ''}x`;
    const refused = await otherPage.request.get(`${DEMO_SITE_URL}/api/cms/preview?token=${encodeURIComponent(tampered)}&path=%2F`, { maxRedirects: 0 });
    expect(refused.status()).toBe(401);
    expect((await other.cookies(DEMO_SITE_URL)).map((c) => c.name)).not.toContain('__prerender_bypass');
    await otherPage.goto(`${DEMO_SITE_URL}/events/${slug}`);
    await expect(otherPage.getByRole('heading', { name: published })).toBeVisible();
  } finally {
    await other.close();
  }
});
