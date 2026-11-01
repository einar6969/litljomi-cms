#!/usr/bin/env node
// Execution-state CLI (Task 0). docs/execution/state.json is authoritative; progress.md is generated.
// The controller is its only user. Commands:
//   show | start <task> | commit <task> <hash> | review <task> spec|security|quality pass|fail <report>
//   block <task> "<text>" | unblock <task> | validate <gate-id> pass|fail|waived <evidence>
//   done <task> | checkpoint C<n> <report> | render
// The root is HARNESS_ROOT if set (tests), otherwise the repository holding this file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STATE_FILE = 'docs/execution/state.json';
const SCHEMA_FILE = 'docs/execution/state.schema.json';
const PROGRESS_FILE = 'docs/execution/progress.md';
const GATES_FILE = 'docs/execution/gates.json';
const PLAN_INDEX_FILE = 'tools/harness/plan-index.json';

export const VALIDATION_GATES = [
  'V-HARNESS', 'V-CONNECTORS', 'V-SANDBOX', 'V-HELPERS',
  ...Array.from({ length: 15 }, (_, i) => `A${i + 1}`),
];
export const CHECKPOINTS = ['C0', 'C1', 'C2', 'C3', 'C4'];
const REVIEW_KINDS = ['spec', 'security', 'quality'];
const USAGE = [
  'usage: node tools/harness/state.mjs <command>',
  '  show',
  '  start <task>',
  '  commit <task> <hash>',
  '  review <task> spec|security|quality pass|fail <report-path>',
  '  block <task> "<text>"',
  '  unblock <task>',
  '  validate <gate-id> pass|fail|waived <evidence-path>',
  '  done <task>',
  '  checkpoint C<n> <report-path>',
  '  render',
].join('\n');

class Refusal extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}
const usage = (message) => new Refusal(`${message}\n${USAGE}`, 64);

export function defaultRoot() {
  return process.env.HARNESS_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
}

// ---------------------------------------------------------------------------
// A small JSON Schema validator for the subset state.schema.json uses.

export function validateAgainstSchema(schema, data) {
  const errors = [];
  const resolve = (s) => {
    if (s && s.$ref) {
      const name = /^#\/\$defs\/(.+)$/.exec(s.$ref)?.[1];
      if (!name || !schema.$defs?.[name]) throw new Error(`unsupported $ref ${s.$ref}`);
      return resolve(schema.$defs[name]);
    }
    return s;
  };
  const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
  const typeMatches = (v, t) => typeOf(v) === t || (t === 'number' && typeof v === 'number');
  const walk = (raw, value, where) => {
    const s = resolve(raw);
    const at = where || '(root)';
    if ('const' in s && value !== s.const) { errors.push(`${at}: must be ${JSON.stringify(s.const)}`); return; }
    if (s.enum && !s.enum.includes(value)) { errors.push(`${at}: must be one of ${s.enum.join(', ')}`); return; }
    if (s.type) {
      const types = Array.isArray(s.type) ? s.type : [s.type];
      if (!types.some((t) => typeMatches(value, t))) { errors.push(`${at}: must be of type ${types.join(' or ')}`); return; }
    }
    if (typeof value === 'string') {
      if (s.minLength !== undefined && value.length < s.minLength) errors.push(`${at}: is too short`);
      if (s.pattern && !new RegExp(s.pattern).test(value)) errors.push(`${at}: does not match ${s.pattern}`);
    }
    if (typeof value === 'number') {
      if (s.minimum !== undefined && value < s.minimum) errors.push(`${at}: is below ${s.minimum}`);
      if (s.maximum !== undefined && value > s.maximum) errors.push(`${at}: is above ${s.maximum}`);
    }
    if (Array.isArray(value)) {
      if (s.minItems !== undefined && value.length < s.minItems) errors.push(`${at}: has fewer than ${s.minItems} items`);
      if (s.maxItems !== undefined && value.length > s.maxItems) errors.push(`${at}: has more than ${s.maxItems} items`);
      if (s.items) value.forEach((item, i) => walk(s.items, item, `${where}[${i}]`));
    }
    if (typeOf(value) === 'object') {
      for (const key of s.required ?? []) if (!(key in value)) errors.push(`${at}: missing required property ${key}`);
      for (const [key, v] of Object.entries(value)) {
        const child = where ? `${where}.${key}` : key;
        if (s.properties && key in s.properties) { walk(s.properties[key], v, child); continue; }
        const pattern = Object.keys(s.patternProperties ?? {}).find((p) => new RegExp(p).test(key));
        if (pattern) { walk(s.patternProperties[pattern], v, child); continue; }
        if (s.additionalProperties === false) errors.push(`${at}: unexpected property ${key}`);
      }
    }
  };
  walk(schema, data, '');
  return errors;
}

// ---------------------------------------------------------------------------
// State

export function initialState(planIndex, branch, at = new Date().toISOString()) {
  return {
    schemaVersion: 1,
    updatedAt: at,
    branch,
    tasks: planIndex.map((t) => ({
      id: t.id, status: 'pending', commits: [], reviews: {}, gatesUsed: [], blockers: [], notes: '',
    })),
    validationGates: Object.fromEntries(VALIDATION_GATES.map((g) => [g, { status: 'pending', evidence: null, at: null }])),
    checkpoints: Object.fromEntries(CHECKPOINTS.map((c) => [c, { status: 'pending', report: null, at: null, approvedByEinar: false }])),
  };
}

const readJson = (root, rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));

function load(root) {
  const planIndex = readJson(root, PLAN_INDEX_FILE);
  const schema = readJson(root, SCHEMA_FILE);
  const state = readJson(root, STATE_FILE);
  const errors = validateAgainstSchema(schema, state);
  const ids = state.tasks?.map((t) => t.id).join(',');
  if (ids !== planIndex.map((t) => t.id).join(',')) errors.push('tasks: ids and order must match plan-index.json');
  if (errors.length) throw new Refusal(`${STATE_FILE} is invalid:\n  ${errors.join('\n  ')}`, 65);
  return { planIndex, schema, state };
}

function save(root, ctx, now) {
  ctx.state.updatedAt = now;
  const errors = validateAgainstSchema(ctx.schema, ctx.state);
  if (errors.length) throw new Refusal(`refusing to write an invalid state:\n  ${errors.join('\n  ')}`, 70);
  fs.writeFileSync(path.join(root, STATE_FILE), `${JSON.stringify(ctx.state, null, 2)}\n`);
  fs.writeFileSync(path.join(root, PROGRESS_FILE), renderProgress(ctx.state, ctx.planIndex));
}

function readGates(root) {
  try {
    const g = readJson(root, GATES_FILE);
    return g && typeof g.gates === 'object' && g.gates ? g.gates : null;
  } catch {
    return null;
  }
}

function taskArg(ctx, value) {
  if (!/^\d+$/.test(value ?? '')) throw usage(`expected a task number, got ${value ?? '(none)'}`);
  const id = Number(value);
  const index = ctx.planIndex.findIndex((t) => t.id === id);
  if (index < 0) throw usage(`Task ${id} is not in the plan`);
  return { id, index, plan: ctx.planIndex[index], task: ctx.state.tasks[index] };
}

function existingFile(root, rel, what) {
  if (!rel) throw usage(`expected a ${what} path`);
  if (!fs.existsSync(path.resolve(root, rel))) throw new Refusal(`${what} ${rel} does not exist`);
  return rel;
}

const openBlockers = (task) => task.blockers.filter((b) => !b.resolvedAt);

function nextTask(ctx) {
  const i = ctx.state.tasks.findIndex((t) => t.status !== 'done');
  return i < 0 ? null : { plan: ctx.planIndex[i], task: ctx.state.tasks[i] };
}

// ---------------------------------------------------------------------------
// Rendering

const cell = (s) => String(s).replace(/\|/g, '\\|');

function reviewSummary(task) {
  const parts = REVIEW_KINDS.filter((k) => task.reviews[k]).map((k) => `${k} ${task.reviews[k].status} (${task.reviews[k].round})`);
  return parts.length ? parts.join(', ') : '—';
}

export function renderProgress(state, planIndex) {
  const next = state.tasks.find((t) => t.status !== 'done');
  const nextPlan = next && planIndex.find((p) => p.id === next.id);
  const lines = [
    '# Execution progress',
    '',
    '> Generated by `node tools/harness/state.mjs render` from `docs/execution/state.json`, which is authoritative. Do not edit by hand.',
    '',
    `Branch: \`${state.branch}\` · Updated: ${state.updatedAt} · Next task: ${nextPlan ? `**${nextPlan.id}** ${nextPlan.title}` : 'none (all done)'}`,
    '',
    '## Tasks (execution order)',
    '',
    '| # | Task | Phase | Sensitive | Status | Commits | Reviews | Required gates | Checkpoint after |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  state.tasks.forEach((t, i) => {
    const p = planIndex[i];
    const commits = t.commits.length ? t.commits.map((c) => `\`${c.slice(0, 7)}\``).join(' ') : '—';
    lines.push(`| ${t.id} | ${cell(p.title)} | ${p.phase} | ${p.sensitive ? 'yes' : 'no'} | ${t.status} | ${commits} | ${reviewSummary(t)} | ${p.requiredGates.join(' ')} | ${p.checkpointAfter ?? '—'} |`);
  });
  lines.push('', '## Open blockers', '');
  const blockers = state.tasks.flatMap((t) => openBlockers(t).map((b) => `- Task ${t.id} (since ${b.at}): ${b.text}`));
  lines.push(...(blockers.length ? blockers : ['None.']));
  lines.push('', '## Validation gates', '', '| Gate | Status | Evidence | At |', '|---|---|---|---|');
  for (const [id, g] of Object.entries(state.validationGates)) {
    lines.push(`| ${id} | ${g.status} | ${g.evidence ? cell(g.evidence) : '—'} | ${g.at ?? '—'} |`);
  }
  lines.push('', '## Checkpoints', '', '| Checkpoint | After task | Status | Report | Approved by Einar |', '|---|---|---|---|---|');
  for (const [id, c] of Object.entries(state.checkpoints)) {
    const after = planIndex.find((p) => p.checkpointAfter === id)?.id ?? '—';
    lines.push(`| ${id} | ${after} | ${c.status} | ${c.report ? cell(c.report) : '—'} | ${c.approvedByEinar ? 'yes' : 'no'} |`);
  }
  return `${lines.join('\n')}\n`;
}

function renderShow(ctx, root) {
  const next = nextTask(ctx);
  const gates = readGates(root);
  const out = [
    `Branch: ${ctx.state.branch} · updated ${ctx.state.updatedAt}`,
    next ? `Next task: ${next.plan.id} — ${next.plan.title} (${next.task.status})` : 'Next task: none (all tasks done)',
    '',
    'Tasks:',
    ...ctx.state.tasks.map((t, i) => `  ${String(t.id).padStart(2)}  ${t.status.padEnd(11)} ${ctx.planIndex[i].title}`),
    '',
  ];
  const blockers = ctx.state.tasks.flatMap((t) => openBlockers(t).map((b) => `  Task ${t.id}: ${b.text}`));
  out.push(blockers.length ? 'Open blockers:' : 'Open blockers: none', ...blockers);
  out.push(gates
    ? `Gates: ${Object.entries(gates).map(([id, g]) => `${id} ${g.status}`).join(', ')}`
    : 'Gates: gates.json unreadable');
  out.push(`Validation gates: ${Object.entries(ctx.state.validationGates).map(([id, g]) => `${id} ${g.status}`).join(', ')}`);
  out.push(`Checkpoints: ${Object.entries(ctx.state.checkpoints).map(([id, c]) => `${id} ${c.status}`).join(', ')}`);
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Commands

function cmdStart(ctx, root, args, now) {
  const t = taskArg(ctx, args[0]);
  const blocked = ctx.state.tasks.find((x) => openBlockers(x).length);
  if (blocked) throw new Refusal(`Task ${blocked.id} has an open blocker: ${openBlockers(blocked)[0].text}`);
  if (t.task.status !== 'pending') throw new Refusal(`Task ${t.id} is already ${t.task.status}`);
  if (t.index > 0) {
    const prev = ctx.state.tasks[t.index - 1];
    if (prev.status !== 'done') throw new Refusal(`Task ${prev.id} (previous in execution order) is not done`);
  }
  const gates = readGates(root);
  if (!gates) throw new Refusal(`${GATES_FILE} could not be read`);
  const missing = t.plan.requiredGates.filter((g) => gates[g]?.status !== 'approved');
  if (missing.length) throw new Refusal(`Task ${t.id} needs ${missing.join(', ')}, not approved in ${GATES_FILE}`);
  Object.assign(t.task, { status: 'in_progress', startedAt: now, gatesUsed: [...t.plan.requiredGates] });
  return `Task ${t.id} started: ${t.plan.title}`;
}

const ACTIVE = ['in_progress', 'in_review', 'blocked'];

function cmdCommit(ctx, root, args) {
  const t = taskArg(ctx, args[0]);
  const hash = args[1] ?? '';
  if (!/^[0-9a-f]{7,40}$/.test(hash)) throw usage(`expected a commit hash, got ${hash || '(none)'}`);
  if (!ACTIVE.includes(t.task.status)) throw new Refusal(`Task ${t.id} is ${t.task.status}; start it first`);
  if (!t.task.commits.includes(hash)) t.task.commits.push(hash);
  return `Task ${t.id}: recorded commit ${hash}`;
}

function cmdReview(ctx, root, args, now) {
  const t = taskArg(ctx, args[0]);
  const [, kind, result, report] = args;
  if (!REVIEW_KINDS.includes(kind)) throw usage(`review kind must be spec, security or quality, got ${kind ?? '(none)'}`);
  if (result !== 'pass' && result !== 'fail') throw usage(`review result must be pass or fail, got ${result ?? '(none)'}`);
  existingFile(root, report, 'report');
  if (!ACTIVE.includes(t.task.status)) throw new Refusal(`Task ${t.id} is ${t.task.status}; reviews are recorded on an active task`);
  const round = (t.task.reviews[kind]?.round ?? 0) + 1;
  t.task.reviews[kind] = { status: result, round, report, at: now };
  if (t.task.status === 'in_progress') t.task.status = 'in_review';
  return `Task ${t.id}: ${kind} review round ${round} ${result}`;
}

function cmdBlock(ctx, root, args, now) {
  const t = taskArg(ctx, args[0]);
  const text = args.slice(1).join(' ').trim();
  if (!text) throw usage('expected a blocker text');
  t.task.blockers.push({ text, at: now, previousStatus: t.task.status, resolvedAt: null });
  t.task.status = 'blocked';
  return `Task ${t.id} blocked: ${text}`;
}

function cmdUnblock(ctx, root, args, now) {
  const t = taskArg(ctx, args[0]);
  const open = openBlockers(t.task);
  if (!open.length) throw new Refusal(`Task ${t.id} has no open blocker`);
  for (const b of open) b.resolvedAt = now;
  t.task.status = open[0].previousStatus;
  return `Task ${t.id} unblocked (${t.task.status})`;
}

function cmdValidate(ctx, root, args, now) {
  const [gate, result, evidence] = args;
  if (!VALIDATION_GATES.includes(gate)) throw usage(`unknown validation gate ${gate ?? '(none)'}`);
  if (!['pass', 'fail', 'waived'].includes(result)) throw usage(`result must be pass, fail or waived, got ${result ?? '(none)'}`);
  existingFile(root, evidence, 'evidence');
  ctx.state.validationGates[gate] = { status: result, evidence, at: now };
  return `${gate}: ${result}`;
}

function cmdDone(ctx, root, args, now) {
  const t = taskArg(ctx, args[0]);
  if (t.task.status !== 'in_progress' && t.task.status !== 'in_review') {
    throw new Refusal(`Task ${t.id} is ${t.task.status}; only an active task can be marked done`);
  }
  const missing = [];
  if (openBlockers(t.task).length) missing.push('an open blocker must be resolved');
  if (!t.task.commits.length) missing.push('at least one commit');
  if (t.task.reviews.spec?.status !== 'pass') missing.push('a passing spec review');
  if (t.plan.sensitive && t.task.reviews.security?.status !== 'pass') missing.push('a passing security review (security-sensitive task)');
  if (t.task.reviews.quality?.status !== 'pass') missing.push('a passing quality review');
  if (missing.length) throw new Refusal(`Task ${t.id} cannot be marked done; it needs: ${missing.join('; ')}`);
  Object.assign(t.task, { status: 'done', doneAt: now });
  return `Task ${t.id} done: ${t.plan.title}`;
}

function cmdCheckpoint(ctx, root, args, now) {
  const [id, report] = args;
  if (!CHECKPOINTS.includes(id)) throw usage(`unknown checkpoint ${id ?? '(none)'}`);
  const last = ctx.planIndex.findIndex((p) => p.checkpointAfter === id);
  const notDone = ctx.state.tasks.slice(0, last + 1).find((t) => t.status !== 'done');
  if (notDone) throw new Refusal(`${id} needs every task up to Task ${ctx.planIndex[last].id} done; Task ${notDone.id} is ${notDone.status}`);
  existingFile(root, report, 'report');
  ctx.state.checkpoints[id] = { status: 'reported', report, at: now, approvedByEinar: false };
  return `${id} recorded: ${report}`;
}

const COMMANDS = {
  start: cmdStart,
  commit: cmdCommit,
  review: cmdReview,
  block: cmdBlock,
  unblock: cmdUnblock,
  validate: cmdValidate,
  done: cmdDone,
  checkpoint: cmdCheckpoint,
};

/** Run one command. Returns { code, stdout, stderr }; never exits the process. */
export function run(argv, { root = defaultRoot(), now = new Date().toISOString() } = {}) {
  const [command, ...args] = argv;
  try {
    if (!command) throw usage('missing command');
    if (command !== 'show' && command !== 'render' && !COMMANDS[command]) throw usage(`unknown command ${command}`);
    const ctx = load(root);
    if (command === 'show') return { code: 0, stdout: renderShow(ctx, root), stderr: '' };
    if (command === 'render') {
      fs.writeFileSync(path.join(root, PROGRESS_FILE), renderProgress(ctx.state, ctx.planIndex));
      return { code: 0, stdout: `wrote ${PROGRESS_FILE}`, stderr: '' };
    }
    const message = COMMANDS[command](ctx, root, args, now);
    save(root, ctx, now);
    return { code: 0, stdout: message, stderr: '' };
  } catch (error) {
    if (error instanceof Refusal) return { code: error.code, stdout: '', stderr: error.message };
    return { code: 70, stdout: '', stderr: `state.mjs: ${error.message}` };
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = run(process.argv.slice(2));
  if (result.stdout) console.log(result.stdout);
  if (result.stderr) console.error(result.stderr);
  process.exitCode = result.code;
}
