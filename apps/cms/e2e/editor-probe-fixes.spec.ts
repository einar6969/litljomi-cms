// Enhancements A6 and A10 (an archive control, and the fixes the first editor probe found: its
// frictions table, §13, and its Hub bugs, §14), as editor_demo (the session saved by the
// editor-session setup project), against the local CMS, the local stack and the demo site. The
// demo event (modules/demo) has a required `Title` and `Start date`, a rich-text `Description` and
// an optional `Related event` reference.
//
// Every URL this file reaches is loopback (the browser context aborts anything else, support/test.ts).
import { randomBytes } from 'node:crypto';
import type { Page, Route } from '@playwright/test';
import { t } from '../src/i18n/is';
import { ensureDemoSite, newDemoEvent, TITLE } from './support/demo-release';
import { createEvent } from './support/editor';
import { sessionState } from './support/session';
import { expect, test } from './support/test';

test.use({ storageState: sessionState('editor_demo') });

const SAVED = { timeout: 10_000 };
// The worker's build, notification and live check (polling up to 60 s, §7.4), plus the 2 s poll.
const CONFIRMED = { timeout: 150_000 };
const RELATED = 'Related event';
const DESCRIPTION = 'Description';
const state = (page: Page) => page.getByTestId('publish-state');
const run = () => randomBytes(4).toString('hex');
const saved = (page: Page) => expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);

/** A paste into the focused rich-text box, as the browser delivers one. */
async function paste(page: Page, name: string, html: string) {
  const box = page.getByRole('textbox', { name });
  await box.click();
  await box.evaluate((element, value) => {
    const data = new DataTransfer();
    data.setData('text/html', value);
    data.setData('text/plain', 'x');
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, html);
}

test.describe('A6: archive an entry that is not published', () => {
  test('asks first, archives, and the entry leaves the list; it is listed under the archived filter', async ({ page }) => {
    const title = `Í skjalasafn ${run()}`;
    const entryId = await createEvent(page);
    await page.getByLabel(TITLE).fill(title);
    await saved(page);

    const archive = page.getByRole('region', { name: t.editor.archive.title });
    await archive.getByRole('button', { name: t.editor.archive.button }).click();
    await expect(archive).toContainText(t.editor.archive.confirm);
    await archive.getByRole('button', { name: t.editor.archive.confirmButton }).click();

    await expect(page).toHaveURL(/\/t\/demo\/event$/);
    await expect(page.getByRole('link', { name: title })).toHaveCount(0);
    await page.goto(`/t/demo/event?status=archived&q=${encodeURIComponent(title)}`);
    const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: title }) });
    await expect(row).toContainText(t.entries.statuses.archived);
    await expect(row.getByRole('link', { name: title })).toHaveAttribute('href', new RegExp(`${entryId}$`));
  });

  test('is not offered for a published entry', async ({ page }) => {
    test.setTimeout(10 * 60_000);
    await ensureDemoSite(page);
    await newDemoEvent(page, `Birt ${run()}`);
    await expect(page.getByRole('region', { name: t.editor.archive.title })).toBeVisible();
    await page.getByRole('button', { name: t.publish.publish }).click();
    await expect(page.getByRole('region', { name: t.editor.archive.title })).toHaveCount(0);
    await expect(state(page)).toHaveText(t.publish.live, CONFIRMED);
    await expect(page.getByRole('region', { name: t.editor.archive.title })).toHaveCount(0);
    // Taken down again, so later specs do not see it; then it can be archived.
    await page.getByRole('button', { name: t.publish.unpublish }).click();
    await expect(state(page)).toHaveText(t.publish.removed, CONFIRMED);
    await expect(page.getByRole('region', { name: t.editor.archive.title })).toBeVisible();
  });
});

test.describe('A10: editor fixes from the probe', () => {
  test('a required field is marked in the form; an optional one is not (§14, 1)', async ({ page }) => {
    await createEvent(page);
    const label = (name: string) => page.getByRole('textbox', { name, exact: true }).locator('xpath=ancestor::label[1]');
    await expect(label(TITLE).locator('[data-required-marker]')).toBeVisible();
    await expect(label('Start date').locator('[data-required-marker]')).toBeVisible();
    await expect(label('Location').locator('[data-required-marker]')).toHaveCount(0);
    // The marker is not part of the field's accessible name (it is aria-hidden); getByLabel reads the
    // label's text, so the role query is the one that says what assistive technology hears.
    await expect(page.getByRole('textbox', { name: TITLE, exact: true })).toBeVisible();
  });

  test('the panel reads the status before it claims anything, and an edit after publishing is "Óbirtar breytingar" (§14, 10 and 11)', async ({ page }) => {
    test.setTimeout(10 * 60_000);
    await ensureDemoSite(page);
    await newDemoEvent(page, `Breytingar ${run()}`);
    await page.getByRole('button', { name: t.publish.publish }).click();
    await expect(state(page)).toHaveText(t.publish.live, CONFIRMED);

    // Opening the published entry: while its status read is held back, the panel never says "Ekki birt".
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/rest/v1/publication_status*', async (route: Route) => {
      await held;
      await route.fallback().catch(() => undefined);
    });
    await page.reload();
    await expect(state(page)).toHaveText(t.publish.loading);
    release();
    await expect(state(page)).toHaveText(t.publish.live, CONFIRMED);
    await page.unrouteAll({ behavior: 'ignoreErrors' });

    // An edit is saved: the site still has the published version.
    await page.getByLabel('Location').fill(`Staður ${run()}`);
    await saved(page);
    await expect(state(page)).toHaveText(t.publish.changed);
    await expect(page.getByTestId('publish-detail')).toHaveText(t.publish.changedDetail);
    await page.reload();
    await expect(state(page)).toHaveText(t.publish.changed, CONFIRMED);

    // Published again, it is live; then taken down so later specs do not see it.
    await page.getByRole('button', { name: t.publish.publish }).click();
    await expect(state(page)).toHaveText(t.publish.live, CONFIRMED);
    await page.getByRole('button', { name: t.publish.unpublish }).click();
    await expect(state(page)).toHaveText(t.publish.removed, CONFIRMED);
  });

  test('a publish refused for an unpublished reference names it by its title', async ({ page }) => {
    const target = `Óbirt markmið ${run()}`;
    await createEvent(page);
    await page.getByLabel(TITLE).fill(target);
    await saved(page);

    await newDemoEvent(page, `Vísar í óbirt ${run()}`);
    const picker = page.getByLabel(RELATED);
    await expect(picker).toBeEnabled();
    await picker.selectOption({ label: `${target} (${t.entries.statuses.draft})` });
    await saved(page);
    await page.getByRole('button', { name: t.publish.publish }).click();
    await expect(state(page)).toHaveText(`${t.publish.invalid} ${RELATED}`, CONFIRMED);
    await expect(page.getByTestId('publish-lines')).toHaveText(`${RELATED}: „${target}“ ${t.publish.reference.unpublished}`);
    await expect(page.getByTestId('publish-detail')).toHaveText(t.publish.reference.detail);
  });

  test('pasted Word lists stay lists, a level-1 heading becomes level 2, and a left-out table is said in one line', async ({ page }) => {
    await createEvent(page);
    await page.getByLabel(TITLE).fill(`Límt ${run()}`);
    const item = (marker: string, text: string) =>
      `<p class=MsoListParagraph style='mso-list:l0 level1 lfo1'><![if !supportLists]><span style='mso-list:Ignore'>${marker}<span>&nbsp;&nbsp;</span></span><![endif]>${text}<o:p></o:p></p>`;
    await paste(page, DESCRIPTION, `<h1>Fyrirsögn</h1>${item('·', 'Brauð')}${item('·', 'Kaka')}`);
    const box = page.getByRole('textbox', { name: DESCRIPTION });
    await expect(box.locator('h2')).toHaveText('Fyrirsögn');
    await expect(box.locator('ul > li')).toHaveText(['Brauð', 'Kaka']);
    await expect(box).not.toContainText('·');
    await expect(page.getByTestId('field-description-paste-note')).toHaveCount(0);

    await paste(page, DESCRIPTION, '<table><tr><td>CellA1</td><td>CellB1</td></tr></table><p><img src="file:///C:/mynd.png"></p>');
    await expect(page.getByTestId('field-description-paste-note')).toHaveText(t.editor.richText.droppedBoth);
    // The pasted slice's first paragraph joins the item the cursor is in ("Kaka"), as pasting does.
    await expect(box.locator('p', { hasText: 'CellA1' })).toHaveText(/CellA1$/);
    await expect(box.locator('p', { hasText: 'CellB1' })).toHaveText('CellB1');
    await saved(page);
  });

  test('a save conflict is brought into view and focused when it appears (§14, 7)', async ({ page, context }) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    await createEvent(page);
    await page.getByLabel(TITLE).fill('Fyrri flipi');
    await saved(page);

    const second = await context.newPage();
    await second.goto(page.url());
    await second.getByLabel(TITLE).fill('Seinni flipi');
    await saved(second);

    // The first tab edits a field far down the form, then its save is refused.
    const intro = page.getByLabel('Introduction');
    await intro.scrollIntoViewIfNeeded();
    await intro.fill('Neðst á síðunni');
    const notice = page.getByRole('alert').filter({ hasText: t.editor.conflict });
    await expect(notice).toBeInViewport(SAVED);
    await expect(notice).toBeFocused();
    await second.close();
  });

  for (const width of [1024, 1440]) {
    test(`at ${width} px the save status and the publish panel stay in view on a long form`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 });
      await createEvent(page);
      await page.getByLabel(TITLE).fill(`Langt form ${run()}`);
      await saved(page);
      await page.getByLabel('Introduction').fill('x');
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expect(page.getByRole('status')).toBeInViewport();
      await expect(page.getByRole('button', { name: t.publish.publish })).toBeInViewport();
    });
  }

  // Below 1024 px the panel was already pinned to the bottom (probe §13: usable at 375 px).
  test('at 1023 px the publish panel stays pinned to the bottom', async ({ page }) => {
    await page.setViewportSize({ width: 1023, height: 700 });
    await createEvent(page);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
    await expect(page.getByRole('button', { name: t.publish.publish })).toBeInViewport();
  });
});
