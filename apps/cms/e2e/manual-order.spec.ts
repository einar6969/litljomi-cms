// A12: the list of a manually ordered type (spec §5.1), as editor_demo against the local CMS and
// stack. The demo module's `partner` type is ordered by hand. Three partners are created; the list
// shows them newest first; each is moved by button, by the handle's arrow key and by dragging the
// handle, at 1440 and at 375 px, each move saved at once (the order survives a reload) and said in
// words; a move whose request fails puts the list back with a plain error; the search and the
// status filter still narrow the list. Every list here is searched for this run's names, so what
// earlier runs left in the local database does not count.
import { randomBytes } from 'node:crypto';
import { expect, type Locator, type Page } from '@playwright/test';
import { t } from '../src/i18n/is';
import { CMS_URL } from './support/local';
import { sessionState } from './support/session';
import { test } from './support/test';

test.use({ storageState: sessionState('editor_demo') });

const SAVED = { timeout: 10_000 };
const o = t.entries.order;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PARTNER_URL = new RegExp(`^${CMS_URL}/t/demo/partner/(${UUID})$`);
const label = (s: string, title: string) => s.replace('{title}', title);

/** Creates a partner from the Partners list and names it. */
async function createPartner(page: Page, name: string): Promise<void> {
  await page.goto('/t/demo');
  await page.getByRole('main').getByRole('link', { name: 'Partners' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Partners');
  await page.getByRole('button', { name: t.entries.new }).click();
  await page.waitForURL(PARTNER_URL);
  await page.getByLabel('Name').fill(name);
  await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);
}

const rows = (page: Page): Locator => page.locator('table.entry-table tbody tr');
/** The titles of the list, in the order shown. */
const titles = (page: Page) => rows(page).locator('td a').allTextContents();
const handle = (page: Page, title: string) => page.getByRole('button', { name: label(o.handle, title), exact: true });

test('a manually ordered list: newest first, moved by button, key and drag at 1440 and 375 px, each saved at once', async ({ page }) => {
  const run = randomBytes(4).toString('hex');
  const [a, b, c] = ['Alfa', 'Beta', 'Gamma'].map((n) => `${n} ${run}`) as [string, string, string];
  for (const name of [a, b, c]) await createPartner(page, name);
  const list = `/t/demo/partner?q=${run}`;

  await test.step('newest first, with the order column and its help', async () => {
    await page.goto(list);
    await expect.poll(() => titles(page)).toEqual([c, b, a]);
    await expect(page.getByRole('columnheader', { name: o.column })).toBeVisible();
    await expect(page.locator('#entry-order-help')).toContainText(o.help);
    // A search is on: the help says the hidden entries keep their places.
    await expect(page.locator('#entry-order-help')).toContainText(o.filtered);
  });

  await test.step('a button moves the entry one place and says where it is now', async () => {
    await page.getByRole('button', { name: label(o.moveDown, c), exact: true }).click();
    await expect.poll(() => titles(page)).toEqual([b, c, a]);
    await expect(page.getByTestId('order-status')).toHaveText(label(o.moved, c).replace('{n}', '2').replace('{total}', '3'), SAVED);
    await page.reload();
    await expect.poll(() => titles(page)).toEqual([b, c, a]);
  });

  await test.step("the handle's arrow key moves it, and focus stays on it", async () => {
    await handle(page, a).focus();
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => titles(page)).toEqual([b, a, c]);
    await expect(handle(page, a)).toBeFocused();
    await expect(page.getByTestId('order-status')).toHaveText(label(o.moved, a).replace('{n}', '2').replace('{total}', '3'), SAVED);
    await page.reload();
    await expect.poll(() => titles(page)).toEqual([b, a, c]);
  });

  await test.step('dragging the handle onto the upper half of another row puts it before that row', async () => {
    const from = await handle(page, c).boundingBox();
    const to = await rows(page).nth(0).boundingBox();
    if (!from || !to) throw new Error('no layout');
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 4, { steps: 8 });
    await expect(rows(page).nth(0)).toHaveAttribute('data-drop', 'before');
    await page.mouse.up();
    await expect.poll(() => titles(page)).toEqual([c, b, a]);
    await expect(page.getByTestId('order-status')).toHaveText(label(o.moved, c).replace('{n}', '1').replace('{total}', '3'), SAVED);
    await page.reload();
    await expect.poll(() => titles(page)).toEqual([c, b, a]);
  });

  await test.step('at 375 px: every control is a 44 px target, nothing overflows, and a move works', async () => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.reload();
    for (const name of [label(o.handle, b), label(o.moveUp, b), label(o.moveDown, b)]) {
      const box = await page.getByRole('button', { name, exact: true }).boundingBox();
      expect(box, name).not.toBeNull();
      expect(box!.width, name).toBeGreaterThanOrEqual(44);
      expect(box!.height, name).toBeGreaterThanOrEqual(44);
      expect(box!.x + box!.width, name).toBeLessThanOrEqual(375);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await page.getByRole('button', { name: label(o.moveUp, b), exact: true }).click();
    await expect.poll(() => titles(page)).toEqual([b, c, a]);
    await expect(page.getByTestId('order-status')).toHaveText(label(o.moved, b).replace('{n}', '1').replace('{total}', '3'), SAVED);
    await page.reload();
    await expect.poll(() => titles(page)).toEqual([b, c, a]);

    // Dragging at 375 px, as a mouse would (a real finger was not tried).
    const from = await handle(page, a).boundingBox();
    const to = await rows(page).nth(0).boundingBox();
    if (!from || !to) throw new Error('no layout');
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 4, to.y + to.height / 4, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => titles(page)).toEqual([a, b, c]);
    await page.reload();
    await expect.poll(() => titles(page)).toEqual([a, b, c]);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await test.step('a move whose request fails puts the list back and says so', async () => {
    await page.goto(list);
    await expect.poll(() => titles(page)).toEqual([a, b, c]);
    // The server action is a POST to the page; fail exactly that.
    const listPage = (url: URL) => url.pathname === '/t/demo/partner';
    await page.route(listPage, (route) => (route.request().method() === 'POST' ? route.abort('failed') : route.continue()));
    await page.getByRole('button', { name: label(o.moveDown, a), exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText(o.failed, SAVED);
    await expect.poll(() => titles(page)).toEqual([a, b, c]);
    await page.unroute(listPage);
    await page.reload();
    await expect.poll(() => titles(page)).toEqual([a, b, c]);
  });

  await test.step('the search and the status filter still narrow the list, in the same order', async () => {
    await page.goto(`/t/demo/partner?q=${encodeURIComponent(`Beta ${run}`)}`);
    await expect.poll(() => titles(page)).toEqual([b]);
    await page.goto(`/t/demo/partner?q=${run}&status=draft`);
    await expect.poll(() => titles(page)).toEqual([a, b, c]);
    await page.goto(`/t/demo/partner?q=${run}&status=published`);
    await expect(page.getByText(t.entries.filter.none)).toBeVisible();
  });
});
