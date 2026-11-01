#!/usr/bin/env node
// Integrity check for the protected harness files (Task 0).
//   node tools/harness/integrity.mjs          compare with docs/execution/harness.lock.json
//   node tools/harness/integrity.mjs --lock   write the lock (Einar only, in his own terminal)
// Exit codes: 0 clean, 1 mismatch (each file named), 3 no lock.
// The root is HARNESS_ROOT if set (tests), otherwise the repository holding this file.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LOCK_FILE = 'docs/execution/harness.lock.json';
// Every file under .claude/ is protected, plus these. The lock itself is protected but not hashed.
export const PROTECTED_DIR = '.claude';
export const PROTECTED_FILES = [
  'tools/harness/guard-lib.mjs',
  'tools/harness/gate.mjs',
  'tools/harness/integrity.mjs',
  'tools/harness/plan-index.json',
  'docs/execution/gates.json',
];

export function defaultRoot() {
  return process.env.HARNESS_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
}

function walk(root, rel) {
  const abs = path.join(root, rel);
  let stat;
  try {
    stat = fs.lstatSync(abs);
  } catch {
    return [];
  }
  if (!stat.isDirectory()) return [rel];
  return fs.readdirSync(abs).flatMap((name) => walk(root, `${rel}/${name}`));
}

/** Protected files present under the root, as sorted relative paths. */
export function protectedFiles(root) {
  const exists = (f) => {
    try {
      fs.lstatSync(path.join(root, f));
      return true;
    } catch {
      return false;
    }
  };
  const files = [...walk(root, PROTECTED_DIR), ...PROTECTED_FILES.filter(exists)];
  return [...new Set(files)].sort();
}

function sha256(file) {
  const stat = fs.lstatSync(file);
  // A symlink is hashed as its target path, so swapping it is visible.
  const data = stat.isSymbolicLink() ? `symlink:${fs.readlinkSync(file)}` : fs.readFileSync(file);
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function computeHashes(root) {
  return Object.fromEntries(protectedFiles(root).map((f) => [f, sha256(path.join(root, f))]));
}

/** Compare the protected files with the lock. */
export function check(root) {
  const lockPath = path.join(root, LOCK_FILE);
  if (!fs.existsSync(lockPath)) return { status: 'unlocked', mismatches: [] };
  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch {
    return { status: 'mismatch', mismatches: [{ file: LOCK_FILE, kind: 'unreadable' }] };
  }
  const locked = lock && typeof lock.files === 'object' && lock.files ? lock.files : {};
  if (Object.keys(locked).length === 0) {
    return { status: 'mismatch', mismatches: [{ file: LOCK_FILE, kind: 'empty' }] };
  }
  const current = computeHashes(root);
  const mismatches = [];
  for (const [file, hash] of Object.entries(locked)) {
    if (!(file in current)) mismatches.push({ file, kind: 'missing' });
    else if (current[file] !== hash) mismatches.push({ file, kind: 'changed' });
  }
  for (const file of Object.keys(current)) {
    if (!(file in locked)) mismatches.push({ file, kind: 'added' });
  }
  mismatches.sort((a, b) => a.file.localeCompare(b.file));
  return { status: mismatches.length ? 'mismatch' : 'clean', mismatches, lockedAt: lock.lockedAt };
}

/** Write the lock. For Einar only; the guard denies Claude running `--lock`. */
export function writeLock(root, lockedAt = new Date().toISOString()) {
  const lock = { schemaVersion: 1, lockedAt, files: computeHashes(root) };
  fs.mkdirSync(path.dirname(path.join(root, LOCK_FILE)), { recursive: true });
  fs.writeFileSync(path.join(root, LOCK_FILE), `${JSON.stringify(lock, null, 2)}\n`);
  return lock;
}

function main(argv) {
  const root = defaultRoot();
  if (argv.length === 1 && argv[0] === '--lock') {
    const lock = writeLock(root);
    console.log(`harness: locked ${Object.keys(lock.files).length} files at ${lock.lockedAt}`);
    for (const f of Object.keys(lock.files)) console.log(`  ${f}`);
    return 0;
  }
  if (argv.length > 0) {
    console.error('usage: node tools/harness/integrity.mjs [--lock]');
    return 64;
  }
  const result = check(root);
  if (result.status === 'unlocked') {
    console.log(`harness: unlocked (no lock yet; ${LOCK_FILE} is missing)`);
    return 3;
  }
  if (result.status === 'clean') {
    console.log(`harness: integrity clean (locked ${result.lockedAt})`);
    return 0;
  }
  console.log('harness: INTEGRITY MISMATCH');
  for (const m of result.mismatches) console.log(`  ${m.kind}: ${m.file}`);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
