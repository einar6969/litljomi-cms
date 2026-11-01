// Tests for gate.mjs. They run against temporary copies of gates.json, never the real file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const CLI = path.join(REPO, 'tools/harness/gate.mjs');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-test-'));
  fs.mkdirSync(path.join(root, 'docs/execution'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'docs/execution/gates.json'), path.join(root, 'docs/execution/gates.json'));
  return root;
}

function gate(root, args, { claudecode = false } = {}) {
  const env = { ...process.env, HARNESS_ROOT: root };
  delete env.CLAUDECODE;
  if (claudecode) env.CLAUDECODE = '1';
  return spawnSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8' });
}

const read = (root) => JSON.parse(fs.readFileSync(path.join(root, 'docs/execution/gates.json'), 'utf8'));

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

test('refuses when CLAUDECODE is set and leaves gates.json unchanged', withRoot((root) => {
  const before = fs.readFileSync(path.join(root, 'docs/execution/gates.json'), 'utf8');
  const r = gate(root, ['approve', 'G1', '--note', 'OrbStack installed'], { claudecode: true });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /CLAUDECODE/);
  assert.equal(fs.readFileSync(path.join(root, 'docs/execution/gates.json'), 'utf8'), before);
}));

test('approve G9 is invalid', withRoot((root) => {
  const r = gate(root, ['approve', 'G9', '--note', 'x']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /G9/);
}));

test('a note is required and unknown actions are refused', withRoot((root) => {
  assert.notEqual(gate(root, ['approve', 'G1']).status, 0);
  assert.notEqual(gate(root, ['grant', 'G1', '--note', 'x']).status, 0);
  assert.notEqual(gate(root, ['approve', 'G1', '--note', 'x', '--param', 'novalue']).status, 0);
}));

test('approve stores the note and --param values', withRoot((root) => {
  const r = gate(root, ['approve', 'G7', '--note', 'LABAK branch', '--param', 'branch=hub-integration', '--param', 'push=true']);
  assert.equal(r.status, 0, r.stderr);
  const g = read(root).gates.G7;
  assert.equal(g.status, 'approved');
  assert.equal(g.by, 'Einar');
  assert.equal(g.note, 'LABAK branch');
  assert.match(g.at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(g.params, { branch: 'hub-integration', push: 'true' });
}));

test('revoke marks the gate revoked and keeps the other gates', withRoot((root) => {
  const before = read(root);
  const r = gate(root, ['revoke', 'G0', '--note', 'paused']);
  assert.equal(r.status, 0, r.stderr);
  const after = read(root);
  assert.equal(after.gates.G0.status, 'revoked');
  assert.equal(after.gates.G0.by, 'Einar');
  assert.deepEqual(after.gates.G0.params, {});
  assert.deepEqual(after.gates.G1, before.gates.G1);
  assert.equal(after.schemaVersion, before.schemaVersion);
  assert.equal(after.note, before.note);
}));
