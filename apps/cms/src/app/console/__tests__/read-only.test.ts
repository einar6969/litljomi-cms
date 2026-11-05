import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CONSOLE = join(import.meta.dirname, '..');
const DATA = join(import.meta.dirname, '..', '..', '..', 'console');

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });

// mfa is the one place the console writes: it enrols and verifies a TOTP factor (M4-04).
const pages = sources(CONSOLE).filter((path) => !path.startsWith(join(CONSOLE, 'mfa')));
const reads = [...pages, ...sources(DATA)];

describe('the console pages', () => {
  it('have files to check', () => {
    expect(pages.length).toBeGreaterThanOrEqual(6);
  });

  it.each([
    ['a server action', /['"]use server['"]/],
    ['a form', /<form\b/],
    ['a POST or other write handler', /export\s+(async\s+)?(function|const)\s+(POST|PUT|PATCH|DELETE)\b/],
    ['a mutation', /\.(insert|update|upsert|delete|rpc)\(/],
    ['the secret key', /service_role|createServiceClient|secretClient|SECRET_KEY|privileged\//],
    ['a client component', /['"]use client['"]/],
  ])('contain no %s', (_label, pattern) => {
    for (const path of reads) expect(readFileSync(path, 'utf8'), path).not.toMatch(pattern);
  });

  it('give every console link prefetch={false}', () => {
    for (const path of pages) {
      const source = readFileSync(path, 'utf8');
      for (const link of source.match(/<Link\b[^>]*>/g) ?? []) expect(link, path).toContain('prefetch={false}');
    }
  });
});
