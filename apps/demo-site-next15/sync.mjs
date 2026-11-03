// The demo fixture site built a second time, on Next.js 15 (spec §7.3 and A12, plan M3-13). This
// app has no source of its own: `node sync.mjs` copies apps/demo-site's `src` (without its unit
// tests) and `next.config.ts` here, so both builds come from the same code and only the Next.js
// major differs. The copies are build output: git-ignored, and replaced on every sync.
import { cpSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, '..', 'demo-site');

/** Copies the demo site's source into this app; returns this app's directory. */
export function syncDemoSite() {
  rmSync(join(here, 'src'), { recursive: true, force: true });
  cpSync(join(source, 'src'), join(here, 'src'), { recursive: true, filter: (path) => basename(path) !== '__tests__' });
  cpSync(join(source, 'next.config.ts'), join(here, 'next.config.ts'));
  return here;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) syncDemoSite();
