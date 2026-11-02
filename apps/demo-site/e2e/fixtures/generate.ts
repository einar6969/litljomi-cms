import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entryContentHash } from '@litljomi/cms-schema';
import type { Bundle, BundleEntry, Pointer } from '@litljomi/cms-sdk';

// Writes the fixture bundle. Each contentHash is the §7.2 hash (the complete entry record minus
// contentHash), computed by entryContentHash, the helper the worker's release build uses.
// Run: pnpm --filter demo-site fixtures:gen
const dir = join(dirname(fileURLToPath(import.meta.url)), 'delivery', 'demo');
const stamp = '2026-11-02T09:00:00.000Z';
const paragraph = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

const records: Array<{ id: string; slug: string; sortAt: string; data: Record<string, unknown> }> = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'x',
    sortAt: '2026-12-01',
    data: {
      title: 'Opið hús',
      startDate: '2026-12-01',
      endDate: '2026-12-02',
      location: 'Reykjavík',
      description: paragraph('Allir velkomnir.'),
      registration: { href: 'https://example.is/skraning' },
    },
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    slug: 'jolamarkadur',
    sortAt: '2026-12-15',
    data: {
      title: 'Jólamarkaður',
      startDate: '2026-12-15',
      endDate: null,
      location: 'Hafnarfjörður',
      description: paragraph('Handverk og heitt súkkulaði.'),
      registration: null,
    },
  },
];

const entries: BundleEntry[] = records.map((r, i) => {
  const record = {
    id: r.id,
    revisionId: `00000000-0000-4000-8000-00000000000${i + 1}`,
    slug: r.slug,
    title: String(r.data['title']),
    sortAt: r.sortAt,
    firstPublishedAt: stamp,
    lastPublishedAt: stamp,
    schemaVersion: 1,
    data: r.data,
  };
  const { id, revisionId, ...rest } = record;
  return { id, revisionId, contentHash: entryContentHash(record), ...rest };
});
const bundle: Bundle = { format: 1, tenant: 'demo', release: 1, generatedAt: stamp, entries: { event: entries } };
const pointer: Pointer = { format: 1, tenant: 'demo', release: 1, bundle: 'releases/1.json', generatedAt: stamp };

mkdirSync(join(dir, 'releases'), { recursive: true });
writeFileSync(join(dir, 'releases', '1.json'), JSON.stringify(bundle, null, 2) + '\n');
writeFileSync(join(dir, 'current.json'), JSON.stringify(pointer, null, 2) + '\n');
console.log(`wrote ${dir}`);
