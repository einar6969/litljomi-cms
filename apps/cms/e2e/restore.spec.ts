// M2-16: restore from a revision (spec §5.5, §7.1), as editor_demo against the local CMS, the
// local stack and the demo site (see publish.spec.ts for the worker and site setup). A demo event
// is published, edited and published again; the history lists both publications, newest first and
// the live one marked; restoring the first puts its title back in the form (a normal versioned save,
// nothing published yet), and publishing it delivers the first title under a new revision.
import { randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { t } from '../src/i18n/is';
import { demoPointer, ensureDemoSite, getJson, newDemoEvent, TITLE } from './support/demo-release';
import { DEMO_DELIVERY_BASE_URL } from './support/demo-site';
import { sessionState } from './support/session';
import { expect, test } from './support/test';

test.use({ storageState: sessionState('editor_demo') });

const h = t.editor.history;
const SAVED = { timeout: 10_000 };
const CONFIRMED = { timeout: 150_000 };

type Bundle = { entries: Record<string, Array<{ id: string; revisionId: string; title: string | null }>> };

/** The entry as the demo tenant's current release delivers it, or null when it is absent. */
async function delivered(entryId: string) {
  const p = await demoPointer();
  if (!p) return null;
  const bundle = await getJson<Bundle>(`${DEMO_DELIVERY_BASE_URL}/demo/${p.bundle}`);
  return bundle?.entries['event']?.find((e) => e.id === entryId) ?? null;
}

const state = (page: Page) => page.getByTestId('publish-state');
const history = (page: Page) => page.getByRole('region', { name: h.title });
const revisions = (page: Page) => history(page).getByTestId('revision');

async function publishAndWait(page: Page) {
  await page.getByRole('button', { name: t.publish.publish }).click();
  await expect(state(page)).not.toHaveText(t.publish.live);
  await expect(state(page)).toHaveText(t.publish.live, CONFIRMED);
}

test('publish twice, restore the first publication, publish: the site gets the first title again', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  await ensureDemoSite(page);

  const first = `Fyrsti titill ${randomBytes(3).toString('hex')}`;
  const second = `Annar titill ${randomBytes(3).toString('hex')}`;
  const { entryId } = await newDemoEvent(page, first);
  await expect(history(page)).toContainText(h.empty);
  await publishAndWait(page);
  const firstRevision = (await delivered(entryId))!.revisionId;

  await page.getByLabel(TITLE).fill(second);
  await expect(page.getByRole('status').filter({ hasText: t.editor.saved })).toHaveText(t.editor.saved, SAVED);
  await publishAndWait(page);
  expect(await delivered(entryId)).toMatchObject({ title: second });

  // The page lists both publications, newest first; the second is the one on the site.
  await page.reload();
  await expect(revisions(page)).toHaveCount(2);
  await expect(revisions(page).nth(0)).toContainText(h.current);
  await expect(revisions(page).nth(0)).toContainText(h.byMe);
  await expect(revisions(page).nth(1)).not.toContainText(h.current);

  // Restore the first: asked first, then the form shows its title; the site is unchanged.
  await revisions(page).nth(1).getByRole('button', { name: h.restore }).click();
  await expect(history(page)).toContainText(h.confirm);
  await history(page).getByRole('button', { name: h.confirmRestore }).click();
  await expect(page).toHaveURL(/[?&]restored=1$/);
  await expect(page.getByText(h.restored)).toBeVisible();
  await expect(page.getByLabel(TITLE)).toHaveValue(first);
  expect(await delivered(entryId)).toMatchObject({ title: second });

  // A normal publish delivers the first title again, under a new revision.
  await publishAndWait(page);
  const after = (await delivered(entryId))!;
  expect(after.title).toBe(first);
  expect(after.revisionId).not.toBe(firstRevision);
  await page.reload();
  await expect(revisions(page)).toHaveCount(3);

  // Taken down again, so later specs do not see it.
  await page.getByRole('button', { name: t.publish.unpublish }).click();
  await expect(state(page)).toHaveText(t.publish.removed, CONFIRMED);
});
