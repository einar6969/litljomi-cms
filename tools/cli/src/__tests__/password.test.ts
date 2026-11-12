import { describe, expect, it } from 'vitest';
import { readPassword, type PasswordSources } from '../password.ts';

function sources(o: { env?: string; terminal?: boolean; piped?: string; typed?: string; echoFails?: boolean }) {
  const calls: string[] = [];
  const typed = [...new TextEncoder().encode(o.typed ?? '')];
  const src: PasswordSources = {
    takeEnv: () => {
      calls.push('env');
      return o.env;
    },
    stdinIsTerminal: () => o.terminal ?? false,
    readPiped: () => {
      calls.push('piped');
      return o.piped ?? '';
    },
    prompt: (text) => calls.push(`prompt:${text}`),
    setEcho: (on) => {
      calls.push(on ? 'echo on' : 'echo off');
      return !(o.echoFails ?? false);
    },
    readByte: () => typed.shift() ?? null,
  };
  return { src, calls };
}

describe('readPassword', () => {
  it('takes the environment variable first, and reads nothing else', () => {
    const { src, calls } = sources({ env: 'from-env', piped: 'from-stdin' });
    expect(readPassword(src)).toBe('from-env');
    expect(calls).toEqual(['env']);
  });

  it('reads piped standard input, without its final newline', () => {
    expect(readPassword(sources({ piped: 'pässword\n' }).src)).toBe('pässword');
    expect(readPassword(sources({ piped: 'p w\r\n' }).src)).toBe('p w');
    expect(readPassword(sources({ piped: '' }).src)).toBeNull();
  });

  it('prompts on a terminal with echo off, and turns it back on', () => {
    const { src, calls } = sources({ terminal: true, typed: 'þögn-123\nrest' });
    expect(readPassword(src)).toBe('þögn-123');
    expect(calls).toEqual(['env', 'prompt:password (not shown): ', 'echo off', 'echo on', 'prompt:\n']);
  });

  it('turns echo back on when reading fails', () => {
    const { src, calls } = sources({ terminal: true });
    src.readByte = () => {
      throw new Error('EIO');
    };
    expect(() => readPassword(src)).toThrow('EIO');
    expect(calls).toContain('echo on');
  });

  it('refuses to prompt when echo cannot be turned off', () => {
    expect(() => readPassword(sources({ terminal: true, typed: 'x\n', echoFails: true }).src)).toThrow('echo could not be turned off');
  });

  it('gives up on Ctrl-C or Ctrl-D, and on an empty line', () => {
    expect(readPassword(sources({ terminal: true, typed: 'ab\u0003' }).src)).toBeNull();
    expect(readPassword(sources({ terminal: true, typed: '\n' }).src)).toBeNull();
  });
});
