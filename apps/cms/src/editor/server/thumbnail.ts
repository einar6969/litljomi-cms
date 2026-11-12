import 'server-only';
import sharp, { type Metadata } from 'sharp';
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
/**
 * The most memory, in bytes, a decoder that holds a whole image at once may need for it (320 MiB),
 * as `decodeFootprint` estimates it from the header. Measured with sharp 0.35.5 on macOS, one at a
 * time and with no libvips cache, no thumbnail took more than about 440 MB over the process's own
 * memory: an image at this limit about 1.3 times it, a streamed decode at the pixel limit (a 16-bit
 * RGBA PNG) about 270 MB, the header of a WebP at the pixel limit up to its 400 MB canvas.
 */
export const MAX_DECODE_BYTES = 320 * 1024 * 1024;
/** How long sharp may spend making one thumbnail. */
export const THUMBNAIL_TIMEOUT_SECONDS = 10;
/** How many thumbnails may wait for the decoder while one is made; one more is not made. */
export const MAX_WAITING_DECODES = 8;

// libvips caches the operations it has run, and a cached JPEG load keeps its decoder's memory: each
// progressive JPEG made stayed held (three 100 MP ones in turn peaked at 1.75 GB). The server never
// decodes the same image twice, so the cache is off for the whole process.
sharp.cache(false);

// The formats the server decodes: the three it accepts at registration (§5.6). Anything else sharp
// could read (GIF, SVG, HEIF, TIFF, ...) is never decoded here.
const DECODED_FORMATS = new Set(['jpeg', 'png', 'webp']);

// Bytes per sample of the pixel formats JPEG, PNG and WebP decode to. Anything else is not decoded.
const SAMPLE_BYTES: Record<string, number> = { uchar: 1, char: 1, ushort: 2, short: 2 };

type Header = Pick<Metadata, 'format' | 'width' | 'height' | 'channels' | 'depth' | 'isProgressive'>;

/**
 * What decoding the image holds in memory at once beyond a few rows, in bytes, from its header; null
 * for a pixel format the server does not decode. Three decoders hold the whole image whatever the
 * output size: libpng for an interlaced (Adam7) PNG, every sample at its own depth; libjpeg for a
 * progressive JPEG, every DCT coefficient of every component at 16 bits (subsampled chroma needs
 * less; this assumes none); and libwebp, every sample of the canvas. A baseline JPEG is shrunk while
 * it loads, and a non-interlaced PNG is read row by row: 0, bounded by the pixel limit alone.
 */
export function decodeFootprint(header: Header): number | null {
  const sample = SAMPLE_BYTES[header.depth];
  if (sample === undefined || !header.width || !header.height || !header.channels) return null;
  const samples = header.width * header.height * header.channels;
  if (header.format === 'png' && header.isProgressive) return samples * sample;
  if (header.format === 'jpeg' && header.isProgressive) return samples * 2;
  if (header.format === 'webp') return samples * sample;
  return 0;
}

// One decode at a time on this server instance, so concurrent requests (any tenant's, on a shared
// instance) never hold more than one image's decoding memory together. Those that would wait behind
// more than MAX_WAITING_DECODES others get no thumbnail now, and one on a later view.
let decoderFree: Promise<void> = Promise.resolve();
let waiting = 0;

/** Runs `decode` once no other decode on this instance is running; null when too many wait. */
export async function withDecoder<T>(decode: () => Promise<T>): Promise<T | null> {
  if (waiting >= MAX_WAITING_DECODES) return null;
  waiting += 1;
  const previous = decoderFree;
  let release!: () => void;
  decoderFree = new Promise((resolve) => (release = resolve));
  try {
    await previous;
  } finally {
    waiting -= 1;
  }
  try {
    return await decode();
  } finally {
    release();
  }
}

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
 * or whose decoding would hold more than MAX_DECODE_BYTES (both checked from the header, before any
 * pixel is decoded), for one that fails to decode or takes longer than the time limit, and when too
 * many others wait for the decoder (`withDecoder`). The header is read in the decoder's turn too: a
 * WebP's alone can briefly take its canvas's memory. Only the first frame of an animated image is
 * read.
 */
export async function makeThumbnail(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (bytes.byteLength === 0) return null;
  try {
    return await withDecoder(async () => {
      const meta = await sharp(bytes).metadata();
      if (!meta.format || !DECODED_FORMATS.has(meta.format)) return null;
      if (!meta.width || !meta.height || meta.width * meta.height > MAX_THUMBNAIL_PIXELS) return null;
      const footprint = decodeFootprint(meta);
      if (footprint === null || footprint > MAX_DECODE_BYTES) return null;
      const thumbnail = await sharp(bytes, { limitInputPixels: MAX_THUMBNAIL_PIXELS })
        .rotate()
        .resize({ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .timeout({ seconds: THUMBNAIL_TIMEOUT_SECONDS })
        .toBuffer();
      return new Uint8Array(thumbnail);
    });
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
