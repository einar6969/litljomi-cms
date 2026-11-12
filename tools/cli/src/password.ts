// The import's password (docs/plans/import.md section 2): from standard input only, as provision
// reads secrets: piped, or typed at a prompt on the terminal with echo turned off. Never from an
// environment variable or an argument, which would put it in the shell history and in the
// environment of every parent process. It is returned to the caller only: never written to a file,
// logged or echoed. Synchronous reads, as ./stdin.ts explains (vite-node and async stdin).

export interface PasswordSources {
  /** True when standard input is a terminal (fd 0, without creating process.stdin). */
  stdinIsTerminal(): boolean;
  /** All of piped standard input. */
  readPiped(): string;
  /** Writes the prompt (to standard error, so standard output stays clean). */
  prompt(text: string): void;
  /** Turns the terminal's echo off (false) or on (true); false when that failed. */
  setEcho(on: boolean): boolean;
  /** One byte from the terminal, or null at end of input. */
  readByte(): number | null;
}

const MAX_PASSWORD_BYTES = 1024;

/** A password, or null when there is none to read. */
export function readPassword(src: PasswordSources): string | null {
  if (!src.stdinIsTerminal()) {
    const piped = src.readPiped();
    const line = piped.endsWith('\r\n') ? piped.slice(0, -2) : piped.endsWith('\n') ? piped.slice(0, -1) : piped;
    return line === '' ? null : line;
  }
  src.prompt('password (not shown): ');
  if (!src.setEcho(false)) throw new Error('the terminal echo could not be turned off; pipe the password on standard input instead');
  const bytes: number[] = [];
  try {
    for (;;) {
      const b = src.readByte();
      if (b === null || b === 0x0a || b === 0x0d) break;
      // Ctrl-C and Ctrl-D in a terminal without line editing: give up rather than guess.
      if (b === 0x03 || b === 0x04) return null;
      if (bytes.length >= MAX_PASSWORD_BYTES) throw new Error('the password is too long');
      bytes.push(b);
    }
  } finally {
    src.setEcho(true);
    src.prompt('\n');
  }
  const text = new TextDecoder().decode(new Uint8Array(bytes));
  return text === '' ? null : text;
}
