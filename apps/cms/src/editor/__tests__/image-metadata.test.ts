import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { inspectImage } from '../server/image-metadata';

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } });

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe('inspectImage (the server reads the real object, never the client metadata)', () => {
  it.each([
    ['jpeg', 'image/jpeg'],
    ['png', 'image/png'],
    ['webp', 'image/webp'],
  ] as const)('derives mime, size, dimensions and sha256 of a %s from its bytes', async (format, mime) => {
    const bytes = new Uint8Array(await solid(40, 30).toFormat(format).toBuffer());
    await expect(inspectImage(bytes)).resolves.toEqual({
      ok: true,
      mime,
      bytes: bytes.byteLength,
      width: 40,
      height: 30,
      sha256: sha256(bytes),
    });
  });

  it('reports the displayed dimensions of a JPEG with an EXIF rotation', async () => {
    const bytes = new Uint8Array(await solid(40, 30).jpeg().withMetadata({ orientation: 6 }).toBuffer());
    await expect(inspectImage(bytes)).resolves.toMatchObject({ ok: true, width: 30, height: 40 });
  });

  it('rejects a GIF, an SVG, a PDF, a HEIC header and bytes that are no image', async () => {
    const gif = new Uint8Array(await solid(4, 4).gif().toBuffer());
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>');
    const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
    const heic = new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode('ftypheic'), 0, 0, 0, 0, ...new TextEncoder().encode('mif1heic')]);
    const junk = new TextEncoder().encode('not an image at all');
    for (const bytes of [gif, svg, pdf, heic, junk]) {
      await expect(inspectImage(bytes)).resolves.toEqual({ ok: false, reason: 'type' });
    }
  });

  it('rejects an object over 20 MB, and an empty one, without decoding it', async () => {
    await expect(inspectImage(new Uint8Array(20971521))).resolves.toEqual({ ok: false, reason: 'size' });
    await expect(inspectImage(new Uint8Array(0))).resolves.toEqual({ ok: false, reason: 'size' });
  });
});
