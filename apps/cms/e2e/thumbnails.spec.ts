// Media library L2 (docs/plans/media-library.md sections 5 and 8): an image field and the asset
// detail show the file's thumbnail, and the browser never requests the original after uploading
// it, as editor_labak against the local CMS and stack.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext, Request } from '@playwright/test';
import { t } from '../src/i18n/is';
import { createNews } from './support/editor';
import { SUPABASE_URL } from './support/local';
import { sessionState } from './support/session';
import { expect, test } from './support/test';

test.use({ storageState: sessionState('editor_labak') });

const JPEG = readFileSync(join(import.meta.dirname, 'fixtures', 'rugbraud.jpg'));
const SAVED = { timeout: 15_000 };
const UPLOAD_PREFIX = `${SUPABASE_URL}/storage/v1/object/media-private/`;
const THUMBNAIL = /\/object\/sign\/media-private\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/thumb\/480\.webp\?/;

/** Every request any page of the context makes to Storage, kept for the whole test. */
function storageRequests(context: BrowserContext): Request[] {
  const seen: Request[] = [];
  context.on('request', (r) => {
    if (r.url().startsWith(`${SUPABASE_URL}/storage/`)) seen.push(r);
  });
  return seen;
}

/** The requests that would load the original: any but the upload itself that names its object. */
const originalLoads = (requests: Request[], originalPath: string) =>
  requests.filter((r) => decodeURIComponent(new URL(r.url()).pathname).includes(originalPath) && !(r.method() === 'POST' && r.url().startsWith(UPLOAD_PREFIX))).map((r) => `${r.method()} ${r.url()}`);

test('an image field and the asset detail show the thumbnail and never request the original', async ({ page }) => {
  const requests = storageRequests(page.context());
  await createNews(page);
  const uploadRequest = page.waitForRequest((r) => r.method() === 'POST' && r.url().startsWith(UPLOAD_PREFIX));
  await page.locator('#field-image').setInputFiles({ name: 'Rúgbrauð.jpg', mimeType: 'image/jpeg', buffer: JPEG });
  const originalPath = decodeURIComponent((await uploadRequest).url().slice(UPLOAD_PREFIX.length));
  expect(originalPath).toMatch(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/rugbraud\.jpg$/);

  await test.step('the field shows the thumbnail once the upload is registered', async () => {
    const preview = page.getByTestId('field-image-preview');
    await expect(preview).toHaveAttribute('src', THUMBNAIL, SAVED);
    await expect.poll(() => preview.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth), SAVED).toBe(64);
    expect(originalLoads(requests, originalPath)).toEqual([]);
  });

  await test.step('after a reload, the saved field signs the thumbnail again, not the original', async () => {
    await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);
    await page.reload();
    await expect(page.getByTestId('field-image-preview')).toHaveAttribute('src', THUMBNAIL, SAVED);
    expect(originalLoads(requests, originalPath)).toEqual([]);
  });

  await test.step('the detail page shows the thumbnail too', async () => {
    const [detail] = await Promise.all([page.context().waitForEvent('page'), page.getByRole('link', { name: t.editor.image.details }).click()]);
    await detail.waitForLoadState();
    await expect(detail.getByTestId('asset-preview')).toHaveAttribute('src', THUMBNAIL, SAVED);
    await expect.poll(() => detail.getByTestId('asset-preview').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth), SAVED).toBe(64);
    expect(originalLoads(requests, originalPath)).toEqual([]);
    await detail.close();
  });
});
