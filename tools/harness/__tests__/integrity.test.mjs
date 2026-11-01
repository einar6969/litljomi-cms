// Tests for the integrity check. They run on temporary copies; the real lock is never written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { protectedFiles, check, writeLock } from '../integrity.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const CLI = path.join(REPO, 'tools/harness/integrity.mjs');

const FILES = [
  '.claude/settings.json',
  '.claude/hooks/guard.mjs',
  '.claude/hooks/session-start.mjs',
  '.claude/agents/cms-implementer.md',
  'tools/harness/guard-lib.mjs',
  'tools/harness/gate.mjs',
  'tools/harness/integrity.mjs',
  'tools/harness/plan-index.json',
  'docs/execution/gates.json',
];

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'integrity-test-'));
  for (const f of FILES) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), `content of ${f}\n`);
  }
  fs.writeFileSync(path.join(root, 'tools/harness/state.mjs'), 'not protected\n');
  return root;
}

function cli(root) {
  return spawnSync(process.execPath, [CLI], { env: { ...process.env, HARNESS_ROOT: root }, encoding: 'utf8' });
}

function withRoot(fn) {
  return () => {
    const root = setup();
    try {
      fn(root);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

test('protected files are the listed files plus everything under .claude/', withRoot((root) => {
  assert.deepEqual(protectedFiles(root), [...FILES].sort());
}));

test('the repository protects its actual harness files', () => {
  const files = protectedFiles(REPO);
  for (const f of [
    '.claude/settings.json',
    '.claude/hooks/guard.mjs',
    '.claude/hooks/session-start.mjs',
    '.claude/agents/cms-implementer.md',
    '.claude/agents/cms-spec-reviewer.md',
    '.claude/agents/cms-security-reviewer.md',
    '.claude/agents/cms-quality-reviewer.md',
    'tools/harness/guard-lib.mjs',
    'tools/harness/gate.mjs',
    'tools/harness/integrity.mjs',
    'tools/harness/plan-index.json',
    'docs/execution/gates.json',
  ]) {
    assert.ok(files.includes(f), `${f} is protected`);
  }
  assert.ok(!files.includes('docs/execution/harness.lock.json'), 'the lock does not hash itself');
  assert.ok(!files.includes('tools/harness/state.mjs'));
});

test('without a lock the check reports unlocked and exits 3', withRoot((root) => {
  assert.equal(check(root).status, 'unlocked');
  const r = cli(root);
  assert.equal(r.status, 3);
  assert.match(r.stdout + r.stderr, /no lock/);
}));

test('a fresh lock is clean and exits 0', withRoot((root) => {
  writeLock(root, '2026-11-01T00:00:00.000Z');
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'docs/execution/harness.lock.json'), 'utf8'));
  assert.equal(lock.schemaVersion, 1);
  assert.equal(lock.lockedAt, '2026-11-01T00:00:00.000Z');
  assert.deepEqual(Object.keys(lock.files).sort(), [...FILES].sort());
  for (const h of Object.values(lock.files)) assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(check(root).status, 'clean');
  assert.equal(cli(root).status, 0);
}));

test('changing one protected file produces a mismatch naming it', withRoot((root) => {
  writeLock(root);
  fs.appendFileSync(path.join(root, 'tools/harness/gate.mjs'), ' ');
  const result = check(root);
  assert.equal(result.status, 'mismatch');
  assert.deepEqual(result.mismatches.map((m) => m.file), ['tools/harness/gate.mjs']);
  const r = cli(root);
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /tools\/harness\/gate\.mjs/);
}));

test('an added or removed protected file is a mismatch', withRoot((root) => {
  writeLock(root);
  fs.writeFileSync(path.join(root, '.claude/settings.local.json'), '{}');
  fs.rmSync(path.join(root, '.claude/hooks/guard.mjs'));
  const result = check(root);
  assert.equal(result.status, 'mismatch');
  const byFile = Object.fromEntries(result.mismatches.map((m) => [m.file, m.kind]));
  assert.equal(byFile['.claude/settings.local.json'], 'added');
  assert.equal(byFile['.claude/hooks/guard.mjs'], 'missing');
}));

test('changing an unprotected file is not a mismatch', withRoot((root) => {
  writeLock(root);
  fs.appendFileSync(path.join(root, 'tools/harness/state.mjs'), 'changed\n');
  assert.equal(check(root).status, 'clean');
}));
