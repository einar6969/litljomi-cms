import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentHash } from '@litljomi/cms-schema';
import type { Bundle, Pointer } from '@litljomi/cms-sdk';
import { FIXTURES_ROOT } from './fixture-server.ts';

const read = <T>(...parts: string[]) => JSON.parse(readFileSync(join(FIXTURES_ROOT, 'delivery', 'demo', ...parts), 'utf8')) as T;

describe('the fixture bundle', () => {
  const pointer = read<Pointer>('current.json');
  const bundle = read<Bundle>(pointer.bundle);

  it('has a pointer that names a bundle of the same tenant and release (format v1)', () => {
    expect(pointer.format).toBe(1);
    expect(bundle.format).toBe(1);
    expect(bundle.tenant).toBe(pointer.tenant);
    expect(bundle.release).toBe(pointer.release);
  });
  it('carries the real content hash of each entry record (regenerate with `pnpm --filter demo-site fixtures:gen`)', () => {
    const entries = Object.values(bundle.entries).flat();
    expect(entries.length).toBeGreaterThan(1);
    for (const e of entries) expect(e.contentHash).toBe(contentHash(e.data));
  });
  it('includes an event with slug x and distinct ids and slugs', () => {
    const events = bundle.entries['event'] ?? [];
    expect(events.some((e) => e.slug === 'x')).toBe(true);
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
    expect(new Set(events.map((e) => e.slug)).size).toBe(events.length);
  });
});
