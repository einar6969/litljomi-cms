// Plan M2-12: an image's focal point chosen with the keyboard, its visible focus ring (the Task 31
// r3 Minor), and the asset detail page, as editor_labak against the local CMS and stack.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { t } from '../src/i18n/is';
import { createNews } from './support/editor';
import { apiRows, editorHeadersOf, type EditorHeaders } from './support/editor-api';
import { SUPABASE_URL } from './support/local';
import { sessionState } from './support/session';
import { expect, test } from './support/test';

test.use({ storageState: sessionState('editor_labak') });

const JPEG = readFileSync(join(import.meta.dirname, 'fixtures', 'rugbraud.jpg'));
const SAVED = { timeout: 10_000 };
const UPLOAD_PREFIX = `${SUPABASE_URL}/storage/v1/object/media-private/`;

type Metadata = { focal_x: number | null; focal_y: number | null; default_alt: string | null };
const metadataOf = async (editor: EditorHeaders, assetId: string) =>
  (await apiRows<Metadata>(editor, `asset_list?select=focal_x,focal_y,default_alt&id=eq.${assetId}`))[0];

test('sets the focal point with the keyboard, with a visible focus ring, and edits the asset on its detail page', async ({ page }) => {
  await createNews(page);
  const uploadRequest = page.waitForRequest((r) => r.method() === 'POST' && r.url().startsWith(UPLOAD_PREFIX));
  await page.locator('#field-image').setInputFiles({ name: 'Rúgbrauð.jpg', mimeType: 'image/jpeg', buffer: JPEG });
  const request = await uploadRequest;
  const editor = await editorHeadersOf(request);
  const assetId = decodeURIComponent(request.url().slice(UPLOAD_PREFIX.length)).split('/')[1]!;
  await expect(page.getByTestId('field-image-preview')).toHaveAttribute('src', /\/object\/sign\/media-private\//, SAVED);

  const picker = page.getByRole('button', { name: t.editor.image.focalLabel });
  await test.step('the picker is reached with Tab and shows the focus ring', async () => {
    await page.locator('#field-image-alt').focus();
    await page.keyboard.press('Shift+Tab');
    await expect(picker).toBeFocused();
    const ring = await picker.evaluate((el) => {
      const style = getComputedStyle(el);
      return { visible: el.matches(':focus-visible'), style: style.outlineStyle, width: style.outlineWidth };
    });
    expect(ring).toEqual({ visible: true, style: 'solid', width: '2px' });
  });

  await test.step('arrow keys move the point from the centre and save it', async () => {
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowUp');
    await expect(page.getByTestId('field-image-focal-value')).toContainText('60 % frá vinstri, 49 % ofan frá');
    await expect(page.getByTestId('field-image-notice')).toHaveText(t.editor.image.focalSaved, SAVED);
    await expect.poll(() => metadataOf(editor, assetId), SAVED).toEqual({ focal_x: 0.6, focal_y: 0.49, default_alt: null });
  });

  await test.step('the detail page opens in a new tab, keeps the focal point and saves the default alt text', async () => {
    const [detail] = await Promise.all([page.context().waitForEvent('page'), page.getByRole('link', { name: t.editor.image.details }).click()]);
    await detail.waitForLoadState();
    await expect(detail.getByRole('heading', { level: 1 })).toHaveText(t.asset.title);
    await expect(detail.getByTestId('asset-filename')).toHaveText('rugbraud.jpg');
    await expect(detail.getByTestId('asset-dimensions')).toHaveText('64 × 48 px');
    await expect(detail.getByTestId('asset-focal-value')).toContainText('60 % frá vinstri, 49 % ofan frá');
    await detail.getByLabel(t.library.detail.alt, { exact: true }).fill('Rúgbrauð á borði');
    await detail.getByRole('button', { name: t.library.detail.save }).click();
    await expect(detail.getByTestId('asset-notice')).toHaveText(t.library.detail.saved, SAVED);
    expect(await metadataOf(editor, assetId)).toEqual({ focal_x: 0.6, focal_y: 0.49, default_alt: 'Rúgbrauð á borði' });

    // Removing the focal point there keeps the alt text just saved.
    await detail.getByRole('button', { name: t.editor.image.clearFocal }).click();
    await expect(detail.getByTestId('asset-focal-value')).toHaveText(t.editor.image.focalNone, SAVED);
    await expect.poll(() => metadataOf(editor, assetId), SAVED).toEqual({ focal_x: null, focal_y: null, default_alt: 'Rúgbrauð á borði' });
    await detail.close();
  });

  await test.step('a malformed or unknown asset id is not found', async () => {
    for (const id of ['x', '00000000-0000-4000-8000-000000000000']) {
      const response = await page.goto(`/t/labak/assets/${id}`);
      expect(response?.status()).toBe(404);
    }
  });
});
