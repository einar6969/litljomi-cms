// A real JPEG and the metadata the server derives from it (M3-07): the worker re-derives an
// asset's metadata from its original at publish, so the integration tests register assets with
// the metadata of the bytes they upload.
import { createHash } from 'node:crypto';
import sharp from 'sharp';

export const TEST_JPEG_WIDTH = 8;
export const TEST_JPEG_HEIGHT = 6;

/** An 8×6 JPEG. */
export const TEST_JPEG = new Uint8Array(
  await sharp({ create: { width: TEST_JPEG_WIDTH, height: TEST_JPEG_HEIGHT, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .jpeg()
    .toBuffer(),
);

/** register_asset's metadata arguments for TEST_JPEG. */
export const TEST_JPEG_METADATA = {
  p_mime: 'image/jpeg',
  p_bytes: TEST_JPEG.byteLength,
  p_width: TEST_JPEG_WIDTH,
  p_height: TEST_JPEG_HEIGHT,
  p_sha256: createHash('sha256').update(TEST_JPEG).digest('hex'),
};
