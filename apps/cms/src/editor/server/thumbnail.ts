import 'server-only';
import sharp from 'sharp';
import type { SupabaseClient } from '@/lib/supabase/types';
import { authOrError } from './entry-context';
import { MEDIA_PRIVATE_BUCKET } from '../upload';

// The editor's thumbnail of a file (docs/plans/media-library.md section 5, design A; spec §5.6):
// made on the CMS server from the original's bytes, stored beside it in `media-private` with the
// editor's own session, and recorded by `api.set_asset_thumbnail`. Never published; shown to the
// tenant's editors through short-lived signed URLs, so the editor never loads an original to show
// a preview. A file is always registered whether or not its thumbnail can be made: a failure here
// leaves the file without one, never unregistered.

/** The longest side of a thumbnail, in pixels. */
export const THUMBNAIL_SIZE = 480;
/** The most pixels an original may have for the server to decode it (100 megapixels). */
export const MAX_THUMBNAIL_PIXELS = 100_000_000;
/** How long sharp may spend making one thumbnail. */
export const THUMBNAIL_TIMEOUT_SECONDS = 10;

// The formats the server decodes: the three it accepts at registration (§5.6). Anything else sharp
// could read (GIF, SVG, HEIF, TIFF, ...) is never decoded here.
const DECODED_FORMATS = new Set(['jpeg', 'png', 'webp']);

/**
 * The one place a file's thumbnail may be: `{tenant_id}/{asset_id}/thumb/480.webp`, four path
 * segments where an original has three, so it can never be another file's original. The form
 * `cms.assets.thumb_path`'s check and `set_asset_thumbnail` accept.
 */
export const thumbnailPath = (tenantId: string, assetId: string): string => `${tenantId}/${assetId}/thumb/${THUMBNAIL_SIZE}.webp`;

/**
 * A thumbnail of an original: its longest side at most 480 px (never enlarged), WebP, turned
 * upright as its EXIF orientation says, with no metadata (no EXIF, GPS, ICC or XMP: sharp copies
 * none unless asked). Null for anything but a JPEG, PNG or WebP, for an image over 100 megapixels
 * (checked from the header, before any pixel is decoded), and for one that fails to decode or takes
 * longer than the time limit. Only the first frame of an animated image is read.
 */
export async function makeThumbnail(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (bytes.byteLength === 0) return null;
  try {
    const meta = await sharp(bytes).metadata();
    if (!meta.format || !DECODED_FORMATS.has(meta.format)) return null;
    if (!meta.width || !meta.height || meta.width * meta.height > MAX_THUMBNAIL_PIXELS) return null;
    const thumbnail = await sharp(bytes, { limitInputPixels: MAX_THUMBNAIL_PIXELS })
      .rotate()
      .resize({ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .timeout({ seconds: THUMBNAIL_TIMEOUT_SECONDS })
      .toBuffer();
    return new Uint8Array(thumbnail);
  } catch {
    return null;
  }
}

/** The asset columns the thumbnail needs, as `api.asset_list` returns them. */
export type ThumbnailAsset = { id: string; tenant_id: string; original_path: string; thumb_path: string | null };

export type EnsuredThumbnail = { ok: true; path: string } | { ok: false; code: 'auth' | 'error' };

/**
 * The file's thumbnail path, made and recorded first if it has none. The original is read back with
 * the editor's session, unless the caller already holds its bytes (`original`, as registration
 * does). The thumbnail is uploaded with the editor's session (Storage RLS: a folder of a tenant they
 * belong to; never an overwrite), then recorded through `set_asset_thumbnail`, which finds the row
 * under RLS, takes only this file's own path and only once the object exists. A failed upload is
 * still followed by the recording: an earlier attempt may have left the object in place, and the
 * database refuses the path if there is none. An object never recorded is an orphan the sweep
 * deletes a day later. The tenant is the row's; the path is derived from it, never passed in.
 */
export async function ensureThumbnail(client: SupabaseClient, asset: ThumbnailAsset, original?: Uint8Array): Promise<EnsuredThumbnail> {
  if (asset.thumb_path !== null) return { ok: true, path: asset.thumb_path };
  let bytes = original;
  if (bytes === undefined) {
    const object = await client.storage.from(MEDIA_PRIVATE_BUCKET).download(asset.original_path);
    if (object.error || !object.data) return { ok: false, code: 'error' };
    bytes = new Uint8Array(await object.data.arrayBuffer());
  }
  const thumbnail = await makeThumbnail(bytes);
  if (thumbnail === null) return { ok: false, code: 'error' };
  const path = thumbnailPath(asset.tenant_id, asset.id);
  await client.storage.from(MEDIA_PRIVATE_BUCKET).upload(path, thumbnail, { contentType: 'image/webp', upsert: false });
  const recorded = await client.rpc('set_asset_thumbnail', { p_asset_id: asset.id, p_thumb_path: path });
  if (recorded.error) return { ok: false, code: authOrError(recorded) };
  return { ok: true, path };
}
