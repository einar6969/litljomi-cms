// Tests for the execution-state CLI. Every test runs against a temporary copy, never docs/execution/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, initialState, validateAgainstSchema } from '../state.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const PLAN_INDEX = JSON.parse(fs.readFileSync(path.join(REPO, 'tools/harness/plan-index.json'), 'utf8'));
const SCHEMA = JSON.parse(fs.readFileSync(path.join(REPO, 'docs/execution/state.schema.json'), 'utf8'));
const EXECUTION_ORDER = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 17, 19, 20, 26, 21, 30, 22, 23, 24, 25, 31, 32, 27, 28, 29];

function gatesFile(approved = ['G0']) {
  const gates = {};
  for (const id of ['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7']) {
    gates[id] = approved.includes(id)
      ? { status: 'approved', by: 'Einar', at: '2026-11-01', note: 'test', params: {} }
      : { status: 'pending', params: {} };
  }
  return { schemaVersion: 1, gates };
}

function setup({ approved = ['G0'], planIndex = PLAN_INDEX } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'state-test-'));
  fs.mkdirSync(path.join(root, 'tools/harness'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs/execution/reviews'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs/execution/checkpoints'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools/harness/plan-index.json'), JSON.stringify(planIndex, null, 2));
  fs.copyFileSync(path.join(REPO, 'docs/execution/state.schema.json'), path.join(root, 'docs/execution/state.schema.json'));
  fs.writeFileSync(path.join(root, 'docs/execution/gates.json'), JSON.stringify(gatesFile(approved), null, 2));
  fs.writeFileSync(
    path.join(root, 'docs/execution/state.json'),
    JSON.stringify(initialState(planIndex, 'm1/phase-0', '2026-11-01T00:00:00.000Z'), null, 2),
  );
  fs.writeFileSync(path.join(root, 'docs/execution/reviews/r.md'), 'report');
  fs.writeFileSync(path.join(root, 'docs/execution/checkpoints/C0.md'), 'checkpoint');
  return root;
}

const readState = (root) => JSON.parse(fs.readFileSync(path.join(root, 'docs/execution/state.json'), 'utf8'));
const writeState = (root, s) => fs.writeFileSync(path.join(root, 'docs/execution/state.json'), JSON.stringify(s, null, 2));
const task = (s, id) => s.tasks.find((t) => t.id === id);
const pass = (round = 1, atCommits = 1) => ({ status: 'pass', round, report: 'docs/execution/reviews/r.md', at: '2026-11-01T00:00:00.000Z', atCommits });

function approveCheckpoints(root, ids) {
  const s = readState(root);
  for (const id of ids) Object.assign(s.checkpoints[id], { status: 'reported', report: 'docs/execution/checkpoints/C0.md', approvedByEinar: true });
  writeState(root, s);
}

function markDone(root, ids) {
  const s = readState(root);
  for (const id of ids) {
    const t = task(s, id);
    t.status = 'done';
    t.commits = ['abc1234'];
    t.reviews = { spec: pass(), quality: pass(), security: pass() };
  }
  writeState(root, s);
}

function withRoot(fn, options) {
  return () => {
    const root = setup(options);
    try {
      fn(root);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

test('plan-index lists Tasks 0–32 in execution order with phases, gates and checkpoints', () => {
  assert.deepEqual(PLAN_INDEX.map((t) => t.id), EXECUTION_ORDER);
  const byId = Object.fromEntries(PLAN_INDEX.map((t) => [t.id, t]));
  const sensitive = [0, 4, 5, 6, 7, 8, 9, 10, 11, 12, 17, 18, 19, 20, 21, 22, 24, 25, 26, 27, 28, 30, 32];
  for (const t of PLAN_INDEX) {
    assert.equal(typeof t.title, 'string');
    assert.ok(t.title.length > 0);
    assert.equal(t.sensitive, sensitive.includes(t.id), `sensitive flag of Task ${t.id}`);
    assert.ok(t.requiredGates.includes('G0'), `Task ${t.id} needs G0`);
    const index = EXECUTION_ORDER.indexOf(t.id);
    assert.equal(t.requiredGates.includes('G1'), index >= EXECUTION_ORDER.indexOf(2), `G1 on Task ${t.id}`);
  }
  assert.deepEqual(byId[0].requiredGates, ['G0']);
  assert.deepEqual(byId[1].requiredGates, ['G0']);
  assert.deepEqual(byId[2].requiredGates, ['G0', 'G1']);
  assert.deepEqual(byId[27].requiredGates, ['G0', 'G1', 'G7']);
  assert.deepEqual(byId[28].requiredGates, ['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6']);
  assert.deepEqual(byId[29].requiredGates, ['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6']);
  const checkpoints = PLAN_INDEX.filter((t) => t.checkpointAfter).map((t) => [t.id, t.checkpointAfter]);
  assert.deepEqual(checkpoints, [[3, 'C0'], [18, 'C1'], [21, 'C2'], [27, 'C3'], [29, 'C4']]);
  const tiers = { high: [0, 4, 5, 6, 7, 8, 9, 10, 11, 12, 17, 19, 20, 21, 22, 24, 25, 28, 30, 32], medium: [18, 26, 27, 29] };
  for (const t of PLAN_INDEX) {
    const expected = tiers.high.includes(t.id) ? 'high' : tiers.medium.includes(t.id) ? 'medium' : 'low';
    assert.equal(t.tier, expected, `tier of Task ${t.id}`);
    assert.equal(t.lane, [13, 14, 15, 16, 18, 26, 30, 32].includes(t.id) ? 'B' : 'A', `lane of Task ${t.id}`);
    for (const dep of t.dependsOn) {
      assert.ok(EXECUTION_ORDER.indexOf(dep) < EXECUTION_ORDER.indexOf(t.id), `Task ${t.id} depends on a later task ${dep}`);
    }
  }
  assert.deepEqual(byId[13].dependsOn, [3]);
  assert.deepEqual(byId[18].dependsOn, [16]);
  assert.deepEqual(byId[17].dependsOn, [12, 16]);
  assert.deepEqual(byId[19].dependsOn, [17, 18]);
  assert.deepEqual(byId[26].dependsOn, [16, 18]);
  assert.deepEqual(byId[21].dependsOn, [20, 26]);
  assert.deepEqual(byId[22].dependsOn, [21, 26]);
  assert.deepEqual(byId[30].dependsOn, [21]);
  assert.deepEqual(byId[25].dependsOn, [24, 30]);
  assert.deepEqual(byId[31].dependsOn, [25]);
  assert.deepEqual(byId[29].dependsOn, [28, 31, 32]);
  assert.deepEqual(byId[32].dependsOn, [31]);
  const phases = { 0: [0, 1, 2, 3], 1: [4, 5, 6, 7, 8, 9, 10, 11, 12], 2: [13, 14, 15, 16], 3: [17, 18, 19, 20, 21], 4: [22, 23, 24, 25, 30, 31], 5: [26, 27, 32], 6: [28, 29] };
  for (const [phase, ids] of Object.entries(phases)) for (const id of ids) assert.equal(byId[id].phase, Number(phase));
  assert.equal(byId[0].title, 'Execution setup');
});

test('the repository state.json validates against state.schema.json', () => {
  const state = JSON.parse(fs.readFileSync(path.join(REPO, 'docs/execution/state.json'), 'utf8'));
  assert.deepEqual(validateAgainstSchema(SCHEMA, state), []);
  assert.deepEqual(state.tasks.map((t) => t.id), EXECUTION_ORDER);
});

test('the schema rejects a malformed state', () => {
  const state = initialState(PLAN_INDEX, 'm1/phase-0', '2026-11-01T00:00:00.000Z');
  state.tasks[0].status = 'finished';
  delete state.validationGates['A1'];
  const errors = validateAgainstSchema(SCHEMA, state);
  assert.ok(errors.some((e) => e.includes('tasks[0].status')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('A1')), errors.join('\n'));
});

test('initial state: every task pending, every validation gate and checkpoint pending', () => {
  const s = initialState(PLAN_INDEX, 'm1/phase-0', '2026-11-01T00:00:00.000Z');
  assert.equal(s.tasks.length, 33);
  assert.ok(s.tasks.every((t) => t.status === 'pending' && t.commits.length === 0));
  const gates = ['V-HARNESS', 'V-CONNECTORS', 'V-SANDBOX', 'V-HELPERS', ...Array.from({ length: 15 }, (_, i) => `A${i + 1}`)];
  assert.deepEqual(Object.keys(s.validationGates).sort(), gates.sort());
  assert.ok(Object.values(s.validationGates).every((g) => g.status === 'pending'));
  assert.deepEqual(Object.keys(s.checkpoints), ['C0', 'C1', 'C2', 'C3', 'C4']);
  assert.equal(s.branch, 'm1/phase-0');
});

test('start 1 is refused while Task 0 is not done', withRoot((root) => {
  const r = run(['start', '1'], { root });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /Task 0/);
  assert.equal(task(readState(root), 1).status, 'pending');
}));

test('start 0 is allowed with G0 approved and records the gates used', withRoot((root) => {
  const r = run(['start', '0'], { root });
  assert.equal(r.code, 0, r.stderr);
  const t = task(readState(root), 0);
  assert.equal(t.status, 'in_progress');
  assert.deepEqual(t.gatesUsed, ['G0']);
}));

test('start 2 is refused while G1 is pending', withRoot((root) => {
  markDone(root, [0, 1]);
  const r = run(['start', '2'], { root });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /G1/);
  fs.writeFileSync(path.join(root, 'docs/execution/gates.json'), JSON.stringify(gatesFile(['G0', 'G1'])));
  assert.equal(run(['start', '2'], { root }).code, 0);
}));

test('start is refused while a blocker is open', withRoot((root) => {
  markDone(root, [0]);
  assert.equal(run(['block', '1', 'waiting for Einar'], { root }).code, 0);
  assert.equal(task(readState(root), 1).status, 'blocked');
  const r = run(['start', '1'], { root });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /blocker/i);
  assert.equal(run(['unblock', '1'], { root }).code, 0);
  const t = task(readState(root), 1);
  assert.equal(t.status, 'pending');
  assert.ok(t.blockers.every((b) => b.resolvedAt));
  assert.equal(run(['start', '1'], { root }).code, 0);
}));

test('done 4 is refused without a passing security review', withRoot((root) => {
  markDone(root, [0, 1, 2, 3]);
  const s = readState(root);
  const t = task(s, 4);
  t.status = 'in_review';
  t.commits = ['abc1234'];
  t.reviews = { spec: pass(), quality: pass() };
  writeState(root, s);
  const r = run(['done', '4'], { root });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /security/);
  assert.equal(run(['review', '4', 'security', 'fail', 'docs/execution/reviews/r.md'], { root }).code, 0);
  assert.notEqual(run(['done', '4'], { root }).code, 0);
  assert.equal(run(['review', '4', 'security', 'pass', 'docs/execution/reviews/r.md'], { root }).code, 0);
  assert.equal(task(readState(root), 4).reviews.security.round, 2);
  assert.equal(run(['done', '4'], { root }).code, 0);
  assert.equal(task(readState(root), 4).status, 'done');
}));

// Lane A and Lane B: two active tasks only in different lanes.
const twoLaneIndex = PLAN_INDEX.map((t) => (t.id === 6 ? { ...t, dependsOn: [4] } : t));

test('start allows one active task per lane', withRoot((root) => {
  markDone(root, [0, 1, 2, 3, 4]);
  approveCheckpoints(root, ['C0']);
  assert.equal(run(['start', '5'], { root }).code, 0);
  const r = run(['start', '6'], { root });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /lane A/);
  assert.match(r.stderr, /Task 5/);
  assert.equal(run(['start', '13'], { root }).code, 0);
  assert.equal(task(readState(root), 13).status, 'in_progress');
}, { planIndex: twoLaneIndex, approved: ['G0', 'G1'] }));

// Lane A overlap (Einar, 2026-11-02): the next Lane A task may start while its Lane A dependency is in review.
test('start allows a Lane A task while its Lane A dependency is in_review, not in_progress', withRoot((root) => {
  markDone(root, [0, 1, 2, 3, 4, 5, 6]);
  approveCheckpoints(root, ['C0']);
  assert.equal(run(['start', '7'], { root }).code, 0);
  let r = run(['start', '8'], { root });
  assert.notEqual(r.code, 0, 'Task 7 in_progress');
  assert.match(r.stderr, /depends on Task 7, not done or in review/);
  const s = readState(root);
  task(s, 7).status = 'in_review';
  writeState(root, s);
  r = run(['start', '8'], { root });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(task(readState(root), 8).status, 'in_progress');
}, { approved: ['G0', 'G1'] }));

// The busy rule on its own: Tasks 8 and 9 both depend only on Task 7, so the dependency check
// passes for both and only the one-in_progress-Lane-A-task rule can refuse.
const independentLaneAIndex = PLAN_INDEX.map((t) => (t.id === 9 ? { ...t, dependsOn: [7] } : t));

test('start refuses a second in_progress Lane A task even when its dependencies are ready', withRoot((root) => {
  markDone(root, [0, 1, 2, 3, 4, 5, 6, 7]);
  approveCheckpoints(root, ['C0']);
  assert.equal(run(['start', '8'], { root }).code, 0);
  let r = run(['start', '9'], { root });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /lane A already has an active task: Task 8 \(in_progress\)/);
  assert.doesNotMatch(r.stderr, /depends on/);
  // Blocked counts as busy too.
  let s = readState(root);
  task(s, 8).status = 'blocked';
  writeState(root, s);
  r = run(['start', '9'], { root });
  assert.match(r.stderr, /lane A already has an active task: Task 8 \(blocked\)/);
  // In review does not: the overlap allows the next Lane A task.
  s = readState(root);
  task(s, 8).status = 'in_review';
  writeState(root, s);
  r = run(['start', '9'], { root });
  assert.equal(r.code, 0, r.stderr);
}, { planIndex: independentLaneAIndex, approved: ['G0', 'G1'] }));

// Documents what the rule allows, not what the controller does (it works in one worktree and never
// has two Lane A tasks in review with a third in progress): Task 9 may start with 7 and 8 both in_review.
test('start allows a Lane A task with two Lane A tasks in_review', withRoot((root) => {
  markDone(root, [0, 1, 2, 3, 4, 5, 6]);
  approveCheckpoints(root, ['C0']);
  const s = readState(root);
  task(s, 7).status = 'in_review';
  task(s, 8).status = 'in_review';
  writeState(root, s);
  const r = run(['start', '9'], { root });
  assert.equal(r.code, 0, r.stderr);
}, { approved: ['G0', 'G1'] }));

test('start refuses a Lane A task whose dependency is blocked', withRoot((root) => {
  markDone(root, [0, 1, 2, 3, 4, 5, 6]);
  approveCheckpoints(root, ['C0']);
  const s = readState(root);
  task(s, 7).status = 'blocked';
  task(s, 7).blockers = [{ text: 'x', at: '2026-11-02T00:00:00.000Z', previousStatus: 'in_review', resolvedAt: null }];
  writeState(root, s);
  let r = run(['start', '8'], { root });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /Task 7/);
  // Blocked without an open blocker recorded: still not ready.
  const s2 = readState(root);
  task(s2, 7).blockers = [];
  writeState(root, s2);
  r = run(['start', '8'], { root });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /Task 7/);
}, { approved: ['G0', 'G1'] }));

test('done refuses while a dependency is not done', withRoot((root) => {
  markDone(root, [0, 1, 2, 3, 4, 5, 6]);
  approveCheckpoints(root, ['C0']);
  const s = readState(root);
  task(s, 7).status = 'in_review';
  Object.assign(task(s, 8), { status: 'in_review', commits: ['abc1234'], reviews: { spec: pass(), security: { ...pass(), atCommits: 1 }, quality: pass() } });
  writeState(root, s);
  let r = run(['done', '8'], { root });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /Task 7 done first/);
  markDone(root, [7]);
  r = run(['done', '8'], { root });
  assert.equal(r.code, 0, r.stderr);
}, { approved: ['G0', 'G1'] }));

test('start refuses while any dependency is not done (Task 17 waits for both 12 and 16)', withRoot((root) => {
  markDone(root, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 18]);
  approveCheckpoints(root, ['C0', 'C1']);
  let r = run(['start', '17'], { root });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /Task 12/);
  const s = readState(root);
  task(s, 12).status = 'done';
  task(s, 16).status = 'in_review';
  writeState(root, s);
  r = run(['start', '17'], { root });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /Task 16/);
  markDone(root, [16]);
  r = run(['start', '17'], { root });
  assert.equal(r.code, 0, r.stderr);
}, { approved: ['G0', 'G1'] }));

test('start refuses a task placed after a checkpoint Einar has not approved', withRoot((root) => {
  markDone(root, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18]);
  approveCheckpoints(root, ['C0']);
  let r = run(['start', '17'], { root });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /C1/);
  approveCheckpoints(root, ['C1']);
  r = run(['start', '17'], { root });
  assert.equal(r.code, 0, r.stderr);
}, { approved: ['G0', 'G1'] }));

test('state.mjs refuses a plan index with a security-sensitive low-tier task', withRoot((root) => {
  const r = run(['show'], { root });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /Task 13.*sensitive.*low/);
}, { planIndex: PLAN_INDEX.map((t) => (t.id === 13 ? { ...t, sensitive: true } : t)) }));

test('done refuses when a security review is older than the latest commit', withRoot((root) => {
  markDone(root, [0, 1, 2, 3, 4]);
  reviewed(root, 5, { spec: pass(), security: pass(), quality: pass() });
  assert.equal(run(['commit', '5', 'def5678'], { root }).code, 0);
  let r = run(['done', '5'], { root });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /security review .*older than the latest commit/);
  assert.equal(run(['review', '5', 'security', 'pass', 'docs/execution/reviews/r.md'], { root }).code, 0);
  assert.equal(task(readState(root), 5).reviews.security.atCommits, 2);
  r = run(['done', '5'], { root });
  assert.equal(r.code, 0, r.stderr);
}));

function reviewed(root, id, reviews) {
  const s = readState(root);
  Object.assign(task(s, id), { status: 'in_review', commits: ['abc1234'], reviews });
  writeState(root, s);
}

test('done on a low-tier task needs only a combined spec-and-quality review', withRoot((root) => {
  markDone(root, [0, 1, 2, 3]);
  reviewed(root, 13, {});
  let r = run(['done', '13'], { root });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /specQuality/);
  assert.equal(run(['review', '13', 'specQuality', 'pass', 'docs/execution/reviews/r.md'], { root }).code, 0);
  r = run(['done', '13'], { root });
  assert.equal(r.code, 0, r.stderr);
}));

test('done refuses any recorded review that did not pass, even one the tier does not require', withRoot((root) => {
  reviewed(root, 13, { specQuality: pass() });
  assert.equal(run(['review', '13', 'security', 'fail', 'docs/execution/reviews/r.md'], { root }).code, 0);
  const r = run(['done', '13'], { root });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /security/);
}));

test('done on a medium-tier task needs security and specQuality reviews', withRoot((root) => {
  markDone(root, [0, 1, 2, 3, 13, 14, 15, 16]);
  reviewed(root, 18, { specQuality: pass() });
  let r = run(['done', '18'], { root });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /security/);
  reviewed(root, 18, { security: pass() });
  r = run(['done', '18'], { root });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /specQuality/);
  reviewed(root, 18, { security: pass(), specQuality: pass() });
  assert.equal(run(['done', '18'], { root }).code, 0);
}));

test('done on a high-tier task does not accept a combined review instead of spec and quality', withRoot((root) => {
  reviewed(root, 5, { security: pass(), specQuality: pass() });
  const r = run(['done', '5'], { root });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /spec review/);
  assert.match(r.stderr, /quality review/);
}));

test('done requires a commit and spec and quality reviews', withRoot((root) => {
  assert.equal(run(['start', '0'], { root }).code, 0);
  let r = run(['done', '0'], { root });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /commit/);
  assert.equal(run(['commit', '0', 'abc1234'], { root }).code, 0);
  assert.notEqual(run(['commit', '0', 'not-a-hash'], { root }).code, 0);
  assert.equal(run(['review', '0', 'spec', 'pass', 'docs/execution/reviews/r.md'], { root }).code, 0);
  assert.equal(run(['review', '0', 'security', 'pass', 'docs/execution/reviews/r.md'], { root }).code, 0);
  r = run(['done', '0'], { root });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /quality/);
  assert.notEqual(run(['review', '0', 'quality', 'pass', 'docs/execution/reviews/missing.md'], { root }).code, 0);
  assert.equal(run(['review', '0', 'quality', 'pass', 'docs/execution/reviews/r.md'], { root }).code, 0);
  assert.equal(run(['done', '0'], { root }).code, 0);
}));

test('checkpoint C0 is refused while Task 3 is not done', withRoot((root) => {
  markDone(root, [0, 1, 2]);
  const r = run(['checkpoint', 'C0', 'docs/execution/checkpoints/C0.md'], { root });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /Task 3/);
  markDone(root, [3]);
  assert.equal(run(['checkpoint', 'C0', 'docs/execution/checkpoints/C0.md'], { root }).code, 0);
  const c = readState(root).checkpoints.C0;
  assert.equal(c.status, 'reported');
  assert.equal(c.report, 'docs/execution/checkpoints/C0.md');
  assert.equal(c.approvedByEinar, false);
}));

test('validate records a validation gate with its evidence', withRoot((root) => {
  assert.equal(run(['validate', 'V-HARNESS', 'pass', 'docs/execution/reviews/r.md'], { root }).code, 0);
  assert.equal(readState(root).validationGates['V-HARNESS'].status, 'pass');
  assert.notEqual(run(['validate', 'A99', 'pass', 'docs/execution/reviews/r.md'], { root }).code, 0);
}));

test('validate can waive a gate with evidence, and refuses other results', withRoot((root) => {
  assert.equal(run(['validate', 'V-CONNECTORS', 'waived', 'docs/execution/reviews/r.md'], { root }).code, 0);
  assert.equal(readState(root).validationGates['V-CONNECTORS'].status, 'waived');
  assert.notEqual(run(['validate', 'V-CONNECTORS', 'skipped', 'docs/execution/reviews/r.md'], { root }).code, 0);
}));

test('validate allows waived only for V-HARNESS and V-CONNECTORS', withRoot((root) => {
  for (const gate of ['V-HARNESS', 'V-CONNECTORS']) {
    assert.equal(run(['validate', gate, 'waived', 'docs/execution/reviews/r.md'], { root }).code, 0, gate);
    assert.equal(readState(root).validationGates[gate].status, 'waived', gate);
  }
  for (const gate of ['V-SANDBOX', 'V-HELPERS', 'A1']) {
    const r = run(['validate', gate, 'waived', 'docs/execution/reviews/r.md'], { root });
    assert.notEqual(r.code, 0, gate);
    assert.match(r.stderr, /waived/, gate);
    assert.equal(readState(root).validationGates[gate].status, 'pending', gate);
  }
}));

test('render writes progress.md containing every task', withRoot((root) => {
  assert.equal(run(['render'], { root }).code, 0);
  const md = fs.readFileSync(path.join(root, 'docs/execution/progress.md'), 'utf8');
  for (const t of PLAN_INDEX) {
    assert.ok(md.includes(`| ${t.id} |`), `progress.md lists Task ${t.id}`);
    assert.ok(md.includes(t.title), `progress.md has the title of Task ${t.id}`);
  }
  assert.match(md, /generated/i);
}));

test('render appends the controller notes file when it exists', withRoot((root) => {
  fs.writeFileSync(path.join(root, 'docs/execution/progress-notes.md'), 'First Lane B merge: clean.\n');
  assert.equal(run(['render'], { root }).code, 0);
  const md = fs.readFileSync(path.join(root, 'docs/execution/progress.md'), 'utf8');
  assert.match(md, /## Controller notes\n\nFirst Lane B merge: clean\./);
}));

test('show prints the next task', withRoot((root) => {
  const r = run(['show'], { root });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Next task: 0/);
}));

test('unknown commands and tasks are refused', withRoot((root) => {
  assert.notEqual(run(['frobnicate'], { root }).code, 0);
  assert.notEqual(run(['start', '30'], { root }).code, 0);
  assert.notEqual(run([], { root }).code, 0);
}));
