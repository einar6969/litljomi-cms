import { readFile } from 'node:fs/promises';
import { runCli } from './cli.ts';
import type { ProvisionDeps } from './provision.ts';

const provision: ProvisionDeps = {
  fetch: (url, init) => fetch(url, init),
  readTextFile: (path) => readFile(path, 'utf8'),
  readStdin: async () => {
    if (process.stdin.isTTY) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString('utf8');
  },
};

process.exitCode = await runCli(process.argv.slice(2), { log: console.log, error: console.error, provision });
