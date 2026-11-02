// Task 25: publish, unpublish and the verified status, as editor_demo (the session saved by the
// editor-session setup project), against the local CMS, the local stack and the real demo site on
// DEMO_SITE_URL (started by the `demo-site` webServer, demo-site-server.ts). The worker runs in the
// CMS: the editor's action triggers it through CMS_PUBLIC_URL with CMS_INTERNAL_SECRET (both set on
// the CMS webServer), and it notifies and live-checks the demo site.
//
// Every URL this file reaches is loopback (requireLoopback; the browser context aborts anything
// else, support/test.ts): the CMS, the demo site, and the local stack's public delivery bucket.
import { randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { parseEntryMarkers } from '@litljomi/cms-sdk/src/parse-markers.ts';
import { t } from '../src/i18n/is';
import { DEMO_DELIVERY_BASE_URL, DEMO_SITE_URL } from './support/demo-site';
import { createEvent } from './support/editor';
import { requireLoopback } from './support/local';
import { sessionState } from './support/session';
import { expect, test } from './support/test';

test.use({ storageState: sessionState('editor_demo') });

// The demo module's own field labels (an English fixture tenant, decision 37.6).
const TITLE = 'Title';
const START = 'Start date';
const SAVED = { timeout: 10_000 };
// The worker's build, notification and live check (polling up to 60 s, §7.4), plus the 2 s poll.
const CONFIRMED = { timeout: 150_000 };
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A state on the way to live, or live already (the worker may be faster than the 2 s poll). */
const ON_THE_WAY = new RegExp(`^(${[t.publish.inProgress, t.publish.revalidated, t.publish.live].map(escape).join('|')})$`);

type Pointer = { release: number; bundle: string };
type Bundle = { entries: Record<string, Array<{ id: string; slug: string | null; contentHash: string }>> };

async function getJson<T>(url: string): Promise<T | null> {
  const response = await fetch(requireLoopback(url), { redirect: 'error', cache: 'no-store' });
  return response.ok ? ((await response.json()) as T) : null;
}

const pointer = () => getJson<Pointer>(`${DEMO_DELIVERY_BASE_URL}/demo/current.json`);

/** The content hash the demo tenant's current release gives the entry, or null when it is absent. */
async function currentHash(entryId: string): Promise<string | null> {
  const p = await pointer();
  if (!p) return null;
  const bundle = await getJson<Bundle>(`${DEMO_DELIVERY_BASE_URL}/demo/${p.bundle}`);
  return bundle?.entries['event']?.find((e) => e.id === entryId)?.contentHash ?? null;
}

async function sitePage(path: string): Promise<{ status: number; markers: { id: string; hash: string }[] }> {
  const response = await fetch(requireLoopback(`${DEMO_SITE_URL}${path}`), { redirect: 'manual', cache: 'no-store' });
  return { status: response.status, markers: parseEntryMarkers(await response.text()) };
}

const state = (page: Page) => page.getByTestId('publish-state');

/** Creates an event with a fresh slug, fills its required fields and waits for the autosave. */
async function newEvent(page: Page, title: string): Promise<{ entryId: string; slug: string }> {
  const entryId = await createEvent(page);
  const slug = `vidburdur-${randomBytes(5).toString('hex')}`;
  await page.getByLabel(TITLE).fill(title);
  await page.getByLabel(START).fill('2026-12-01');
  await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);
  await page.getByLabel(t.editor.slug.label).fill(slug);
  await page.getByRole('button', { name: t.editor.slug.save }).click();
  await expect(page.getByTestId('slug-notice')).toHaveText(t.editor.slug.saved);
  return { entryId, slug };
}

/**
 * The demo site is built from the tenant's current release. After a database reset there is none:
 * then a first event is published through the editor (its own delivery cannot be confirmed yet,
 * as the site is not up), and the demo-site webServer builds the site once the pointer is public.
 */
async function demoSiteReady(page: Page): Promise<void> {
  if (!(await pointer())) {
    await newEvent(page, 'Fyrsti viðburður');
    await page.getByRole('button', { name: t.publish.publish }).click();
    await expect.poll(pointer, { timeout: 120_000, intervals: [1000] }).not.toBeNull();
  }
  await expect
    .poll(async () => (await fetch(requireLoopback(`${DEMO_SITE_URL}/events`)).catch(() => null))?.status ?? 0, {
      timeout: 600_000,
      intervals: [2000],
      message: 'the demo site did not start (see the demo-site webServer output)',
    })
    .toBe(200);
}

test('publish, edit and republish, then unpublish a demo event, each confirmed on the demo site', async ({ page }) => {
  test.setTimeout(20 * 60_000);
  await demoSiteReady(page);

  // Publish: the states progress to "Birt á vef ✓".
  const { entryId, slug } = await newEvent(page, `Viðburður ${randomBytes(3).toString('hex')}`);
  await expect(state(page)).toHaveText(t.publish.none);
  await page.getByRole('button', { name: t.publish.publish }).click();
  await expect(state(page)).toHaveText(ON_THE_WAY);
  await expect(state(page)).toHaveText(t.publish.live, CONFIRMED);
  const firstHash = await currentHash(entryId);
  expect(firstHash).toMatch(/^[0-9a-f]{64}$/);
  const first = await sitePage(`/events/${slug}`);
  expect(first.status).toBe(200);
  expect(first.markers).toContainEqual({ id: entryId, hash: firstHash });

  // Edit and republish: confirmed against the new hash.
  await page.getByLabel(TITLE).fill(`Breyttur viðburður ${randomBytes(3).toString('hex')}`);
  await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);
  await page.getByRole('button', { name: t.publish.publish }).click();
  await expect(state(page)).not.toHaveText(t.publish.live);
  await expect(state(page)).toHaveText(t.publish.live, CONFIRMED);
  const secondHash = await currentHash(entryId);
  expect(secondHash).toMatch(/^[0-9a-f]{64}$/);
  expect(secondHash).not.toBe(firstHash);
  const second = await sitePage(`/events/${slug}`);
  expect(second.markers).toContainEqual({ id: entryId, hash: secondHash });
  expect(second.markers).not.toContainEqual({ id: entryId, hash: firstHash });

  // Unpublish: "Tekið af vef", and its detail promises nothing about caches.
  await page.getByRole('button', { name: t.publish.unpublish }).click();
  await expect(state(page)).toHaveText(t.publish.removed, CONFIRMED);
  await expect(page.getByTestId('publish-detail')).toHaveText(t.publish.removedDetail);
  expect(await currentHash(entryId)).toBeNull();
  const gone = await sitePage(`/events/${slug}`);
  expect(gone.status).toBe(404);
  expect(gone.markers.map((m) => m.id)).not.toContain(entryId);
  await expect(page.getByRole('button', { name: t.publish.unpublish })).toHaveCount(0);
});
