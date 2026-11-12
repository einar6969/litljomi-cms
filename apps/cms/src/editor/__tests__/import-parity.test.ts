// The import command (tools/cli, docs/plans/import.md decision 2) carries copies of four of the
// editor's derivations until L2 moves them into one shared package. The worker re-checks every
// asset with the editor's inspectImage (`asset_mismatch`) and the editor re-derives slugs from
// titles, so the copies must give exactly the same answers; this runs both on the same input.
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { imageInspector, safeFilename as cliSafeFilename, slugBase as cliSlugBase, slugFits as cliSlugFits } from '../../../../../tools/cli/src/import/media.ts';
import { inspectImage } from '../server/image-metadata';
import { safeFilename } from '../upload';

vi.mock('server-only', () => ({}));
const { slugBase, slugFits } = await import('../server/auto-slug');

const cliInspect = imageInspector((bytes) => sharp(bytes).metadata());
const solid = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: { r: 10, g: 200, b: 90 } } });

describe('the import command\'s copies agree with the editor', () => {
  it('inspectImage', async () => {
    const samples = [
      new Uint8Array(await solid(40, 30).jpeg().toBuffer()),
      new Uint8Array(await solid(41, 29).png().toBuffer()),
      new Uint8Array(await solid(12, 7).webp().toBuffer()),
      new Uint8Array(await solid(40, 30).jpeg().withMetadata({ orientation: 6 }).toBuffer()),
      new Uint8Array(await solid(4, 4).gif().toBuffer()),
      new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>'),
      new TextEncoder().encode('not an image'),
      new Uint8Array(),
    ];
    for (const bytes of samples) expect(await cliInspect(bytes)).toEqual(await inspectImage(bytes));
  });

  it('safeFilename', () => {
    const names = ['Höfnin Þín.JPG', 'a/b/c.png', 'C:\\x\\Ýmislegt (2).webp', '...', '', `${'x'.repeat(120)}.jpg`, 'æ--ö.jpeg'];
    for (const name of names) for (const mime of ['image/jpeg', 'image/png', 'image/webp'] as const) expect(cliSafeFilename(name, mime)).toBe(safeFilename(name, mime));
  });

  it('slugBase and slugFits', () => {
    const titles = ['Göngustígur við höfnina', '  ', '', null, 'Ný útgáfa — 2019!', 'x'.repeat(250)];
    for (const title of titles) expect(cliSlugBase(title)).toBe(slugBase(title));
    const cases: [string | null, string][] = [['harbour-path', 'harbour-path'], ['harbour-path-12', 'harbour-path'], ['harbour-path-x', 'harbour-path'], [null, 'a'], ['a', '']];
    for (const [slug, base] of cases) expect(cliSlugFits(slug, base)).toBe(slugFits(slug, base));
  });
});
