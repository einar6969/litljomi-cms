// Media library L2 against the local stack (docs/plans/media-library.md sections 5 and 8; spec
// §5.6): the real server actions, each with a real editor session, on real Storage. A registered
// upload gets its thumbnail at once; a file registered without one (as before L2) gets it on first
// view; another tenant's editor can neither sign nor make it; and after a simulated day the sweep's
// orphan listing leaves it alone. Needs L1's migration (thumb_path, set_asset_thumbnail and the
// orphan rule).
//
// The local database keeps earlier runs' rows, so every file carries a per-run token. Nothing is
// published.
import { randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { signInPersona } from '../../../../../tests/integration/src/clients.ts';
import { TENANT, type PersonaName } from '../../../../../tests/integration/src/fixtures.ts';
import { closeAll, ownerQuery, withTx } from '../../../../../tests/integration/src/sql.ts';

// Every action call runs with the session set here; shared through globalThis, as the integration
// files run in one process without isolation (conflict.integration.test.ts).
const session = vi.hoisted(() => ((globalThis as { editorSession?: { current: unknown } }).editorSession ??= { current: null }));
vi.mock('@/lib/supabase/server', () => ({ createEditorClient: async () => session.current }));

const { assetPreviewAction, ensureThumbnailAction, registerAssetAction } = await import('@/app/(editor)/t/[tenant]/asset-actions');
const { inspectImage } = await import('../server/image-metadata');

type Editor = { client: Awaited<ReturnType<typeof signInPersona>>['client']; as: Record<string, unknown> };

/** A sign-in of the persona, shaped as the CMS's editor client: Auth and Storage, and `api` tables and functions. */
async function signIn(persona: PersonaName): Promise<Editor> {
  const { client } = await signInPersona(persona);
  return {
    client,
    as: { auth: client.auth, storage: client.storage, from: (table: string) => client.schema('api').from(table), rpc: (fn: string, args: unknown) => client.schema('api').rpc(fn, args as never) },
  };
}

const token = randomBytes(4).toString('hex');
const thumbPath = (assetId: string) => `${TENANT.labak}/${assetId}/thumb/480.webp`;
const storedThumb = async (assetId: string) => (await ownerQuery<{ thumb_path: string | null }>('select thumb_path from cms.assets where id = $1', [assetId]))[0]?.thumb_path;
const objectOf = async (name: string) =>
  ownerQuery<{ mimetype: string }>(`select metadata->>'mimetype' as mimetype from storage.objects where bucket_id = 'media-private' and name = $1`, [name]);

let labak: Editor;
let demo: Editor;
// Stored 1600 × 1200 and turned a quarter by EXIF: shown 1200 × 1600, so its thumbnail is 360 × 480.
let jpeg: Uint8Array;

beforeAll(async () => {
  labak = await signIn('editor_labak');
  demo = await signIn('editor_demo');
  jpeg = new Uint8Array(
    await sharp({ create: { width: 1600, height: 1200, channels: 3, background: { r: 200, g: 120, b: 40 } } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer(),
  );
});
afterAll(closeAll);

/** Uploads an original into labak's folder with the editor's session, as the image field does. */
async function upload(name: string): Promise<{ id: string; path: string; filename: string }> {
  const id = randomUUID();
  const filename = `${name}-${token}.jpg`;
  const path = `${TENANT.labak}/${id}/${filename}`;
  const { error } = await labak.client.storage.from('media-private').upload(path, jpeg, { contentType: 'image/jpeg', upsert: false });
  if (error) throw new Error(`upload: ${error.message}`);
  return { id, path, filename };
}

const as = <T>(editor: Editor, fn: () => Promise<T>): Promise<T> => {
  session.current = editor.as;
  return fn();
};

async function fetchImage(url: string) {
  const response = await fetch(url);
  expect(response.status).toBe(200);
  return sharp(new Uint8Array(await response.arrayBuffer())).metadata();
}

describe('thumbnails on real storage (media library L2)', () => {
  it('registration makes, stores and records the thumbnail, and the preview signs it rather than the original', async () => {
    const file = await upload('smamynd');
    await expect(as(labak, () => registerAssetAction('labak', file.id, file.path, file.filename))).resolves.toEqual({ ok: true, assetId: file.id });

    expect(await storedThumb(file.id)).toBe(thumbPath(file.id));
    expect(await objectOf(thumbPath(file.id))).toEqual([{ mimetype: 'image/webp' }]);

    const preview = await as(labak, () => assetPreviewAction(file.id));
    expect(preview).toMatchObject({ ok: true, thumbnail: true });
    if (!preview.ok) throw new Error('no preview');
    expect(decodeURIComponent(new URL(preview.url).pathname)).toBe(`/storage/v1/object/sign/media-private/${thumbPath(file.id)}`);
    const meta = await fetchImage(preview.url);
    expect(meta).toMatchObject({ format: 'webp', width: 360, height: 480 });
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
  });

  it("another tenant's editor can neither sign, make nor read a file's thumbnail", async () => {
    const file = await upload('annars');
    await as(labak, () => registerAssetAction('labak', file.id, file.path, file.filename));
    expect(await storedThumb(file.id)).toBe(thumbPath(file.id));

    await expect(as(demo, () => assetPreviewAction(file.id))).resolves.toEqual({ ok: false, code: 'error' });
    await expect(as(demo, () => ensureThumbnailAction(file.id))).resolves.toEqual({ ok: false, code: 'error' });
    expect((await demo.client.storage.from('media-private').createSignedUrl(thumbPath(file.id), 600)).error).not.toBeNull();
    expect((await demo.client.storage.from('media-private').download(thumbPath(file.id))).error).not.toBeNull();
    // Nor can they register labak's upload, so nothing is made under labak's folder in their name.
    await expect(as(demo, () => registerAssetAction('labak', file.id, file.path, file.filename))).resolves.toEqual({ ok: false, code: 'invalid' });
  });

  it('a file registered without a thumbnail gets one on first view, once', async () => {
    // Registered as before L2: register_asset alone, with the metadata the server derives.
    const file = await upload('eldri');
    const image = await inspectImage(jpeg);
    if (!image.ok) throw new Error('inspectImage');
    const { error } = await labak.client.schema('api').rpc('register_asset', {
      p_asset_id: file.id,
      p_tenant_id: TENANT.labak,
      p_original_path: file.path,
      p_filename: file.filename,
      p_mime: image.mime,
      p_bytes: image.bytes,
      p_width: image.width,
      p_height: image.height,
      p_sha256: image.sha256,
    });
    expect(error).toBeNull();
    expect(await storedThumb(file.id)).toBeNull();

    const made = await as(labak, () => ensureThumbnailAction(file.id));
    expect(made).toMatchObject({ ok: true });
    if (!made.ok) throw new Error('no thumbnail');
    expect(await storedThumb(file.id)).toBe(thumbPath(file.id));
    expect(await fetchImage(made.url)).toMatchObject({ format: 'webp', width: 360, height: 480 });
    const [first] = await ownerQuery<{ id: string }>(`select id from storage.objects where bucket_id = 'media-private' and name = $1`, [thumbPath(file.id)]);

    // A second view signs the same object: nothing is made again.
    await expect(as(labak, () => assetPreviewAction(file.id))).resolves.toMatchObject({ ok: true, thumbnail: true });
    expect(await ownerQuery(`select id from storage.objects where bucket_id = 'media-private' and name = $1`, [thumbPath(file.id)])).toEqual([first]);
  });

  it("after a simulated day the sweep's orphan listing keeps the original and its thumbnail", async () => {
    const file = await upload('geymd');
    await as(labak, () => registerAssetAction('labak', file.id, file.path, file.filename));
    expect(await storedThumb(file.id)).toBe(thumbPath(file.id));
    // Long past any grace period, so both would be first in the oldest-first listing if they were orphans.
    await ownerQuery(`update storage.objects set created_at = now() - interval '400 days' where bucket_id = 'media-private' and name = any($1)`, [[file.path, thumbPath(file.id)]]);
    const orphans = await withTx('service', async (w) => (await w.query('select name from api.worker_private_orphans(86400, 1000)')).rows as { name: string }[]);
    const names = orphans.map((o) => o.name);
    expect(names).not.toContain(thumbPath(file.id));
    expect(names).not.toContain(file.path);
  });
});
