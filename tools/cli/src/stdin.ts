import { readFileSync } from 'node:fs';

export interface StdinSource {
  isTTY: boolean | undefined;
  read: () => string;
}

const processStdin: StdinSource = {
  get isTTY() {
    return process.stdin.isTTY;
  },
  read: () => readFileSync(0, 'utf8'),
};

/**
 * Reads all of standard input synchronously; null for a terminal (nothing is read).
 *
 * Synchronous on purpose: under vite-node (the `cli` script), a fetch made after
 * `for await` over process.stdin ended the process silently with exit code 0.
 * A read error (EAGAIN on a non-blocking stdin, EOF, ...) becomes a StdinUnreadable
 * error naming only its code; the original message is dropped.
 */
export function readStdinSync(source: StdinSource = processStdin): string | null {
  if (source.isTTY) return null;
  try {
    return source.read();
  } catch (e) {
    const code = typeof (e as { code?: unknown })?.code === 'string' ? (e as { code: string }).code : 'unknown';
    const err = new Error(`standard input could not be read (${code})`);
    err.name = 'StdinUnreadable';
    throw err;
  }
}
