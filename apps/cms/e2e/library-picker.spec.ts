// Media library L6 (docs/plans/media-library.md sections 6.3 to 6.5): the library in an image
// field, as editor_labak against the local CMS and stack. "Velja úr safni" opens the library in
// pick mode; a file uploaded there arrives selected and is used at once; a file chosen from the
// library brings its default alt text; replacing an image keeps the alt text of this use; a file
// dropped on the empty field's box is uploaded; the dialog is worked with the keyboard only and
// fills the screen at 375 px. The local database keeps earlier runs' files, so every file name
// carries a per-run token and the picker is searched for it. The list case is in list-group.spec.ts.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { t } from '../src/i18n/is';
import { createNews } from './support/editor';
import { sessionState } from './support/session';
import { expect, test } from './support/test';

test.use({ storageState: sessionState('editor_labak') });

const JPEG = readFileSync(join(import.meta.dirname, 'fixtures', 'rugbraud.jpg'));
const SAVED = { timeout: 15_000 };
const TITLE = 'Titill';
const jpeg = (name: string) => ({ name, mimeType: 'image/jpeg', buffer: JPEG });

const picker = (page: Page) => page.getByTestId('library-picker');
const options = (page: Page) => picker(page).getByRole('option');
const imageField = (page: Page) => page.getByRole('group', { name: 'Mynd', exact: true });

async function searchPicker(page: Page, q: string) {
  const search = picker(page).getByRole('searchbox', { name: t.library.search });
  await search.fill(q);
  await search.press('Enter');
}

test('an image field: upload inside the picker and use it; choose from the library with its default alt; replace and keep the alt', async ({ page }) => {
  const token = randomBytes(3).toString('hex');
  await page.setViewportSize({ width: 1440, height: 900 });
  await createNews(page);
  await page.getByLabel(TITLE).fill(`Myndaval ${token}`);
  const field = imageField(page);
  // The two ways in read apart.
  await expect(field.getByText(t.editor.image.choose, { exact: true })).toBeVisible();

  await test.step('upload inside the picker: the file arrives selected and is used', async () => {
    await field.getByRole('button', { name: t.editor.image.fromLibrary }).click();
    await expect(picker(page)).toBeVisible();
    await expect(picker(page).getByRole('heading', { level: 2 })).toHaveText(t.picker.titleOne);
    await picker(page).locator('input[type="file"]').setInputFiles(jpeg(`Val ${token}.jpg`));
    await expect(picker(page).getByTestId('upload-summary')).toHaveText(t.upload.resultOne.replace('{n}', '1'), SAVED);
    await expect(options(page).first()).toHaveAttribute('aria-selected', 'true');
    await expect(options(page).first()).toHaveAccessibleName(`val-${token}.jpg`);
    await picker(page).getByTestId('picker-confirm').click();
    await expect(picker(page)).toHaveCount(0);
    await expect(page.getByTestId('field-image-preview')).toBeVisible(SAVED);
    await expect(page.locator('#field-image-alt')).toHaveValue('');
  });

  await test.step('give it a default alt text from the field', async () => {
    await page.locator('#field-image-alt').fill(`Rúgbrauð ${token}`);
    await field.getByRole('button', { name: t.editor.image.saveDefaultAlt }).click();
    await expect(page.getByTestId('field-image-notice')).toHaveText(t.editor.image.defaultAltSaved);
    await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);
  });

  await test.step('a new entry chooses the file from the library and gets its default alt text', async () => {
    await createNews(page);
    await page.getByLabel(TITLE).fill(`Myndaval 2 ${token}`);
    await imageField(page).getByRole('button', { name: t.editor.image.fromLibrary }).click();
    await searchPicker(page, token);
    await expect(options(page)).toHaveCount(1);
    await expect(options(page).first()).toHaveAccessibleName(`val-${token}.jpg, Rúgbrauð ${token}`);
    await options(page).first().click();
    await picker(page).getByRole('button', { name: t.picker.confirmOne }).click();
    await expect(page.locator('#field-image-alt')).toHaveValue(`Rúgbrauð ${token}`);
    // Focus is back on the field's library button.
    await expect(imageField(page).getByRole('button', { name: t.editor.image.fromLibrary })).toBeFocused();
  });

  await test.step('replacing the image by upload keeps the alt text of this use', async () => {
    await page.locator('#field-image-alt').fill(`Mín lýsing ${token}`);
    await page.locator('#field-image').setInputFiles(jpeg(`Skipti ${token}.jpg`));
    await expect(page.getByTestId('field-image-preview')).toBeVisible(SAVED);
    await expect(page.locator('#field-image-alt')).toHaveValue(`Mín lýsing ${token}`);
    await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);
  });
});

test('a file dropped on the empty image box is uploaded', async ({ page }) => {
  const token = randomBytes(3).toString('hex');
  await createNews(page);
  await page.getByLabel(TITLE).fill(`Sleppt ${token}`);
  const box = imageField(page).locator('.drop');
  const transfer = await page.evaluateHandle(
    ({ bytes, name }) => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(bytes)], name, { type: 'image/jpeg' }));
      return data;
    },
    { bytes: [...JPEG], name: `Sleppt ${token}.jpg` },
  );
  await box.dispatchEvent('dragover', { dataTransfer: transfer });
  await expect(box).toHaveAttribute('data-over', 'true');
  await box.dispatchEvent('drop', { dataTransfer: transfer });
  await expect(page.getByTestId('field-image-preview')).toBeVisible(SAVED);
  await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);
});

test('the picker with the keyboard only, and at 375 px filling the screen', async ({ page }) => {
  const token = randomBytes(3).toString('hex');
  await page.setViewportSize({ width: 1440, height: 900 });
  await createNews(page);
  await page.getByLabel(TITLE).fill(`Lyklaval ${token}`);
  // Two files to choose between, uploaded in the picker and left unused.
  const opener = imageField(page).getByRole('button', { name: t.editor.image.fromLibrary });
  await opener.click();
  await picker(page).locator('input[type="file"]').setInputFiles(jpeg(`Lykill ${token} a.jpg`));
  await expect(picker(page).getByTestId('upload-summary')).toHaveText(t.upload.resultOne.replace('{n}', '1'), SAVED);
  await page.keyboard.press('Escape');
  await expect(picker(page)).toHaveCount(0);
  await expect(opener).toBeFocused();

  // Enter on the button opens the picker with focus in its search; Escape closes it from anywhere.
  await page.keyboard.press('Enter');
  const search = picker(page).getByRole('searchbox', { name: t.library.search });
  await expect(search).toBeFocused();
  await page.keyboard.type(token);
  await page.keyboard.press('Enter');
  await expect(options(page)).toHaveCount(1);
  // The upload button, then the files as one tab stop.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(options(page).first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(picker(page)).toHaveCount(0);
  await expect(page.getByTestId('field-image-preview')).toBeVisible(SAVED);
  await expect(imageField(page).getByRole('button', { name: t.editor.image.fromLibrary })).toBeFocused();

  await test.step('at 375 px the picker fills the screen and nothing scrolls sideways', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await imageField(page).getByRole('button', { name: t.editor.image.fromLibrary }).click();
    await expect(options(page).first()).toBeVisible();
    const box = (await picker(page).boundingBox())!;
    expect(box).toMatchObject({ x: 0, y: 0, width: 375, height: 812 });
    const overflow = await picker(page).evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await picker(page).getByRole('button', { name: t.library.detail.close }).click();
    await expect(picker(page)).toHaveCount(0);
  });
});
