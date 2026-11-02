import { runCli } from './cli.ts';

process.exitCode = await runCli(process.argv.slice(2), { log: console.log, error: console.error });
