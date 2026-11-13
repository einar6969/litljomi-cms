// The thumbnail maker of L2 (docs/plans/media-library.md section 5, design A; spec §5.6): the
// bytes of a file's thumbnail, and the one path it may have. It imports nothing from the app and is
// not marked server-only, so the import command (tools/cli, docs/plans/import.md step 1) makes a
// file's thumbnail with the same code an editor's upload runs (./thumbnail.ts `ensureThumbnail`),
// rather than a copy that could drift. It loads sharp, a native library: import it from server code
// (./thumbnail.ts, which is server-only) or from Node, never from a client component.
import sharp, { type Metadata } from 'sharp';

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
