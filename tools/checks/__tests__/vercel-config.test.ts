import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The demo site's Vercel configuration (decision 43.7): functions in Frankfurt and noindex on every
// path, no cron. The CMS's vercel.json is pinned next to its cron route (apps/cms routes.test.ts).
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('apps/demo-site/vercel.json', () => {
  it('runs functions in fra1 and sends X-Robots-Tag: noindex on every path', () => {
    const config = JSON.parse(readFileSync(join(root, 'apps', 'demo-site', 'vercel.json'), 'utf8'));
    expect(config).toEqual({
      regions: ['fra1'],
      headers: [{ source: '/(.*)', headers: [{ key: 'X-Robots-Tag', value: 'noindex' }] }],
    });
  });
});
