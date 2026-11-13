// M2-15: the list and group inputs, as editor_demo against the local CMS and stack. The demo
// event's optional `program` group holds a text field and a list of event references (modules/demo).
// Items are added, filled in, reordered with the keyboard and removed; each change is autosaved
// and comes back after a reload. Media library L6: its list of images (`gallery`, at most 12) takes
// twelve files at once from the library picker, uploaded inside it, in the order chosen; they are
// reordered, published and read back from the bundle; and the same is done with the keyboard only.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { t } from '../src/i18n/is';
import { demoPointer, getJson, newDemoEvent } from './support/demo-release';
import { DEMO_DELIVERY_BASE_URL } from './support/demo-site';
import { createEvent } from './support/editor';
import { apiRows, editorHeadersOf, entryDetail, type EditorHeaders } from './support/editor-api';
import { SUPABASE_URL } from './support/local';
import { sessionState } from './support/session';
import { expect, test } from './support/test';

test.use({ storageState: sessionState('editor_demo') });

const SAVED = { timeout: 10_000 };
const item = (n: number) => t.editor.list.item.replace('{label}', 'Event').replace('{n}', String(n));
const fill = (s: string, n: number) => s.replace('{item}', item(n));

test('a group with a list: add, fill in, reorder by keyboard and remove, each autosaved', async ({ page }) => {
  // Fresh titles per run: the local database keeps earlier runs' entries.
  const run = randomBytes(4).toString('hex');
  const ids: Record<string, string> = {};
  for (const name of ['Fyrsti', 'Annar']) {
    ids[name] = await createEvent(page);
    await page.getByLabel('Title').fill(`${name} ${run}`);
    await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);
  }
  const option = (name: string) => ({ label: `${name} ${run} (${t.entries.statuses.draft})` });

  await createEvent(page);
  await page.getByLabel('Title').fill(`Dagskrá ${run}`);
  const program = page.getByRole('group', { name: 'Program' });
  const highlights = program.getByRole('group', { name: 'Highlights' });
  await expect(page.getByText(t.editor.unsupportedField)).toHaveCount(0);
  await program.getByLabel('Introduction').fill('Kvöldið hefst klukkan átta.');
  await expect(page.locator('#field-program-highlights-help')).toHaveText('Mest 10 atriði.');

  await test.step('add two items and pick an event in each', async () => {
    await highlights.getByRole('button', { name: t.editor.list.add }).click();
    await expect(highlights.getByRole('combobox', { name: item(1), exact: true })).toBeEnabled();
    await highlights.getByRole('combobox', { name: item(1), exact: true }).selectOption(option('Fyrsti'));
    await highlights.getByRole('button', { name: t.editor.list.add }).click();
    await expect(highlights.getByRole('combobox', { name: item(2), exact: true })).toBeEnabled();
    await highlights.getByRole('combobox', { name: item(2), exact: true }).selectOption(option('Annar'));
    await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);
  });

  await test.step('move the second item up with the arrow key on its handle', async () => {
    await highlights.getByRole('button', { name: fill(t.editor.list.handle, 2) }).focus();
    await page.keyboard.press('ArrowUp');
    await expect(highlights.getByRole('combobox', { name: item(1), exact: true })).toHaveValue(ids.Annar!);
    await expect(highlights.getByRole('combobox', { name: item(2), exact: true })).toHaveValue(ids.Fyrsti!);
    // Focus stays on the moved item's handle.
    await expect(highlights.getByRole('button', { name: fill(t.editor.list.handle, 1) })).toBeFocused();
    await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);
  });

  await page.reload();
  await expect(page.getByLabel('Introduction')).toHaveValue('Kvöldið hefst klukkan átta.');
  await expect(page.getByRole('combobox', { name: item(1), exact: true })).toBeEnabled();
  await expect(page.getByRole('combobox', { name: item(1), exact: true })).toHaveValue(ids.Annar!);
  await expect(page.getByRole('combobox', { name: item(2), exact: true })).toHaveValue(ids.Fyrsti!);

  await test.step('remove the first item', async () => {
    await page.getByRole('button', { name: fill(t.editor.list.remove, 1) }).click();
    await expect(page.getByRole('combobox', { name: item(1), exact: true })).toHaveValue(ids.Fyrsti!);
    await expect(page.getByRole('combobox', { name: item(2), exact: true })).toHaveCount(0);
    await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);
  });

  await page.reload();
  await expect(page.getByRole('combobox', { name: item(1), exact: true })).toBeEnabled();
  await expect(page.getByRole('combobox', { name: item(1), exact: true })).toHaveValue(ids.Fyrsti!);
  await expect(page.getByRole('combobox', { name: item(2), exact: true })).toHaveCount(0);
});

const JPEG = readFileSync(join(import.meta.dirname, 'fixtures', 'rugbraud.jpg'));
const UPLOADED = { timeout: 60_000 };
/** The worker's build and pointer write (the publish spec waits up to this long for a release). */
const RELEASED = { timeout: 120_000, intervals: [1000] };
const UPLOAD_PREFIX = `${SUPABASE_URL}/storage/v1/object/media-private/`;
const photo = (n: number) => t.editor.list.item.replace('{label}', 'Photo').replace('{n}', String(n));

type Gallery = Array<{ _key: string; value: { _ref: string; _kind: 'asset'; alt: string } | null }>;
type Bundle = { entries: Record<string, Array<{ id: string; data: Record<string, unknown> }>> };

/** The draft's gallery, read with the editor's session. */
async function draftGallery(editor: EditorHeaders, entryId: string): Promise<Gallery> {
  const detail = await entryDetail<{ data: { program?: { gallery?: Gallery } } }>(editor, entryId);
  return detail.data.program?.gallery ?? [];
}

/** The gallery's file names, in the draft's order. */
async function galleryNames(editor: EditorHeaders, entryId: string): Promise<string[]> {
  const gallery = await draftGallery(editor, entryId);
  const ids = gallery.map((item) => item.value!._ref);
  if (ids.length === 0) return [];
  const rows = await apiRows<{ id: string; filename: string }>(editor, `asset_list?select=id,filename&id=in.(${ids.join(',')})`);
  return ids.map((id) => rows.find((r) => r.id === id)?.filename ?? id);
}

/** The delivered event's `program.gallery` in the current release, or null when it is not there. */
async function deliveredGallery(entryId: string): Promise<Array<{ _key: string }> | null> {
  const p = await demoPointer();
  if (!p) return null;
  const bundle = await getJson<Bundle>(`${DEMO_DELIVERY_BASE_URL}/demo/${p.bundle}`);
  const entry = bundle?.entries['event']?.find((e) => e.id === entryId);
  return ((entry?.data['program'] as { gallery?: Array<{ _key: string }> } | null | undefined)?.gallery as Array<{ _key: string }> | undefined) ?? null;
}

test('a list of images takes twelve files from the library at once, in the order chosen; reordered and published', async ({ page }) => {
  test.setTimeout(5 * 60_000);
  const run = randomBytes(3).toString('hex');
  const { entryId } = await newDemoEvent(page, `Myndasafn ${run}`);
  const gallery = page.getByRole('group', { name: 'Program' }).getByRole('group', { name: 'Gallery' });
  const picker = page.getByTestId('library-picker');
  const names = Array.from({ length: 12 }, (_, i) => `Mynd ${run} ${String(i + 1).padStart(2, '0')}.jpg`);
  const stored = names.map((n) => n.toLowerCase().replace(/ /g, '-'));

  const uploadRequest = page.waitForRequest((r) => r.method() === 'POST' && r.url().startsWith(UPLOAD_PREFIX));
  await test.step('upload twelve inside the picker: they arrive selected, in the order chosen', async () => {
    await gallery.getByRole('button', { name: t.editor.list.addFromLibrary }).click();
    await expect(picker.getByRole('heading', { level: 2 })).toHaveText(t.picker.titleMany);
    await picker.locator('input[type="file"]').setInputFiles(names.map((name) => ({ name, mimeType: 'image/jpeg', buffer: JPEG })));
    await expect(picker.getByTestId('upload-summary')).toHaveText(t.upload.resultMany.replace('{n}', '12'), UPLOADED);
    await expect(picker.getByTestId('picker-count')).toHaveText(t.picker.selectedMany.replace('{n}', '12'));
    await picker.getByRole('button', { name: t.picker.confirmMany.replace('{n}', '12') }).click();
    await expect(picker).toHaveCount(0);
  });
  const editor = await editorHeadersOf(await uploadRequest);

  await expect(gallery.getByRole('group', { name: photo(12), exact: true })).toBeVisible();
  // Full at twelve: neither way of adding is offered.
  await expect(gallery.getByRole('button', { name: t.editor.list.addFromLibrary })).toBeDisabled();
  await expect(gallery.getByRole('button', { name: t.editor.list.add, exact: true })).toBeDisabled();
  await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);
  await expect.poll(() => galleryNames(editor, entryId), SAVED).toEqual(stored);

  await test.step('reorder: the last photo moves up one with its handle', async () => {
    await gallery.getByRole('button', { name: t.editor.list.handle.replace('{item}', photo(12)) }).focus();
    await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);
    await expect.poll(() => galleryNames(editor, entryId), SAVED).toEqual([...stored.slice(0, 10), stored[11], stored[10]]);
  });

  await test.step('publish: the bundle carries the twelve in the new order', async () => {
    const keys = (await draftGallery(editor, entryId)).map((item) => item._key);
    await page.getByRole('button', { name: t.publish.publish }).click();
    await expect.poll(() => deliveredGallery(entryId), RELEASED).not.toBeNull();
    // Local media is served over http, which the projection does not deliver (probe section 14,
    // item 13), so each value is null here; the keys show the order.
    expect((await deliveredGallery(entryId))!.map((item) => item._key)).toEqual(keys);
  });
});

test('a list of images from the library with the keyboard only', async ({ page }) => {
  const run = randomBytes(3).toString('hex');
  await newDemoEvent(page, `Lyklasafn ${run}`);
  const gallery = page.getByRole('group', { name: 'Program' }).getByRole('group', { name: 'Gallery' });
  const picker = page.getByTestId('library-picker');
  const addFromLibrary = gallery.getByRole('button', { name: t.editor.list.addFromLibrary });

  // Two files of this run, uploaded in the picker, then left out of the list.
  await addFromLibrary.click();
  await picker.locator('input[type="file"]').setInputFiles([`Lykill ${run} a.jpg`, `Lykill ${run} b.jpg`].map((name) => ({ name, mimeType: 'image/jpeg', buffer: JPEG })));
  await expect(picker.getByTestId('upload-summary')).toHaveText(t.upload.resultMany.replace('{n}', '2'), UPLOADED);
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(addFromLibrary).toBeFocused();
  await expect(gallery.getByRole('group', { name: photo(1), exact: true })).toHaveCount(0);

  await page.keyboard.press('Enter');
  await expect(picker.getByRole('searchbox', { name: t.library.search })).toBeFocused();
  await page.keyboard.type(run);
  await page.keyboard.press('Enter');
  const options = picker.getByRole('option');
  await expect(options).toHaveCount(2);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  // The second file is chosen first: the selection keeps that order.
  await expect(options.nth(0)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(options.nth(1)).toBeFocused();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Space');
  await expect(picker.getByTestId('picker-count')).toHaveText(t.picker.selectedMany.replace('{n}', '2'));
  await page.keyboard.press('Enter');
  await expect(picker).toHaveCount(0);
  await expect(addFromLibrary).toBeFocused();
  await expect(gallery.getByRole('group', { name: photo(2), exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);
});
