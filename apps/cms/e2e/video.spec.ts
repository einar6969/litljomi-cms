// A11: the `video` field kind, as editor_demo against the local CMS and stack. The demo event's
// optional `program` group holds `videos`, a list of video fields (modules/demo). An address is
// pasted without https:// and recognised, an unknown one is named as such, the title and a still
// are filled in; each change is autosaved and comes back after a reload. Publishing delivers the
// provider and id derived from the address, and copies the still to media-public: the worker copies
// only the assets the database's reference extraction found, so the copy shows the asset reference
// inside the video, inside the list, inside the group, was found.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { t } from '../src/i18n/is';
import { demoPointer, getJson, newDemoEvent } from './support/demo-release';
import { DEMO_DELIVERY_BASE_URL } from './support/demo-site';
import { editorHeadersOf, entryDetail, supabaseGet } from './support/editor-api';
import { SUPABASE_URL } from './support/local';
import { sessionState } from './support/session';
import { expect, test } from './support/test';

test.use({ storageState: sessionState('editor_demo') });

const JPEG = readFileSync(join(import.meta.dirname, 'fixtures', 'rugbraud.jpg'));
const SAVED = { timeout: 10_000 };
/** The worker's build and pointer write (the publish spec waits up to this long for a release). */
const RELEASED = { timeout: 120_000, intervals: [1000] };
const UPLOAD_PREFIX = `${SUPABASE_URL}/storage/v1/object/media-private/`;
const YT = 'dQw4w9WgXcQ';
const v = t.editor.video;
const recognised = (provider: 'youtube' | 'vimeo', id: string) => v.recognised.replace('{provider}', v.providers[provider]).replace('{id}', id);
const itemName = (n: number) => t.editor.list.item.replace('{label}', 'Video').replace('{n}', String(n));

type Bundle = { entries: Record<string, Array<{ id: string; data: Record<string, unknown> }>> };
type Program = { videos?: Array<{ _key: string; value: unknown }> };

/** The demo event's delivered `program.videos` in the current release, or null when it is not there. */
async function deliveredVideos(entryId: string): Promise<unknown> {
  const p = await demoPointer();
  if (!p) return null;
  const bundle = await getJson<Bundle>(`${DEMO_DELIVERY_BASE_URL}/demo/${p.bundle}`);
  const entry = bundle?.entries['event']?.find((e) => e.id === entryId);
  return (entry?.data['program'] as Program | null | undefined)?.videos ?? null;
}

test('a video in a list in a group: address recognised, title and still, autosaved, reloaded and published', async ({ page }) => {
  test.setTimeout(5 * 60_000);
  const { entryId } = await newDemoEvent(page, `Myndbönd ${randomBytes(4).toString('hex')}`);
  const program = page.getByRole('group', { name: 'Program' });
  const videos = program.getByRole('group', { name: 'Videos' });
  await expect(page.getByText(t.editor.unsupportedField)).toHaveCount(0);

  await videos.getByRole('button', { name: t.editor.list.add }).click();
  const item = videos.getByRole('group', { name: itemName(1), exact: true });
  const address = item.getByRole('textbox', { name: v.url, exact: true });
  // A new item's first control takes focus.
  await expect(address).toBeFocused();
  await expect(item.getByText(v.help)).toBeVisible();

  await test.step('an unknown address is named as such', async () => {
    await address.fill('example.com/myndband');
    await expect(item.getByRole('alert')).toHaveText(v.unknown);
    await expect(address).toHaveAttribute('aria-invalid', 'true');
  });

  await test.step('an address without https:// is recognised', async () => {
    await address.fill(`youtu.be/${YT}`);
    await expect(item.getByRole('alert')).toHaveCount(0);
    await expect(item.getByText(recognised('youtube', YT))).toBeVisible();
    await expect(address).toHaveAttribute('aria-invalid', 'false');
  });

  await item.getByRole('textbox', { name: v.title, exact: true }).fill('Opnunin');

  const uploadRequest = page.waitForRequest((r) => r.method() === 'POST' && r.url().startsWith(UPLOAD_PREFIX));
  await item.locator('input[type="file"]').setInputFiles({ name: 'Rúgbrauð.jpg', mimeType: 'image/jpeg', buffer: JPEG });
  const request = await uploadRequest;
  const editor = await editorHeadersOf(request);
  const [, assetId, filename] = decodeURIComponent(request.url().slice(UPLOAD_PREFIX.length)).split('/');
  await expect(item.locator('img[data-testid$="-still-preview"]')).toHaveAttribute('src', /\/object\/sign\/media-private\//, SAVED);
  await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);

  await test.step('the draft holds the normalised address, the title and the still as an image value', async () => {
    type Detail = { data: { program?: Program } };
    const stored = async () => (await entryDetail<Detail>(editor, entryId)).data.program?.videos?.[0]?.value;
    await expect.poll(stored, SAVED).toEqual({ url: `https://youtu.be/${YT}`, title: 'Opnunin', still: { _ref: assetId, _kind: 'asset', alt: '' } });
  });

  await page.reload();
  const reloaded = page.getByRole('group', { name: itemName(1), exact: true });
  await expect(reloaded.getByRole('textbox', { name: v.url, exact: true })).toHaveValue(`https://youtu.be/${YT}`);
  await expect(reloaded.getByText(recognised('youtube', YT))).toBeVisible();
  await expect(reloaded.getByRole('textbox', { name: v.title, exact: true })).toHaveValue('Opnunin');
  await expect(reloaded.locator('img[data-testid$="-still-preview"]')).toHaveAttribute('src', /\/object\/sign\/media-private\//, SAVED);

  await test.step('publishing delivers the provider and id, and copies the still to media-public', async () => {
    const publicPath = `/storage/v1/object/public/media-public/demo/${assetId}/${filename}`;
    expect((await supabaseGet(publicPath)).ok).toBe(false);
    await page.getByRole('button', { name: t.publish.publish }).click();
    await expect.poll(() => deliveredVideos(entryId), RELEASED).not.toBeNull();
    const [delivered] = (await deliveredVideos(entryId)) as Array<{ _key: string; value: Record<string, unknown> }>;
    // The local stack serves media over http on its own loopback address, which the projection
    // delivers on a local stack (enhancement A4): the still is the full asset, as on a hosted project.
    const stillUrl = new URL(`${SUPABASE_URL}${publicPath}`).href;
    expect(delivered!.value).toEqual({
      provider: 'youtube',
      id: YT,
      url: `https://youtu.be/${YT}`,
      title: 'Opnunin',
      still: { id: assetId, url: stillUrl, width: expect.any(Number), height: expect.any(Number), mime: 'image/jpeg', alt: '', focal: null, caption: null, credit: null },
    });
    // The copy exists only because extraction found the reference at program.videos[0].value.still,
    // and the delivered address is the one a site loads.
    await expect.poll(async () => (await supabaseGet(publicPath)).status, RELEASED).toBe(200);
    expect((await fetch(stillUrl, { cache: 'no-store' })).status).toBe(200);
  });
});
