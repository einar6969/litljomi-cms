import sharp, { type Sharp } from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  decodeFootprint,
  makeThumbnail,
  MAX_DECODE_BYTES,
  MAX_THUMBNAIL_PIXELS,
  MAX_WAITING_DECODES,
  THUMBNAIL_SIZE,
  thumbnailPath,
  withDecoder,
} from '../server/thumbnail';

// The editor's thumbnail of a file (docs/plans/media-library.md section 5, design A): longest side
// 480 px, WebP, never enlarged, rotated as EXIF says, no metadata. Only JPEG, PNG and WebP are
// decoded, only up to the pixel cap and the decoding memory limit, and one at a time.

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

  // Each decoder that holds a whole image is judged from the header against MAX_DECODE_BYTES.
  const LARGE = { timeout: 30_000 };

  it('makes none of an interlaced PNG whose decoder would hold too much memory', LARGE, async () => {
    // The review's case: 10,000 × 10,000, 16-bit RGBA, interlaced. About a megabyte of PNG under the
    // pixel cap, but libpng holds all 800 MB of it (sharp peaked at over 1 GB).
    const reviewed = await bytesOf(solid(10_000, 10_000, 4).toColourspace('rgb16').png({ progressive: true, compressionLevel: 9 }));
    expect(await metaOf(reviewed)).toMatchObject({ width: 10_000, height: 10_000, channels: 4, depth: 'ushort', isProgressive: true });
    await expect(makeThumbnail(reviewed)).resolves.toBeNull();

    // Just over the memory limit, interlaced: none. The same pixels read row by row: one.
    const side = 6_500; // 6,500² × 4 channels × 2 bytes = 338 MB
    expect(side * side * 4 * 2).toBeGreaterThan(MAX_DECODE_BYTES);
    const deep = solid(side, side, 4).toColourspace('rgb16');
    await expect(makeThumbnail(await bytesOf(deep.clone().png({ progressive: true, compressionLevel: 9 })))).resolves.toBeNull();
    const plain = await makeThumbnail(await bytesOf(deep.clone().png({ compressionLevel: 9 })));
    expect(await metaOf(plain!)).toMatchObject({ format: 'webp', width: 480, height: 480 });
  });

  it('makes none of a progressive JPEG whose decoder would hold too much memory', LARGE, async () => {
    // A progressive JPEG keeps every coefficient: 7,500² × 3 × 2 bytes = 337.5 MB is too much. The
    // baseline JPEG of the same size is shrunk as it loads.
    expect(7_500 * 7_500 * 3 * 2).toBeGreaterThan(MAX_DECODE_BYTES);
    const large = solid(7_500, 7_500);
    await expect(makeThumbnail(await bytesOf(large.clone().jpeg({ progressive: true })))).resolves.toBeNull();
    expect(await metaOf((await makeThumbnail(await bytesOf(large.clone().jpeg())))!)).toMatchObject({ format: 'webp', width: 480 });
  });

  it('makes none of a WebP whose decoder would hold too much memory', LARGE, async () => {
    // libwebp decodes the whole canvas: 9,200² × 4 channels = 338.6 MB is too much, × 3 is not.
    expect(9_200 * 9_200 * 4).toBeGreaterThan(MAX_DECODE_BYTES);
    expect(9_200 * 9_200 * 3).toBeLessThan(MAX_DECODE_BYTES);
    const rgba = await bytesOf(solid(9_200, 9_200, 4, 0.5).webp({ effort: 0 }));
    expect(await metaOf(rgba)).toMatchObject({ format: 'webp', channels: 4 });
    await expect(makeThumbnail(rgba)).resolves.toBeNull();
    expect(await metaOf((await makeThumbnail(await bytesOf(solid(9_200, 9_200).webp({ effort: 0 }))))!)).toMatchObject({ format: 'webp', width: 480 });
  });

  it('makes one of an interlaced PNG and a progressive JPEG under the memory limit', async () => {
    expect(await metaOf((await makeThumbnail(await bytesOf(solid(2_000, 1_000, 4).png({ progressive: true }))))!)).toMatchObject({ width: 480, height: 240 });
    expect(await metaOf((await makeThumbnail(await bytesOf(solid(2_000, 1_000).jpeg({ progressive: true }))))!)).toMatchObject({ width: 480, height: 240 });
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

describe('decodeFootprint', () => {
  const header = { width: 10_000, height: 5_000, channels: 4 as const, depth: 'uchar' as const, isProgressive: false };

  it('is every sample of an interlaced PNG at its depth, every coefficient of a progressive JPEG at 16 bits, and every sample of a WebP', () => {
    expect(decodeFootprint({ ...header, format: 'png', isProgressive: true })).toBe(200_000_000);
    expect(decodeFootprint({ ...header, format: 'png', isProgressive: true, depth: 'ushort' })).toBe(400_000_000);
    expect(decodeFootprint({ ...header, format: 'png', isProgressive: true, channels: 1 })).toBe(50_000_000);
    expect(decodeFootprint({ ...header, format: 'jpeg', isProgressive: true, channels: 3 })).toBe(300_000_000);
    expect(decodeFootprint({ ...header, format: 'webp' })).toBe(200_000_000);
    expect(decodeFootprint({ ...header, format: 'webp', channels: 3 })).toBe(150_000_000);
  });

  it('is 0 for a decode that streams or shrinks as it loads, and null for a pixel format never decoded', () => {
    expect(decodeFootprint({ ...header, format: 'png', depth: 'ushort' })).toBe(0);
    expect(decodeFootprint({ ...header, format: 'jpeg', channels: 3 })).toBe(0);
    expect(decodeFootprint({ ...header, format: 'png', isProgressive: true, depth: 'float' })).toBeNull();
    expect(decodeFootprint({ ...header, format: 'png', isProgressive: true, width: 0 })).toBeNull();
  });
});

describe('the libvips cache', () => {
  it('is off, so no finished decode keeps its memory', () => {
    expect(sharp.cache()).toMatchObject({ memory: { max: 0 }, files: { max: 0 }, items: { max: 0 } });
  });
});

describe('withDecoder', () => {
  const deferred = () => {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((res, rej) => ((resolve = res), (reject = rej)));
    return { promise, resolve, reject };
  };
  const settled = () => new Promise((resolve) => setTimeout(resolve, 20));

  it('runs one decode at a time, and a failed one frees the decoder', async () => {
    const order: string[] = [];
    const first = deferred();
    const second = deferred();
    const a = withDecoder(async () => (order.push('a'), await first.promise, 'a'));
    const b = withDecoder(async () => (order.push('b'), await second.promise, 'b'));
    const c = withDecoder(async () => (order.push('c'), 'c'));
    await settled();
    expect(order).toEqual(['a']);
    first.resolve();
    await expect(a).resolves.toBe('a');
    await settled();
    expect(order).toEqual(['a', 'b']);
    second.reject(new Error('decode failed'));
    await expect(b).rejects.toThrow('decode failed');
    await expect(c).resolves.toBe('c');
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('reads no header and makes no thumbnail while the decoder is busy, and none when too many already wait', async () => {
    const busy = deferred();
    const running = withDecoder(() => busy.promise);
    const jpeg = await bytesOf(solid(40, 30).jpeg());
    let made = false;
    const thumb = makeThumbnail(jpeg).then((t) => ((made = true), t));
    await settled();
    await settled();
    expect(made).toBe(false);

    // One waits already; with MAX_WAITING_DECODES waiting, the next is turned away at once.
    const queued = Array.from({ length: MAX_WAITING_DECODES - 1 }, () => withDecoder(async () => 'queued'));
    await expect(withDecoder(async () => 'too many')).resolves.toBeNull();
    await expect(makeThumbnail(jpeg)).resolves.toBeNull();

    busy.resolve();
    await running;
    expect(await metaOf((await thumb)!)).toMatchObject({ format: 'webp', width: 40, height: 30 });
    await expect(Promise.all(queued)).resolves.toEqual(Array(MAX_WAITING_DECODES - 1).fill('queued'));
    // Free again.
    await expect(withDecoder(async () => 'free')).resolves.toBe('free');
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
