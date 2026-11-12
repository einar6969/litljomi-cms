// Media library L4 and L5 (docs/plans/media-library.md sections 6 and 8): the library page at 1440,
// 768 and 375 px (search, both filters, both views, a file's details, a saved caption, a usage
// link, a keyboard-only pass) and an upload of several files at once, as editor_labak against the
// local CMS and stack. The local database keeps earlier runs' files, so every file name carries a
// per-run token and the library is searched for it.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { t } from '../src/i18n/is';
import { createNews, NEWS_ENTRY_URL } from './support/editor';
import { apiRows, editorHeadersOf } from './support/editor-api';
import { SUPABASE_URL } from './support/local';
import { sessionState } from './support/session';
import { expect, test } from './support/test';

test.use({ storageState: sessionState('editor_labak') });

const JPEG = readFileSync(join(import.meta.dirname, 'fixtures', 'rugbraud.jpg'));
const SAVED = { timeout: 15_000 };
const TITLE = 'Titill';
const WIDTHS = [1440, 768, 375] as const;
const UPLOAD_PREFIX = `${SUPABASE_URL}/storage/v1/object/media-private/`;

const jpeg = (name: string) => ({ name, mimeType: 'image/jpeg', buffer: JPEG });
const cards = (page: Page) => page.getByTestId('library-grid').getByRole('link');
const queueRow = (page: Page, name: string): Locator => page.getByTestId('upload-queue').getByRole('listitem').filter({ hasText: name });

/** Uploads the files through the library's own button and waits for the batch's sentence. */
async function uploadInLibrary(page: Page, files: ReturnType<typeof jpeg>[], result: string) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: t.library.upload }).click();
  await (await chooser).setFiles(files);
  await expect(page.getByTestId('upload-summary')).toHaveText(result, SAVED);
}

async function search(page: Page, q: string) {
  await page.getByRole('searchbox', { name: t.library.search }).fill(q);
  await page.getByRole('button', { name: t.entries.filter.submit }).click();
  await page.waitForURL(new RegExp(`[?&]q=${q}`));
}

test('uploads several files at once: three arrive, and a file too large and one of the wrong type are named with their reason', async ({ page }) => {
  const token = randomBytes(3).toString('hex');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/t/labak');
  await page.getByRole('navigation', { name: t.tenant.navigation }).getByRole('link', { name: t.library.title }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.library.title);

  await uploadInLibrary(
    page,
    [
      jpeg(`Kaka ${token} 1.jpg`),
      { name: `Risi ${token}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.alloc(20_971_521) },
      jpeg(`Kaka ${token} 2.jpg`),
      { name: `Skjal ${token}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n') },
      jpeg(`Kaka ${token} 3.jpg`),
    ],
    '3 skrár eru komnar í safnið. Ekki tókst að hlaða upp 2 skrám.',
  );
  await expect(queueRow(page, `Risi ${token}.jpg`).getByRole('alert')).toHaveText(t.editor.image.size);
  await expect(queueRow(page, `Skjal ${token}.pdf`).getByRole('alert')).toHaveText(t.editor.image.type);
  await expect(page.getByTestId('upload-queue').getByRole('listitem')).toHaveCount(2);

  // A failed row leaves the list on request.
  await queueRow(page, `Skjal ${token}.pdf`).getByRole('button', { name: `${t.upload.remove}: Skjal ${token}.pdf` }).click();
  await expect(page.getByTestId('upload-queue').getByRole('listitem')).toHaveCount(1);

  // The library has loaded again, newest first: the three are at the top, each with its thumbnail.
  await expect(cards(page).filter({ hasText: token })).toHaveCount(3);
  await search(page, token);
  await expect(cards(page)).toHaveCount(3);
  for (const img of await cards(page).locator('img').all()) {
    await expect(img).toHaveAttribute('src', /\/thumb\/480\.webp\?/);
  }
});

test('the library at 1440, 768 and 375 px: search, filters, both views, details, a saved caption and a usage link', async ({ page }) => {
  const token = randomBytes(3).toString('hex');

  // One image used by a news entry's draft, through its image field; two nobody uses.
  const entryId = await createNews(page);
  await page.getByLabel(TITLE).fill(`Kökufrétt ${token}`);
  const uploadRequest = page.waitForRequest((r) => r.method() === 'POST' && r.url().startsWith(UPLOAD_PREFIX));
  await page.locator('#field-image').setInputFiles(jpeg(`Notud ${token}.jpg`));
  const request = await uploadRequest;
  const editor = await editorHeadersOf(request);
  const used = decodeURIComponent(request.url().slice(UPLOAD_PREFIX.length)).split('/')[1]!;
  await expect(page.getByTestId('field-image-preview')).toBeVisible(SAVED);
  await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);
  await page.goto('/t/labak/assets');
  await uploadInLibrary(page, [jpeg(`Onotud ${token} a.jpg`), jpeg(`Onotud ${token} b.jpg`)], '2 skrár eru komnar í safnið.');

  for (const width of WIDTHS) {
    await test.step(`at ${width} px`, async () => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/t/labak/assets');
      if (width === 375) {
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, 'the library scrolls sideways at 375 px').toBeLessThanOrEqual(0);
      }

      await search(page, token);
      await expect(cards(page)).toHaveCount(3);

      // The unused filter leaves out the image the draft uses; the missing-alt filter keeps all three.
      await page.getByRole('link', { name: t.library.filter.unused, exact: true }).click();
      await expect(page).toHaveURL(/filter=unused/);
      await expect(cards(page)).toHaveCount(2);
      await expect(cards(page).filter({ hasText: `notud-${token}` })).toHaveCount(0);
      await page.getByRole('link', { name: t.library.filter.missingAlt }).click();
      await expect(page).toHaveURL(/filter=missing-alt/);
      await expect(cards(page)).toHaveCount(3);

      // The list view shows the same files in a table, with the usage count.
      await page.getByRole('link', { name: t.library.view.list }).click();
      await expect(page).toHaveURL(/view=list/);
      const table = page.getByRole('table');
      await expect(table.getByRole('row')).toHaveCount(4);
      await expect(table.getByRole('row').filter({ hasText: `notud-${token}.jpg` }).getByRole('cell').last()).toHaveText('1');
      await page.getByRole('link', { name: t.library.view.grid }).click();
      await expect(cards(page)).toHaveCount(3);

      // A file's details: on wide screens beside the files, below 1024 px over them.
      await cards(page).filter({ hasText: `notud-${token}` }).click();
      await expect(page).toHaveURL(new RegExp(`file=${used}`));
      const panel = page.getByTestId('asset-panel');
      await expect(panel.getByRole('heading', { level: 2 })).toBeFocused();
      await expect(page.getByTestId('library-grid')).toBeVisible({ visible: width >= 1024 });
      await expect(panel.getByRole('link', { name: t.library.detail.back })).toBeVisible({ visible: width < 1024 });
      const usage = page.getByTestId('asset-usage');
      await expect(usage.getByRole('link', { name: `Kökufrétt ${token}` })).toBeVisible();
      await expect(usage).toContainText(t.library.usage.draft);

      const caption = `Nýbakað ${token} ${width}`;
      await panel.getByLabel(t.library.detail.caption).fill(caption);
      await panel.getByRole('button', { name: t.library.detail.save }).click();
      await expect(page.getByTestId('asset-notice')).toHaveText(t.library.detail.saved, SAVED);
      expect(await apiRows(editor, `asset_list?select=caption&id=eq.${used}`)).toEqual([{ caption }]);

      // Closing returns to the files and focus to the card.
      if (width >= 1024) await panel.getByRole('link', { name: t.library.detail.close }).click();
      else await panel.getByRole('link', { name: t.library.detail.back }).click();
      await expect(page).not.toHaveURL(/file=/);
      await expect(cards(page).filter({ hasText: `notud-${token}` })).toBeFocused();
    });
  }

  await test.step('a usage link opens the entry', async () => {
    await page.goto(`/t/labak/assets?file=${used}`);
    await page.getByTestId('asset-usage').getByRole('link', { name: `Kökufrétt ${token}` }).click();
    await page.waitForURL(NEWS_ENTRY_URL);
    expect(NEWS_ENTRY_URL.exec(page.url())![1]).toBe(entryId);
  });
});

test('the library with the keyboard only', async ({ page }) => {
  const token = randomBytes(3).toString('hex');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/t/labak/assets');
  await uploadInLibrary(page, [jpeg(`Lykill ${token} a.jpg`), jpeg(`Lykill ${token} b.jpg`)], '2 skrár eru komnar í safnið.');
  await page.goto(`/t/labak/assets?q=${token}`);

  // "/" jumps to the search; the grid is one tab stop after the toolbar.
  await page.keyboard.press('/');
  await expect(page.getByRole('searchbox', { name: t.library.search })).toBeFocused();
  const first = cards(page).first();
  const second = cards(page).nth(1);
  await first.focus();
  await page.keyboard.press('ArrowRight');
  await expect(second).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(first).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(second).not.toBeFocused();

  // Enter opens the details and moves focus to their heading; Escape closes them and focus returns.
  await first.focus();
  const name = (await first.getAttribute('aria-label'))!;
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/file=/);
  await expect(page.getByTestId('asset-panel').getByRole('heading', { level: 2 })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/file=/);
  await expect(page.getByTestId('library-grid').getByRole('link', { name, exact: true })).toBeFocused();
});
