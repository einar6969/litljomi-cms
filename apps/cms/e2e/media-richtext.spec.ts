// Task 24: a private image upload and the rich-text field, as editor_labak (the session saved by
// the editor-session setup project), against the local CMS and stack. Loopback only; the image is
// the repository's own fixture.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { richTextDocSchema } from '@litljomi/rich-text';
import { t } from '../src/i18n/is';
import { createNews } from './support/editor';
import { apiRows, editorHeadersOf, entryDetail, supabaseGet } from './support/editor-api';
import { SUPABASE_URL } from './support/local';
import { sessionState } from './support/session';
import { expect, test } from './support/test';

test.use({ storageState: sessionState('editor_labak') });

const JPEG = readFileSync(join(import.meta.dirname, 'fixtures', 'rugbraud.jpg'));
// Task 14's Word-like paste fixture (packages/rich-text/src/__tests__/tiptap.test.ts, review focus 2).
const WORD_LIKE = '<table><tr><td>x</td></tr></table><p style="color:red"><s>y</s></p>';
const BODY = 'Meginmál';
const ALT = 'Rúgbrauð á borði';
const SAVED = { timeout: 10_000 };
const UPLOAD_PREFIX = `${SUPABASE_URL}/storage/v1/object/media-private/`;

/**
 * Supabase Storage answers a missing object with 404, or (in some versions) with HTTP 400 and a
 * body whose `statusCode` is "404". Either is "not found"; anything else fails.
 */
async function notFoundStatus(response: Response): Promise<string> {
  if (response.status === 404) return '404';
  const body = (await response.json().catch(() => null)) as { statusCode?: unknown } | null;
  return response.status === 400 && body?.statusCode === '404' ? '404' : `${response.status} ${JSON.stringify(body)}`;
}

test('uploads a JPEG privately, previews it, and saves a pasted Word-like body that validates', async ({ page }) => {
  const entryId = await createNews(page);
  const tenantSlug = new URL(page.url()).pathname.split('/')[2]!;

  // Upload: from the browser straight to media-private, with the editor's session.
  const uploadRequest = page.waitForRequest((r) => r.method() === 'POST' && r.url().startsWith(UPLOAD_PREFIX));
  await page.locator('#field-image').setInputFiles({ name: 'Rúgbrauð.jpg', mimeType: 'image/jpeg', buffer: JPEG });
  const request = await uploadRequest;
  const editor = await editorHeadersOf(request);
  const path = decodeURIComponent(request.url().slice(UPLOAD_PREFIX.length));
  const [tenantId, assetId, filename] = path.split('/');
  expect(filename).toBe('rugbraud.jpg');

  // The preview is a signed URL of the private original, and the image loads.
  const preview = page.getByTestId('field-image-preview');
  await expect(preview).toHaveAttribute('src', new RegExp(`^${SUPABASE_URL}/storage/v1/object/sign/media-private/`), SAVED);
  await expect.poll(() => preview.evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0)), SAVED).toBe(64);
  await page.locator('#field-image-alt').fill(ALT);
  await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);

  await test.step('the object is in media-private and the server registered its real metadata', async () => {
    const object = await supabaseGet(`/storage/v1/object/authenticated/media-private/${path}`, editor);
    expect(object.status).toBe(200);
    expect(Buffer.from(await object.arrayBuffer()).equals(JPEG)).toBe(true);
    const assets = await apiRows<Record<string, unknown>>(editor, `asset_list?select=tenant_id,mime,width,height,original_path,filename&id=eq.${assetId}`);
    expect(assets).toEqual([{ tenant_id: tenantId, mime: 'image/jpeg', width: 64, height: 48, original_path: path, filename }]);
  });

  await test.step('there is no public copy: media-public answers 404, and media-private is not public', async () => {
    // The worker's public path ({tenant_slug}/{asset_id}/{filename}, §5.6) and the private path.
    for (const publicPath of [`${tenantSlug}/${assetId}/${filename}`, path]) {
      expect(await notFoundStatus(await supabaseGet(`/storage/v1/object/public/media-public/${publicPath}`))).toBe('404');
    }
    expect((await supabaseGet(`/storage/v1/object/public/media-private/${path}`)).ok).toBe(false);
    expect((await supabaseGet(`/storage/v1/object/media-private/${path}`)).ok).toBe(false);
  });

  // Rich text: paste the Word-like HTML into the body, as the browser delivers a paste.
  const body = page.getByRole('textbox', { name: BODY });
  await body.click();
  await body.evaluate((element, html) => {
    const data = new DataTransfer();
    data.setData('text/html', html);
    data.setData('text/plain', 'x y');
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, WORD_LIKE);
  await expect(body).toContainText('x');
  await expect(body.locator('table')).toHaveCount(0);

  await test.step('the saved draft validates against richTextDocSchema and keeps the image reference', async () => {
    type Detail = { data: { body?: unknown; image?: unknown } };
    const saved = async () => (await entryDetail<Detail>(editor, entryId)).data;
    await expect.poll(async () => (await saved())?.body !== undefined, SAVED).toBe(true);
    const data = (await saved())!;
    const parsed = richTextDocSchema.safeParse(data.body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    const text = JSON.stringify(data.body);
    for (const stripped of ['table', 'strike', 'style', 'color']) expect(text).not.toContain(stripped);
    expect(text).toContain('"x"');
    expect(text).toContain('"y"');
    expect(data.image).toEqual({ _ref: assetId, _kind: 'asset', alt: ALT });
  });

  // After a reload the form shows the saved image and body again.
  await page.reload();
  await expect(page.getByTestId('field-image-preview')).toHaveAttribute('src', /\/object\/sign\/media-private\//, SAVED);
  await expect(page.locator('#field-image-alt')).toHaveValue(ALT);
  await expect(page.getByRole('textbox', { name: BODY })).toContainText('y');
});

test('a HEIC or PDF is refused before upload (review focus 4)', async ({ page }) => {
  await createNews(page);
  const uploads: string[] = [];
  page.on('request', (r) => {
    if (r.url().startsWith(UPLOAD_PREFIX)) uploads.push(r.url());
  });
  for (const file of [
    { name: 'IMG_0001.heic', mimeType: 'image/heic', buffer: Buffer.from('heic') },
    { name: 'skjal.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') },
  ]) {
    await page.locator('#field-image').setInputFiles(file);
    await expect(page.getByTestId('field-image-notice')).toHaveText(t.editor.image.type);
  }
  expect(uploads).toEqual([]);
});
