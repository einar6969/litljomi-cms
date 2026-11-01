#!/usr/bin/env node
// Records a gate decision in docs/execution/gates.json. For Einar only, in his own terminal.
//   node tools/harness/gate.mjs approve|revoke <G0–G7> --note "<text>" [--param key=value]…
// The guard denies Claude running this script; as an extra layer it refuses when CLAUDECODE is set.
// The root is HARNESS_ROOT if set (tests), otherwise the repository holding this file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GATES = ['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'];
const USAGE = 'usage: node tools/harness/gate.mjs approve|revoke <G0–G7> --note "<text>" [--param key=value]…';

function parseArgs(argv) {
  const [action, id, ...rest] = argv;
  if (action !== 'approve' && action !== 'revoke') throw new Error(`unknown action ${action ?? '(none)'}\n${USAGE}`);
  if (!GATES.includes(id)) throw new Error(`invalid gate ${id ?? '(none)'}: expected one of ${GATES.join(', ')}`);
  let note = null;
  const params = {};
  for (let k = 0; k < rest.length; k++) {
    const a = rest[k];
    if (a === '--note') {
      note = rest[++k];
    } else if (a === '--param') {
      const kv = rest[++k] ?? '';
      const m = /^([A-Za-z][A-Za-z0-9_-]*)=(.*)$/.exec(kv);
      if (!m) throw new Error(`--param needs key=value, got "${kv}"`);
      params[m[1]] = m[2];
    } else {
      throw new Error(`unexpected argument ${a}\n${USAGE}`);
    }
  }
  if (typeof note !== 'string' || note.trim() === '') throw new Error(`--note "<text>" is required\n${USAGE}`);
  return { action, id, note, params };
}

/** Apply a decision to a parsed gates.json object, keeping every other field. */
export function applyGate(file, { action, id, note, params }, at = new Date().toISOString()) {
  const previous = file.gates[id] ?? {};
  file.gates[id] = {
    ...previous,
    status: action === 'approve' ? 'approved' : 'revoked',
    by: 'Einar',
    at,
    note,
    params: action === 'approve' ? params : {},
  };
  return file;
}

function main(argv) {
  if (process.env.CLAUDECODE) {
    console.error('gate.mjs refuses to run inside Claude Code (CLAUDECODE is set). Einar runs it in his own terminal.');
    return 77;
  }
  const root = process.env.HARNESS_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const file = path.join(root, 'docs/execution/gates.json');
  let request;
  let gates;
  try {
    request = parseArgs(argv);
    gates = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!gates || typeof gates.gates !== 'object' || gates.gates === null) throw new Error(`${file} has no "gates" object`);
  } catch (error) {
    console.error(error.message);
    return 64;
  }
  applyGate(gates, request);
  fs.writeFileSync(file, `${JSON.stringify(gates, null, 2)}\n`);
  const g = gates.gates[request.id];
  console.log(`${request.id} ${g.status} by ${g.by} at ${g.at}: ${g.note}`);
  if (Object.keys(g.params).length) console.log(`params: ${JSON.stringify(g.params)}`);
  console.log('gates.json is covered by the integrity lock. Re-lock with: node tools/harness/integrity.mjs --lock');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
