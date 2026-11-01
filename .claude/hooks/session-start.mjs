#!/usr/bin/env node
// SessionStart hook (Task 0). Prints context for a new session. Never blocks: always exits 0.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = process.env.CLAUDE_PROJECT_DIR || path.resolve(HERE, '../..');
const lines = [];

try {
  const integrity = await import(pathToFileURL(path.resolve(HERE, '../../tools/harness/integrity.mjs')).href);
  const result = integrity.check(repoRoot);
  if (result.status === 'unlocked') lines.push('harness: unlocked (no lock yet)');
  else if (result.status === 'clean') lines.push(`harness: integrity clean (locked ${result.lockedAt})`);
  else {
    lines.push('harness: INTEGRITY MISMATCH. Stop and tell Einar:');
    for (const m of result.mismatches) lines.push(`  ${m.kind}: ${m.file}`);
  }
} catch (error) {
  lines.push(`harness: integrity check failed to run (${error.message}). Stop and tell Einar.`);
}

try {
  const gates = JSON.parse(fs.readFileSync(path.join(repoRoot, 'docs/execution/gates.json'), 'utf8')).gates;
  const summary = Object.entries(gates).map(([id, g]) => `${id} ${g.status}`).join(', ');
  lines.push(`gates: ${summary}`);
} catch {
  lines.push('gates: docs/execution/gates.json could not be read; the guard allows only Read, Grep and Glob.');
}

lines.push('Read docs/execution/RESUME.md first.');
lines.push(
  'Hosted connectors and browser tools must be switched off for this session ' +
  '(Supabase, Vercel, Neon, Netlify, Sanity, Zoho Mail, Claude Docs, both browser tools). ' +
  'If a hosted-connector or browser tool is available, stop and tell Einar (V-CONNECTORS). ' +
  'The guard allows only mcp__ccd_turn__ tools.',
);

process.stdout.write(`${lines.join('\n')}\n`);
process.exit(0);
