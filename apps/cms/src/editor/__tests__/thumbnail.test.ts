import sharp, { type Sharp } from 'sharp';
import { describe, expect, it } from 'vitest';
import { makeThumbnail, MAX_THUMBNAIL_PIXELS, THUMBNAIL_SIZE, thumbnailPath } from '../server/thumbnail';

// The editor's thumbnail of a file (docs/plans/media-library.md section 5, design A): longest side
// 480 px, WebP, never enlarged, rotated as EXIF says, no metadata. Only JPEG, PNG and WebP are
// decoded, and only up to the pixel cap.

const solid = (width: number, height: number, channels: 3 | 4 = 3, alpha = 1) =>
  sharp({ create: { width, height, channels, background: { r: 200, g: 120, b: 40, alpha } } });

const bytesOf = async (image: Sharp) => new Uint8Array(await image.toBuffer());
const metaOf = (bytes: Uint8Array) => sharp(bytes).metadata();

describe('makeThumbnail', () => {
  it('turns a JPEG with an EXIF rotation into an upright 480 px WebP without its metadata', async () => {
    // Stored 1200 × 800 and turned a quarter by EXIF: shown 800 × 1200.
    const jpeg = await bytesOf(solid(1200, 800).jpeg().withMetadata({ orientation: 6, exif: { IFD0: { Copyright: 'x' } } }));
    expect((await metaOf(jpeg)).orientation).toBe(6);
    const thumb = await makeThumbnail(jpeg);
    expect(thumb).not.toBeNull();
    const meta = await metaOf(thumb!);
    expect(meta).toMatchObject({ format: 'webp', width: 320, height: 480 });
    expect(meta.orientation).toBeUndefined();
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
  });

  it('keeps the transparency of a PNG', async () => {
    const png = await bytesOf(solid(1000, 500, 4, 0.5).png());
    const meta = await metaOf((await makeThumbnail(png))!);
    expect(meta).toMatchObject({ format: 'webp', width: 480, height: 240, hasAlpha: true });
  });

  it('makes one of a WebP', async () => {
    const webp = await bytesOf(solid(600, 900).webp());
    expect(await metaOf((await makeThumbnail(webp))!)).toMatchObject({ format: 'webp', width: 320, height: 480 });
  });

  it('never enlarges a small image', async () => {
    const jpeg = await bytesOf(solid(40, 30).jpeg());
    expect(await metaOf((await makeThumbnail(jpeg))!)).toMatchObject({ format: 'webp', width: 40, height: 30 });
  });

  it('makes none of an image over the pixel cap, without decoding it', async () => {
    // One row more than 10,000 × 10,000: a few kilobytes of PNG, but past the cap.
    const png = await bytesOf(solid(10_000, 10_001).png({ compressionLevel: 9 }));
    expect(10_000 * 10_001).toBeGreaterThan(MAX_THUMBNAIL_PIXELS);
    await expect(makeThumbnail(png)).resolves.toBeNull();
  });

  it('makes none of a corrupt file, nor of anything but JPEG, PNG and WebP', async () => {
    const jpeg = await bytesOf(solid(800, 600).jpeg());
    // The header survives (inspectImage would accept it), the pixels do not.
    const truncated = jpeg.slice(0, Math.floor(jpeg.byteLength / 3));
    expect((await metaOf(truncated)).format).toBe('jpeg');
    const gif = await bytesOf(solid(8, 8).gif());
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>');
    for (const bytes of [truncated, gif, svg, new TextEncoder().encode('not an image'), new Uint8Array(0)]) {
      await expect(makeThumbnail(bytes)).resolves.toBeNull();
    }
  });
});

describe('thumbnailPath', () => {
  it("is the file's own folder, thumb/480.webp: the one form set_asset_thumbnail accepts", () => {
    expect(THUMBNAIL_SIZE).toBe(480);
    expect(thumbnailPath('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000a1')).toBe(
      '00000000-0000-4000-8000-0000000000f1/00000000-0000-4000-8000-0000000000a1/thumb/480.webp',
    );
  });
});
