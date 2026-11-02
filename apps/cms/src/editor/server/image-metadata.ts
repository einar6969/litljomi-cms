import 'server-only';
import { createHash } from 'node:crypto';
import sharp, { type Metadata } from 'sharp';
import { MAX_UPLOAD_BYTES, type AcceptedMime } from '../upload';

export type ImageMetadata = { ok: true; mime: AcceptedMime; bytes: number; width: number; height: number; sha256: string };
export type ImageRejection = { ok: false; reason: 'type' | 'size' };

// sharp's names for the accepted formats (§5.6). Anything else sharp can read (GIF, SVG, HEIF,
// AVIF, TIFF, ...) or cannot read at all is refused.
const MIME_BY_FORMAT: Record<string, AcceptedMime> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

const isPositiveInt = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;

/**
 * The metadata of an uploaded original, derived on the server from the object's own bytes (spec
 * §5.6): the type sharp detects from the content (never the name or the client's content type),
 * the byte size, the displayed width and height (after any EXIF rotation) and the SHA-256. Only
 * the header is read: sharp's `metadata()` decodes no pixels. The size is checked first.
 */
export async function inspectImage(bytes: Uint8Array): Promise<ImageMetadata | ImageRejection> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) return { ok: false, reason: 'size' };
  let meta: Metadata;
  try {
    meta = await sharp(bytes).metadata();
  } catch {
    return { ok: false, reason: 'type' };
  }
  const mime = meta.format ? MIME_BY_FORMAT[meta.format] : undefined;
  const width = meta.autoOrient?.width ?? meta.width;
  const height = meta.autoOrient?.height ?? meta.height;
  if (!mime || !isPositiveInt(width) || !isPositiveInt(height)) return { ok: false, reason: 'type' };
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return { ok: true, mime, bytes: bytes.byteLength, width, height, sha256 };
}
