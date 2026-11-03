import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readStdinSync } from '../stdin.ts';

const here = dirname(fileURLToPath(import.meta.url));

describe('readStdinSync', () => {
  it('returns null for a terminal without reading', () => {
    let reads = 0;
    const out = readStdinSync({ isTTY: true, read: () => (reads += 1, 'x') });
    expect(out).toBeNull();
    expect(reads).toBe(0);
  });

  it('returns what was piped in, including an empty pipe', () => {
    expect(readStdinSync({ isTTY: false, read: () => 'secret\n' })).toBe('secret\n');
    expect(readStdinSync({ isTTY: undefined, read: () => '' })).toBe('');
  });

  it.each([['EAGAIN'], ['EOF'], ['EISDIR']])('turns a %s read error into a StdinUnreadable error without its text', (code) => {
    const cause = Object.assign(new Error(`${code}: boom piped-data`), { code });
    let thrown: unknown;
    try {
      readStdinSync({ isTTY: false, read: () => { throw cause; } });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).name).toBe('StdinUnreadable');
    expect((thrown as Error).message).not.toContain('boom');
    expect((thrown as Error).message).not.toContain('piped-data');
  });

  // vite-node (the `cli` script) exits 0 silently at a fetch made after `for await` over
  // process.stdin (decision 44 incident), so main.ts must read stdin synchronously and must
  // not report success before runCli returns.
  it('is what main.ts uses, and main.ts never iterates process.stdin asynchronously', () => {
    const main = readFileSync(join(here, '..', 'main.ts'), 'utf8');
    expect(main).toContain('readStdinSync(');
    expect(main).not.toMatch(/for\s+await/);
    expect(main).not.toMatch(/process\.stdin\.(on|once|read|pipe)\b/);
  });

  it('main.ts sets a failing exit code before awaiting runCli', () => {
    const main = readFileSync(join(here, '..', 'main.ts'), 'utf8');
    const early = main.indexOf('process.exitCode = 1');
    const run = main.indexOf('await runCli(');
    expect(early).toBeGreaterThan(-1);
    expect(run).toBeGreaterThan(early);
  });
});
