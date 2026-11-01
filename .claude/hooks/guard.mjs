#!/usr/bin/env node
// PreToolUse hook (Task 0). Reads the hook event from stdin and asks tools/harness/guard-lib.mjs.
// Deny: append a line to docs/execution/guard-log.jsonl, print the reason to stderr, exit 2.
// Allow: exit 0 silently. If the event or gates.json cannot be read, only Read, Grep and Glob pass.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = process.env.CLAUDE_PROJECT_DIR || path.resolve(HERE, '../..');
const READ_ONLY_TOOLS = new Set(['Read', 'Grep', 'Glob']);

// Any unexpected crash denies: exit code 1 would let the tool call through.
for (const signal of ['uncaughtException', 'unhandledRejection']) {
  process.on(signal, (error) => {
    process.stderr.write(`Blocked by the harness guard (fail-closed): ${error?.message ?? error}\n`);
    process.exit(2);
  });
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function log(entry) {
  try {
    const file = path.join(repoRoot, 'docs/execution/guard-log.jsonl');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
  } catch {
    // Logging must never turn a deny into an allow.
  }
}

function finish(event, result, redact) {
  if (result.decision === 'allow') process.exit(0);
  const toolName = typeof event?.tool_name === 'string' ? event.tool_name : null;
  let input = null;
  try {
    input = redact ? redact(toolName, event?.tool_input) : null;
  } catch {
    input = null;
  }
  log({
    time: new Date().toISOString(),
    session_id: event?.session_id ?? null,
    agent_id: event?.agent_id ?? null,
    agent_type: event?.agent_type ?? null,
    tool_name: toolName,
    rule: result.rule,
    reason: result.reason,
    input,
  });
  process.stderr.write(`Blocked by the harness guard (${result.rule}): ${result.reason}\n` +
    'Report this denial to the controller; do not work around it.\n');
  process.exit(2);
}

let event = null;
try {
  event = JSON.parse(readStdin());
} catch {
  finish(null, { decision: 'deny', rule: 'fail-closed', reason: 'the hook event could not be parsed' });
}

// Loaded dynamically so that a missing or broken library denies (exit 2) instead of crashing
// with exit 1, which Claude Code treats as a non-blocking error.
let lib = null;
try {
  lib = await import(pathToFileURL(path.resolve(HERE, '../../tools/harness/guard-lib.mjs')).href);
} catch {
  lib = null;
}
if (!lib) {
  const name = event?.tool_name;
  finish(event, READ_ONLY_TOOLS.has(name)
    ? { decision: 'allow' }
    : { decision: 'deny', rule: 'fail-closed', reason: 'guard-lib.mjs could not be loaded' });
}

let gates = null;
try {
  gates = JSON.parse(fs.readFileSync(path.join(repoRoot, 'docs/execution/gates.json'), 'utf8'));
} catch {
  gates = null;
}

const labakRepoPath = lib.LABAK_REPO_PATH;
const ctx = { repoRoot, gates, labakRepoPath, ...lib.gitProbes(repoRoot, labakRepoPath) };
let result;
try {
  result = lib.evaluate(event, ctx);
} catch (error) {
  result = READ_ONLY_TOOLS.has(event?.tool_name)
    ? { decision: 'allow' }
    : { decision: 'deny', rule: 'fail-closed', reason: `guard error: ${error.message}` };
}
finish(event, result, lib.redactInput);
