import { readFile } from 'node:fs/promises';
import type { BoundaryCheckDeps } from './boundary-check.ts';
import { runCli } from './cli.ts';
import type { ProvisionDeps } from './provision.ts';
import { readStdinSync } from './stdin.ts';

const provision: ProvisionDeps = {
  fetch: (url, init) => fetch(url, init),
  readTextFile: (path) => readFile(path, 'utf8'),
  readStdin: async () => readStdinSync(),
};

const boundaryCheck: BoundaryCheckDeps = {
  fetch: (url, init) => fetch(url, init),
  readTextFile: (path) => readFile(path, 'utf8'),
};

// Failing until runCli returns: if the runtime ends the process early, it never reports success.
process.exitCode = 1;
process.exitCode = await runCli(process.argv.slice(2), { log: console.log, error: console.error, provision, boundaryCheck });
