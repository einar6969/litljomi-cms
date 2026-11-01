// Checks .claude/settings.json and the agent definitions against Task 0 of the plan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const settings = JSON.parse(fs.readFileSync(path.join(REPO, '.claude/settings.json'), 'utf8'));

const REQUIRED_DENY = [
  'Bash(git push *)', 'Bash(git remote *)', 'Bash(gh *)',
  'Bash(vercel *)', 'Bash(netlify *)',
  'Bash(supabase link *)', 'Bash(supabase login *)', 'Bash(supabase db push *)', 'Bash(supabase projects *)',
  'Bash(supabase orgs *)', 'Bash(supabase secrets *)', 'Bash(supabase functions deploy *)',
  'Bash(brew *)', 'Bash(sudo *)', 'Bash(npx *)', 'Bash(pnpm dlx *)',
  'Bash(npm publish *)', 'Bash(pnpm publish *)', 'Bash(npm login *)',
  'Bash(curl *)', 'Bash(wget *)', 'Bash(ssh *)', 'Bash(scp *)', 'Bash(rsync *)', 'Bash(open *)', 'Bash(osascript *)',
  'Edit(/.claude/**)', 'Edit(/.git/**)', 'Edit(/docs/execution/gates.json)', 'Edit(/docs/execution/harness.lock.json)',
  'Read(/.env)', 'Read(/.env.local)', 'Read(/**/.env)', 'Read(/**/.env.local)',
  'Artifact', 'ArtifactData', 'ArtifactComments', 'Workflow', 'RemoteTrigger', 'CronCreate',
];

// Hosted-connector and browser servers observed on 2026-11-01 (refreshed by the Step 8 audit).
const MCP_SERVERS = [
  '0fe604fe-ed82-4eb7-a43a-34991a4d4f23', '1a59c906-04da-521d-bda7-7f71b9f9e01c',
  '35b3e7e2-5bdb-4333-a6ff-4932545dab96', '4bae418f-4ec2-45ec-94b6-1c5962a4d491',
  '622b912c-3d4e-4f24-84fb-f62832063ee0', '6b6ca7cf-c3c1-408b-9857-02ff8e597b84',
  'e309aff3-5e46-45b2-a31c-43c319a73036', 'claude-in-chrome', 'Claude_Browser', 'playwright',
  'Claude_Code_iOS_Simulator', 'terminal', 'scheduled-tasks', 'mcp-registry', 'visualize',
  'ccd_session', 'ccd_session_mgmt', 'ccd_settings', 'ccd_connectors', 'ccd_directory', 'ccd_host',
  'ccd_pr', 'ccd_window', 'ccd_sidebar', 'ccd_view',
];

const ALLOW = [
  'Bash(node --test *)', 'Bash(node tools/harness/state.mjs *)', 'Bash(node tools/harness/integrity.mjs)',
  'Bash(git status*)', 'Bash(git diff*)', 'Bash(git log*)', 'Bash(git show*)', 'Bash(git add *)', 'Bash(git commit *)',
];

test('has only the planned top-level keys', () => {
  assert.deepEqual(Object.keys(settings).sort(), ['hooks', 'permissions', 'sandbox']);
  assert.deepEqual(Object.keys(settings.permissions).sort(), ['allow', 'deny', 'disableBypassPermissionsMode']);
});

test('bypass-permissions mode is disabled', () => {
  assert.equal(settings.permissions.disableBypassPermissionsMode, 'disable');
});

test('every planned deny entry is present', () => {
  for (const rule of REQUIRED_DENY) assert.ok(settings.permissions.deny.includes(rule), `deny ${rule}`);
});

test('every audited MCP server is denied, and the task list (ccd_turn) is not', () => {
  for (const server of MCP_SERVERS) {
    assert.ok(settings.permissions.deny.includes(`mcp__${server}__*`), `deny mcp__${server}__*`);
  }
  assert.ok(!settings.permissions.deny.some((r) => r.startsWith('mcp__ccd_turn')));
  const mcp = settings.permissions.deny.filter((r) => r.startsWith('mcp__'));
  assert.equal(mcp.length, MCP_SERVERS.length);
  assert.equal(settings.permissions.deny.length, REQUIRED_DENY.length + MCP_SERVERS.length);
});

test('the allow list is exactly the planned one', () => {
  assert.deepEqual(settings.permissions.allow, ALLOW);
});

test('both hooks are configured', () => {
  const pre = settings.hooks.PreToolUse;
  assert.equal(pre.length, 1);
  assert.equal(pre[0].matcher, '*');
  assert.deepEqual(pre[0].hooks, [
    { type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/guard.mjs"', timeout: 10 },
  ]);
  const start = settings.hooks.SessionStart;
  assert.equal(start.length, 1);
  assert.deepEqual(start[0].hooks, [
    { type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.mjs"', timeout: 10 },
  ]);
  assert.deepEqual(Object.keys(settings.hooks).sort(), ['PreToolUse', 'SessionStart']);
});

test('the sandbox is enabled, fails closed and allows only the npm registry', () => {
  assert.deepEqual(settings.sandbox, {
    enabled: true,
    failIfUnavailable: true,
    allowUnsandboxedCommands: false,
    network: { allowedDomains: ['registry.npmjs.org'] },
    excludedCommands: [],
  });
});

test('the test entry point (tools/harness/index.js) imports every test file', () => {
  const entry = fs.readFileSync(path.join(REPO, 'tools/harness/index.js'), 'utf8');
  const listed = JSON.parse(/const files = (\[[^\]]*\])/.exec(entry)[1].replace(/'/g, '"'));
  const actual = fs
    .readdirSync(path.join(REPO, 'tools/harness/__tests__'))
    .filter((f) => f.endsWith('.test.mjs'))
    .map((f) => f.replace(/\.test\.mjs$/, ''))
    .sort();
  assert.deepEqual([...listed].sort(), actual);
});

function frontmatter(file) {
  const text = fs.readFileSync(path.join(REPO, '.claude/agents', file), 'utf8');
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  assert.ok(m, `${file} has YAML frontmatter`);
  const fields = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) fields[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { fields, body: m[2] };
}

test('the four agent definitions match the plan', () => {
  const expected = {
    'cms-implementer.md': { tools: 'Read, Edit, Write, Bash, Grep, Glob', model: 'inherit' },
    'cms-spec-reviewer.md': { tools: 'Read, Grep, Glob, Bash', model: 'sonnet' },
    'cms-security-reviewer.md': { tools: 'Read, Grep, Glob, Bash', model: 'opus' },
    'cms-quality-reviewer.md': { tools: 'Read, Grep, Glob, Bash', model: 'sonnet' },
  };
  assert.deepEqual(fs.readdirSync(path.join(REPO, '.claude/agents')).sort(), Object.keys(expected).sort());
  for (const [file, want] of Object.entries(expected)) {
    const { fields, body } = frontmatter(file);
    assert.equal(fields.name, file.replace(/\.md$/, ''));
    assert.ok(fields.description && fields.description.length > 10);
    assert.equal(fields.tools, want.tools);
    assert.equal(fields.model, want.model);
    assert.match(body, /no authority over (the )?gates/i, `${file} disclaims gate authority`);
    assert.match(body, /guard denial/i, `${file} covers guard denials`);
    if (file !== 'cms-implementer.md') assert.match(body, /must not modify/i, `${file} is read-only`);
  }
  const security = frontmatter('cms-security-reviewer.md').body;
  for (let i = 1; i <= 14; i++) assert.match(security, new RegExp(`^${i}\\. `, 'm'), `checklist item ${i}`);
});
