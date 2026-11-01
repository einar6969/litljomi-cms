// Guard library for the PreToolUse hook (Task 0). Pure decision logic plus small path helpers.
// Defence in depth: a heuristic shell reader, not a shell parser. The gates, the reviews and
// Einar's approvals remain the real controls.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const LABAK_REPO_PATH =
  '/Users/einarzoega/Documents/Litljómi ehf/Projects/2026/LAW Takeover/LABAK/landssamband-bakarameistara';
export const REPO_SLUG = 'einar6969/litljomi-cms';

// Protected paths, relative to the repository root, compared in lower case.
export const PROTECTED_DIRS = ['.claude'];
export const PROTECTED_FILES = [
  'tools/harness/guard-lib.mjs',
  'tools/harness/gate.mjs',
  'tools/harness/integrity.mjs',
  'tools/harness/plan-index.json',
  'docs/execution/gates.json',
  'docs/execution/harness.lock.json',
];

const READ_ONLY_TOOLS = new Set(['Read', 'Grep', 'Glob']);
const WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);
const DENIED_TOOLS = new Set(['Workflow', 'RemoteTrigger', 'CronCreate']);
const ALLOWED_AGENTS = new Set([
  'cms-implementer',
  'cms-spec-reviewer',
  'cms-security-reviewer',
  'cms-quality-reviewer',
  'Explore',
]);
const REVIEWERS = new Set(['cms-spec-reviewer', 'cms-security-reviewer', 'cms-quality-reviewer']);

const WRAPPERS = new Set(['env', 'timeout', 'time', 'nice', 'nohup', 'stdbuf', 'command', 'builtin', 'exec']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash']);
const SYSTEM_PROGRAMS = new Set([
  'brew', 'port', 'sudo', 'su', 'softwareupdate', 'installer', 'launchctl', 'defaults',
  'osascript', 'open', 'security', 'scutil', 'networksetup', 'crontab',
]);
const NETWORK_PROGRAMS = new Set(['curl', 'wget', 'http', 'https', 'nc', 'ssh', 'scp', 'sftp', 'rsync', 'telnet']);
const HOSTING_PROGRAMS = new Set(['vercel', 'netlify', 'wrangler', 'flyctl', 'heroku']);
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn']);
const PACKAGE_DENIED_SUBCOMMANDS = new Set(['dlx', 'publish', 'login', 'adduser', 'token', 'owner', 'dist-tag']);
const CONTAINER_PROGRAMS = new Set(['docker', 'orb', 'orbctl']);
const DANGEROUS_CODE = /child_process|execSync|spawn|subprocess|os\.system/;
const SUBST = '$__subst__';

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const WRITE_REDIRECTS = new Set(['>', '>>', '>|', '&>', '&>>', '<>']);

// ---------------------------------------------------------------------------
// Results

const allow = () => ({ decision: 'allow' });
const deny = (rule, reason) => ({ decision: 'deny', rule, reason });

// ---------------------------------------------------------------------------
// Splitting a command line into simple commands

/**
 * Split a command line into simple commands. Splits on && || ; | |& & and newlines, and
 * descends into $(…), backticks, <(…), (…) subshells and { …; } groups. Quotes are respected,
 * comments and here-document bodies are skipped. Returns segment strings.
 */
export function splitCommands(cmd) {
  return splitWithOps(cmd).map((s) => s.text);
}

/** Like splitCommands, but each segment also says whether a pipe feeds it. */
export function splitWithOps(cmd) {
  const out = [];
  parseSequence(String(cmd ?? ''), 0, null, out);
  return out;
}

function parseSequence(src, start, stop, out) {
  let cur = '';
  let op = null;
  let heredocs = [];
  let i = start;
  const flush = (nextOp) => {
    const text = cur.trim();
    if (text) out.push({ text, afterPipe: op === '|' || op === '|&' });
    cur = '';
    op = nextOp;
  };
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (stop === ')' && c === ')') { flush(null); return i + 1; }
    if (stop === '`' && c === '`') { flush(null); return i + 1; }
    if (stop === '}' && c === '}' && cur.trim() === '') { flush(null); return i + 1; }
    if (c === '\\') {
      if (next === '\n') { i += 2; continue; }
      cur += src.slice(i, i + 2); i += 2; continue;
    }
    if (c === "'") {
      const j = src.indexOf("'", i + 1);
      const end = j < 0 ? src.length : j + 1;
      cur += src.slice(i, end); i = end; continue;
    }
    if (c === '"') {
      const r = scanDoubleQuoted(src, i, out);
      cur += r.text; i = r.end; continue;
    }
    if (c === '#' && (cur === '' || /\s$/.test(cur))) {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if ((c === '$' || c === '<' || c === '>') && next === '(') {
      i = parseSequence(src, i + 2, ')', out); cur += SUBST; continue;
    }
    if (c === '`') {
      i = parseSequence(src, i + 1, '`', out); cur += SUBST; continue;
    }
    if (c === '(' && cur.trim() === '') {
      i = parseSequence(src, i + 1, ')', out); continue;
    }
    if (c === '{' && cur.trim() === '' && /\s/.test(next ?? '')) {
      i = parseSequence(src, i + 1, '}', out); continue;
    }
    if (c === '<' && next === '<' && src[i + 2] !== '<') {
      const m = /^<<(-?)[ \t]*(['"]?)([^\s'"();|&<>]+)\2/.exec(src.slice(i));
      if (m) {
        heredocs.push({ delimiter: m[3], stripTabs: m[1] === '-', quoted: m[2] !== '' });
        cur += m[0]; i += m[0].length; continue;
      }
    }
    if (c === '\n') {
      flush('\n'); i++;
      if (heredocs.length) { i = skipHeredocs(src, i, heredocs, out); heredocs = []; }
      continue;
    }
    if (c === '&' && next === '&') { flush('&&'); i += 2; continue; }
    if (c === '|' && next === '|') { flush('||'); i += 2; continue; }
    if (c === '|' && next === '&') { flush('|&'); i += 2; continue; }
    if (c === '|') {
      if (cur.endsWith('>')) { cur += c; i++; continue; }
      flush('|'); i++; continue;
    }
    if (c === ';') { flush(';'); i++; continue; }
    if (c === '&') {
      if (cur.endsWith('>') || cur.endsWith('<') || next === '>') { cur += c; i++; continue; }
      flush('&'); i++; continue;
    }
    cur += c; i++;
  }
  flush(null);
  return i;
}

function scanDoubleQuoted(src, start, out) {
  let text = '"';
  let j = start + 1;
  while (j < src.length) {
    const ch = src[j];
    if (ch === '\\') { text += src.slice(j, j + 2); j += 2; continue; }
    if (ch === '"') { text += '"'; j++; break; }
    if (ch === '$' && src[j + 1] === '(') { j = parseSequence(src, j + 2, ')', out); text += SUBST; continue; }
    if (ch === '`') { j = parseSequence(src, j + 1, '`', out); text += SUBST; continue; }
    text += ch; j++;
  }
  return { text, end: j };
}

function skipHeredocs(src, start, heredocs, out) {
  let i = start;
  for (const doc of heredocs) {
    while (i < src.length) {
      let lineEnd = src.indexOf('\n', i);
      if (lineEnd < 0) lineEnd = src.length;
      let line = src.slice(i, lineEnd);
      if (doc.stripTabs) line = line.replace(/^\t+/, '');
      if (line === doc.delimiter) { i = lineEnd + 1; break; }
      if (!doc.quoted) {
        // Unquoted bodies still expand $(…) and backticks.
        let j = i;
        while (j < lineEnd) {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '$' && src[j + 1] === '(') { j = parseSequence(src, j + 2, ')', out); continue; }
          if (src[j] === '`') { j = parseSequence(src, j + 1, '`', out); continue; }
          j++;
        }
        if (j > lineEnd) { lineEnd = src.indexOf('\n', j - 1); if (lineEnd < 0) lineEnd = src.length; }
      }
      i = lineEnd + 1;
    }
  }
  return Math.min(i, src.length);
}

// ---------------------------------------------------------------------------
// Tokenizing one simple command

/** Split a simple command into words (quotes removed) and redirections. */
export function tokenize(text) {
  const words = [];
  const redirects = [];
  let cur = null;
  let pending = null;
  const end = () => {
    if (cur === null) return;
    if (pending) { redirects.push({ op: pending, target: cur }); pending = null; } else words.push(cur);
    cur = null;
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) { end(); i++; continue; }
    if (c === '\\') {
      if (text[i + 1] !== '\n') cur = (cur ?? '') + (text[i + 1] ?? '');
      i += 2; continue;
    }
    if (c === "'") {
      const j = text.indexOf("'", i + 1);
      const stop = j < 0 ? text.length : j;
      cur = (cur ?? '') + text.slice(i + 1, stop); i = stop + 1; continue;
    }
    if (c === '"') {
      let j = i + 1;
      let s = '';
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\' && '"\\$`\n'.includes(text[j + 1] ?? '')) { s += text[j + 1]; j += 2; continue; }
        s += text[j]; j++;
      }
      cur = (cur ?? '') + s; i = j + 1; continue;
    }
    if (c === '>' || c === '<' || (c === '&' && text[i + 1] === '>')) {
      if (cur !== null && /^\d+$/.test(cur) && !pending) cur = null; else end();
      const op = /^(&>>|&>|>>|>\||>&|<<<|<<-|<<|<&|<>|>|<)/.exec(text.slice(i))[1];
      pending = op; i += op.length; continue;
    }
    cur = (cur ?? '') + c; i++;
  }
  end();
  return { words, redirects };
}

function stripOptions(rest, valueOptions = new Set(), keepGoing = () => false) {
  let k = 0;
  while (k < rest.length) {
    const a = rest[k];
    if (a === '--') { k++; break; }
    if (valueOptions.has(a)) { k += 2; continue; }
    if (a.startsWith('-') && a !== '-') { k++; continue; }
    if (keepGoing(a)) { k++; continue; }
    break;
  }
  return rest.slice(k);
}

function stripWrapper(program, rest) {
  switch (program) {
    case 'env': {
      let k = 0;
      while (k < rest.length) {
        const a = rest[k];
        if (a === '-S' || a === '--split-string') return [...tokenize(rest[k + 1] ?? '').words, ...rest.slice(k + 2)];
        if (a.startsWith('--split-string=')) return [...tokenize(a.slice(15)).words, ...rest.slice(k + 1)];
        if (/^-S./.test(a)) return [...tokenize(a.slice(2)).words, ...rest.slice(k + 1)];
        if (['-u', '-C', '--unset', '--chdir'].includes(a)) { k += 2; continue; }
        if (a === '--') { k++; break; }
        if ((a.startsWith('-') && a !== '-') || a === '-' || ASSIGNMENT.test(a)) { k++; continue; }
        break;
      }
      return rest.slice(k);
    }
    case 'timeout': {
      const after = stripOptions(rest, new Set(['-s', '-k', '--signal', '--kill-after']));
      return after.slice(1);
    }
    case 'nice':
      return stripOptions(rest, new Set(['-n', '--adjustment']));
    case 'stdbuf':
      return stripOptions(rest, new Set(['-i', '-o', '-e', '--input', '--output', '--error']));
    case 'exec':
      return stripOptions(rest, new Set(['-a']));
    default:
      return stripOptions(rest);
  }
}

/**
 * Normalize one simple command: strip leading VAR=value assignments and the wrappers
 * env, timeout, time, nice, nohup, stdbuf, command, builtin and exec, and reduce the
 * program path to its basename.
 */
export function normalize(segment) {
  const { words, redirects } = tokenize(segment);
  let argv = words.slice();
  for (;;) {
    while (argv.length && ASSIGNMENT.test(argv[0])) argv.shift();
    if (!argv.length) break;
    const program = path.posix.basename(argv[0]);
    if (!WRAPPERS.has(program)) break;
    argv = stripWrapper(program, argv.slice(1));
  }
  if (argv.length) argv[0] = path.posix.basename(argv[0]);
  return { argv, program: argv[0] ?? '', redirects };
}

function shellQuote(word) {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}

function inlineScriptsDetailed(argv) {
  const program = argv[0] ?? '';
  const args = argv.slice(1);
  const out = [];
  const takeAfter = (isFlag, kind) => {
    for (let k = 0; k < args.length; k++) {
      const a = args[k];
      if (isFlag(a) && args[k + 1] !== undefined) { out.push({ kind, text: args[k + 1] }); k++; }
    }
  };
  if (SHELLS.has(program)) {
    for (let k = 0; k < args.length; k++) {
      const a = args[k];
      if (a === '-o' || a === '+o') { k++; continue; }
      if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(a)) {
        if (args[k + 1] !== undefined) out.push({ kind: 'shell', text: args[k + 1] });
        break;
      }
      if (!a.startsWith('-') && !a.startsWith('+')) break;
    }
  } else if (program === 'eval') {
    if (args.length) out.push({ kind: 'shell', text: args.join(' ') });
  } else if (program === 'xargs') {
    const values = new Set(['-I', '-n', '-P', '-L', '-l', '-s', '-d', '-E', '-e', '-a',
      '--max-args', '--max-procs', '--max-lines', '--max-chars', '--delimiter', '--arg-file', '--replace']);
    const rest = stripOptions(args, values);
    if (rest.length) out.push({ kind: 'shell', text: rest.map(shellQuote).join(' ') });
  } else if (program === 'node') {
    for (let k = 0; k < args.length; k++) {
      const a = args[k];
      const m = /^--(eval|print)=([\s\S]*)$/.exec(a);
      if (m) { out.push({ kind: 'code', text: m[2] }); continue; }
      if (['-e', '--eval', '-p', '--print', '-pe', '-ep'].includes(a) && args[k + 1] !== undefined) {
        out.push({ kind: 'code', text: args[k + 1] }); k++;
      }
    }
  } else if (/^python(\d+(\.\d+)?)?$/.test(program)) {
    takeAfter((a) => /^-[a-zA-Z]*c$/.test(a), 'code');
  } else if (program === 'perl') {
    takeAfter((a) => /^-[a-zA-Z]*[eE]$/.test(a), 'code');
  } else if (program === 'ruby') {
    takeAfter((a) => /^-[a-zA-Z]*e$/.test(a), 'code');
  } else if (program === 'osascript') {
    takeAfter((a) => a === '-e', 'code');
  }
  return out;
}

/**
 * Script text carried inline by sh|bash|zsh|dash -c, eval, xargs, node -e|--eval|-p,
 * python3 -c, perl -e, ruby -e and osascript -e.
 */
export function inlineScripts(argv) {
  return inlineScriptsDetailed(argv).map((s) => s.text);
}

// ---------------------------------------------------------------------------
// Paths

const nfc = (s) => String(s).normalize('NFC');

/** Resolve a path, following symlinks for the part that exists. */
export function realResolve(p) {
  let cur = path.resolve(p);
  const tail = [];
  while (!fs.existsSync(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) break;
    tail.unshift(path.basename(cur));
    cur = parent;
  }
  try { cur = fs.realpathSync(cur); } catch { /* keep the lexical path */ }
  return nfc(path.join(cur, ...tail));
}

function expandHome(token, cwd) {
  const home = os.homedir();
  if (token === '~') return home;
  if (token.startsWith('~/')) return path.join(home, token.slice(2));
  return token
    .replace(/^\$\{?HOME\}?(?=\/|$)/, home)
    .replace(/^\$\{?PWD\}?(?=\/|$)/, cwd);
}

function resolveToken(token, cwd) {
  return realResolve(path.resolve(cwd, expandHome(token, cwd)));
}

function isWithin(child, parent) {
  const rel = path.relative(nfc(parent).toLowerCase(), nfc(child).toLowerCase());
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/** Path relative to the repository root, in lower case with '/' separators, or null if outside. */
function repoRelative(abs, ctx) {
  const root = realResolve(ctx.repoRoot);
  if (!isWithin(abs, root)) return null;
  return path.relative(root.toLowerCase(), nfc(abs).toLowerCase()).split(path.sep).join('/');
}

export function isProtectedRel(rel) {
  if (rel === null) return false;
  const r = rel.toLowerCase();
  return PROTECTED_DIRS.some((d) => r === d || r.startsWith(`${d}/`)) || PROTECTED_FILES.includes(r);
}

function isAncestorOfProtected(rel) {
  if (rel === '') return true;
  return [...PROTECTED_DIRS, ...PROTECTED_FILES].some((p) => p.startsWith(`${rel}/`));
}

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '[') {
      const j = glob.indexOf(']', i + 1);
      if (j < 0) re += '\\[';
      else { re += `[${glob.slice(i + 1, j).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`; i = j; }
    } else re += c.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

function protectedCandidates(withAncestors) {
  const set = new Set([...PROTECTED_DIRS, ...PROTECTED_FILES]);
  if (withAncestors) {
    for (const p of PROTECTED_FILES) {
      const parts = p.split('/');
      for (let n = 1; n < parts.length; n++) set.add(parts.slice(0, n).join('/'));
    }
  }
  return [...set];
}

/** Does this command argument name a protected path (or, with ancestors, a directory holding one)? */
function namesProtected(token, cwd, ctx, { ancestors }) {
  const rel = repoRelative(resolveToken(token, cwd), ctx);
  if (rel === null) return false;
  if (/[*?[]/.test(rel)) {
    const literal = rel.split(/[*?[]/)[0];
    if (PROTECTED_DIRS.some((d) => literal.startsWith(`${d}/`))) return true;
    const re = globToRegExp(rel);
    return protectedCandidates(ancestors).some((c) => re.test(c));
  }
  return isProtectedRel(rel) || (ancestors && isAncestorOfProtected(rel));
}

// ---------------------------------------------------------------------------
// Gates

function gatesValid(gates) {
  return Boolean(gates && typeof gates === 'object' && gates.gates && typeof gates.gates === 'object' && !Array.isArray(gates.gates));
}
const approved = (ctx, id) => ctx.gates.gates[id]?.status === 'approved';
const gateParam = (ctx, id, key) => {
  const v = ctx.gates.gates[id]?.params?.[key];
  return typeof v === 'string' && v !== '' ? v : null;
};

// ---------------------------------------------------------------------------
// Argument helpers

function positionals(args, valueOptions = new Set()) {
  const out = [];
  let dashes = false;
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (dashes) { out.push(a); continue; }
    if (a === '--') { dashes = true; continue; }
    if (a.startsWith('-') && a !== '-') { if (valueOptions.has(a)) k++; continue; }
    out.push(a);
  }
  return out;
}

/** Values of an option given as `--name value`, `--name=value` or a short alias. */
function optionValues(args, names) {
  const values = [];
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (names.includes(a)) { values.push(args[k + 1] ?? ''); k++; continue; }
    for (const n of names) if (n.startsWith('--') && a.startsWith(`${n}=`)) values.push(a.slice(n.length + 1));
  }
  return values;
}

/** Argument values that may be paths: positionals plus the right-hand side of --opt=value. */
function pathArguments(args) {
  const out = [];
  let dashes = false;
  for (const a of args) {
    if (dashes) { out.push(a); continue; }
    if (a === '--') { dashes = true; continue; }
    if (a.startsWith('-') && a !== '-') { const i = a.indexOf('='); if (i > 0) out.push(a.slice(i + 1)); continue; }
    out.push(a);
  }
  return out;
}

function allTokens(n) {
  const out = [];
  for (const t of [...n.argv.slice(1), ...n.redirects.map((r) => r.target)]) {
    out.push(t);
    const i = t.indexOf('=');
    if (i > 0) out.push(t.slice(i + 1));
  }
  return out;
}

function parseGit(argv) {
  const args = argv.slice(1);
  const dirs = [];
  const configs = [];
  let k = 0;
  while (k < args.length) {
    const a = args[k];
    if (a === '-C') { dirs.push(args[k + 1] ?? ''); k += 2; continue; }
    if (a === '-c') { configs.push(args[k + 1] ?? ''); k += 2; continue; }
    if (['--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env'].includes(a)) { k += 2; continue; }
    if (a.startsWith('-')) { k++; continue; }
    break;
  }
  return { dirs, configs, sub: args[k] ?? '', rest: args.slice(k + 1) };
}

function isLocalDbUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return ['localhost', '127.0.0.1', '::1'].includes(host);
  } catch {
    return false;
  }
}

function probeBranch(ctx) {
  if (typeof ctx.labakBranch !== 'function') return null;
  try { return ctx.labakBranch(); } catch { return null; }
}

function probeProtectedDiffers(ctx, target) {
  if (typeof ctx.protectedDiffers !== 'function') return true; // fail closed
  try { return Boolean(ctx.protectedDiffers(target)); } catch { return true; }
}

// ---------------------------------------------------------------------------
// Bash rules. Each returns a deny result or null.

function touchesLabak(n, cwd, ctx) {
  if (!ctx.labakRepoPath) return false;
  const labak = realResolve(ctx.labakRepoPath);
  const labakText = nfc(ctx.labakRepoPath).toLowerCase();
  if (isWithin(realResolve(cwd), labak)) return true;
  return allTokens(n).some((t) => {
    if (nfc(t).toLowerCase().includes(labakText)) return true;
    return isWithin(resolveToken(t, cwd), labak);
  });
}

function labakPushAllowed(git, ctx) {
  const branch = gateParam(ctx, 'G7', 'branch');
  if (!approved(ctx, 'G7') || !branch || gateParam(ctx, 'G7', 'push') !== 'true') return false;
  const forbidden = /^(-f|--force.*|--delete|-d|--mirror|--all|--tags|--prune)$/;
  if (git.rest.some((a) => forbidden.test(a))) return false;
  const [remote, ...refspecs] = positionals(git.rest, new Set(['--repo', '-o', '--push-option', '--receive-pack', '--exec']));
  if (!remote || refspecs.length === 0) return false;
  return refspecs.every((r) => r === branch || r === `${branch}:${branch}`);
}

function ruleGit(n, cwd, ctx) {
  if (n.program !== 'git') return null;
  const git = parseGit(n.argv);
  const urlKey = (v) => /^(url|remote)\./i.test(v);
  if (git.configs.some(urlKey)) return deny('bash.git-config-url', 'git -c with a url./remote. key is not allowed');
  switch (git.sub) {
    case 'push':
      if (touchesLabak(n, cwd, ctx) && labakPushAllowed(git, ctx)) return null;
      return deny('bash.git-push', 'git push is not allowed');
    case 'remote':
      return deny('bash.git-remote', 'git remote is not allowed');
    case 'send-email':
      return deny('bash.git-send-email', 'git send-email is not allowed');
    case 'subtree':
      return positionals(git.rest)[0] === 'push' ? deny('bash.git-push', 'git subtree push is not allowed') : null;
    case 'config':
      return git.rest.some(urlKey) ? deny('bash.git-config-url', 'git config of url./remote. keys is not allowed') : null;
    default:
      return null;
  }
}

function ruleGh(n, ctx) {
  if (n.program !== 'gh') return null;
  if (!approved(ctx, 'G2')) return deny('bash.gh', 'gh needs gate G2');
  const a = n.argv.slice(1);
  if (a.length === 4 && a[0] === 'repo' && a[1] === 'create' && a[2] === REPO_SLUG && a[3] === '--private') return null;
  if (a[0] === 'run' || a[0] === 'pr') {
    const repos = optionValues(a, ['-R', '--repo']);
    if (repos.length > 0 && repos.every((r) => r === REPO_SLUG)) return null;
  }
  return deny('bash.gh', `under G2, gh is limited to creating ${REPO_SLUG} and gh run/pr with --repo ${REPO_SLUG}`);
}

function ruleHosting(n, ctx) {
  if (!HOSTING_PROGRAMS.has(n.program)) return null;
  if (n.program === 'vercel' && approved(ctx, 'G6')) {
    const scope = gateParam(ctx, 'G6', 'scope');
    const scopes = optionValues(n.argv.slice(1), ['--scope', '-S']);
    if (scope && scopes.length > 0 && scopes.every((s) => s === scope)) return null;
    return deny('bash.hosting', 'under G6, vercel needs --scope matching the gate parameter');
  }
  return deny('bash.hosting', `${n.program} is not allowed`);
}

function ruleSupabase(n, ctx) {
  if (n.program !== 'supabase') return null;
  const args = n.argv.slice(1);
  const values = new Set(['--workdir', '--profile', '--output', '-o', '--dns-resolver', '--network-id',
    '--db-url', '--project-ref', '--schema', '-s', '--password', '-p']);
  const ps = positionals(args, values);
  const refs = optionValues(args, ['--project-ref']);
  const dbUrls = optionValues(args, ['--db-url']);
  if (dbUrls.some((u) => !isLocalDbUrl(u))) return deny('bash.supabase', 'supabase --db-url must point to localhost');
  const ref = approved(ctx, 'G3') ? gateParam(ctx, 'G3', 'projectRef') : null;
  if (ref) {
    if (refs.some((r) => r !== ref)) return deny('bash.supabase', 'under G3, --project-ref must match the gate parameter');
    return null;
  }
  if (refs.length) return deny('bash.supabase', 'supabase --project-ref needs gate G3');
  if (args.includes('--linked')) return deny('bash.supabase', 'supabase --linked needs gate G3');
  const [a, b] = ps;
  const ok =
    ['init', 'start', 'stop', 'status'].includes(a) ||
    (a === 'db' && b === 'reset') ||
    (a === 'test' && b === 'db') ||
    (a === 'migration' && b === 'new') ||
    (a === 'migration' && b === 'list' && args.includes('--local')) ||
    (a === 'gen' && b === 'types' && args.includes('--local'));
  return ok ? null : deny('bash.supabase', `supabase ${[a, b].filter(Boolean).join(' ')} is not a local command`);
}

function ruleSystemAndNetwork(n) {
  if (SYSTEM_PROGRAMS.has(n.program)) return deny('bash.system', `${n.program} is not allowed`);
  if (NETWORK_PROGRAMS.has(n.program)) return deny('bash.network', `${n.program} is not allowed; use node against localhost`);
  return null;
}

function rulePackages(n) {
  if (n.program === 'npx' || n.program === 'bunx') return deny('bash.packages', `${n.program} is not allowed`);
  if (!PACKAGE_MANAGERS.has(n.program)) return null;
  const args = n.argv.slice(1);
  if (args.some((a) => a === '-g' || a === '--global' || a === '--location=global')) {
    return deny('bash.packages', 'global installs are not allowed');
  }
  const sub = positionals(args, new Set(['--filter', '-F', '-C', '--dir', '--prefix', '--workspace', '--cwd']))[0];
  if (PACKAGE_DENIED_SUBCOMMANDS.has(sub) || (n.program === 'yarn' && sub === 'global')) {
    return deny('bash.packages', `${n.program} ${sub} is not allowed`);
  }
  return null;
}

function ruleContainers(n) {
  if (!CONTAINER_PROGRAMS.has(n.program)) return null;
  const args = n.argv.slice(1);
  if (args.some((a) => ['login', 'push', 'context', '--context'].includes(a) || a.startsWith('--context='))) {
    return deny('bash.containers', `${n.program} login, push and context are not allowed`);
  }
  return null;
}

function ruleShellTricks(n, seg) {
  if (seg.afterPipe && SHELLS.has(n.program)) return deny('bash.pipe-to-shell', 'piping into a shell is not allowed');
  if (n.program === 'base64' && n.argv.slice(1).some((a) => a === '--decode' || /^-[a-zA-Z]*[dD]/.test(a))) {
    return deny('bash.base64-decode', 'base64 decoding is not allowed');
  }
  return null;
}

/** Paths a simple command writes or changes, grouped by how strictly to match them. */
function modifiedPaths(n) {
  const strict = [];
  const withAncestors = [];
  for (const r of n.redirects) {
    if (WRITE_REDIRECTS.has(r.op) || (r.op === '>&' && !/^(\d+|-)$/.test(r.target))) strict.push(r.target);
  }
  const args = n.argv.slice(1);
  const inPlace = (a) => a.startsWith('--in-place') || /^-[a-zA-Z]*i/.test(a);
  switch (n.program) {
    case 'rm': case 'chmod': case 'chown':
      withAncestors.push(...pathArguments(args)); break;
    case 'mv': {
      const ps = pathArguments(args);
      withAncestors.push(...ps.slice(0, -1));
      strict.push(...ps.slice(-1));
      break;
    }
    case 'cp': case 'ln': case 'tee': case 'truncate':
      strict.push(...pathArguments(args)); break;
    case 'sed': case 'perl':
      if (args.some(inPlace)) strict.push(...pathArguments(args));
      break;
    default:
      break;
  }
  return { strict, withAncestors };
}

function gitWorkDir(git, cwd) {
  let dir = cwd;
  for (const d of git.dirs) dir = path.resolve(dir, expandHome(d, dir));
  return dir;
}

function ruleProtected(n, cwd, ctx, event) {
  const { strict, withAncestors } = modifiedPaths(n);
  for (const t of strict) {
    if (namesProtected(t, cwd, ctx, { ancestors: false })) return deny('bash.protected-file', `${t} is a protected harness file`);
  }
  for (const t of withAncestors) {
    if (namesProtected(t, cwd, ctx, { ancestors: true })) return deny('bash.protected-file', `${t} is or contains a protected harness file`);
  }
  if (event.agent_type) {
    for (const t of [...strict, ...withAncestors]) {
      const rel = repoRelative(resolveToken(t, cwd), ctx);
      if (rel !== null && (rel === 'docs/execution' || rel.startsWith('docs/execution/'))) {
        return deny('bash.execution-state', 'only the controller writes docs/execution/');
      }
    }
  }
  if (n.program !== 'git') return null;
  const git = parseGit(n.argv);
  if (!['checkout', 'restore', 'reset', 'switch'].includes(git.sub)) return null;
  const dir = gitWorkDir(git, cwd);
  if (!isWithin(realResolve(dir), realResolve(ctx.repoRoot))) return null; // another repository
  const dashes = git.rest.indexOf('--');
  const before = dashes < 0 ? git.rest : git.rest.slice(0, dashes);
  const after = dashes < 0 ? [] : git.rest.slice(dashes + 1);
  const ps = positionals(before, new Set(['-b', '-B', '-c', '-C', '--orphan', '-s', '--source', '-U', '--unified']));
  const named = [...after, ...(git.sub === 'switch' ? [] : ps)];
  for (const t of named) {
    if (namesProtected(t, dir, ctx, { ancestors: true })) return deny('bash.protected-file', `git ${git.sub} names protected path ${t}`);
  }
  if (dashes >= 0 || git.sub === 'restore') return null;
  let target = null;
  if (git.sub === 'checkout' || git.sub === 'switch') target = ps[0] ?? null;
  if (git.sub === 'reset' && before.includes('--hard')) target = ps[0] ?? 'HEAD';
  if (target && target !== 'HEAD' && probeProtectedDiffers(ctx, target)) {
    return deny('bash.protected-differs', `git ${git.sub} ${target} would change protected harness files`);
  }
  return null;
}

function ruleRm(n, cwd, ctx) {
  if (n.program !== 'rm') return null;
  const root = realResolve(ctx.repoRoot);
  for (const t of pathArguments(n.argv.slice(1))) {
    const expanded = expandHome(t, cwd);
    if (expanded.includes('$') || expanded.includes('`')) return deny('bash.rm-outside-repo', `cannot resolve rm target ${t}`);
    if (!isWithin(realResolve(path.resolve(cwd, expanded)), root)) return deny('bash.rm-outside-repo', `rm target ${t} is outside the repository`);
  }
  return null;
}

function ruleHarnessScripts(n, event) {
  let script = null;
  let rest = [];
  if (n.program === 'node') {
    const args = n.argv.slice(1);
    const values = new Set(['-r', '--require', '--import', '--loader', '--experimental-loader', '-e', '--eval',
      '-p', '--print', '--input-type', '-C', '--conditions', '--env-file']);
    let k = 0;
    while (k < args.length) {
      if (values.has(args[k])) { k += 2; continue; }
      if (args[k].startsWith('-')) { k++; continue; }
      break;
    }
    script = args[k] ?? null;
    rest = args.slice(k + 1);
  } else if (n.program.endsWith('.mjs')) {
    script = n.program;
    rest = n.argv.slice(1);
  }
  if (!script) return null;
  const base = path.posix.basename(script);
  if (base === 'gate.mjs') return deny('bash.gate-script', 'gate.mjs is for Einar only, in his own terminal');
  if (base === 'integrity.mjs' && n.argv.includes('--lock')) return deny('bash.integrity-lock', 'integrity.mjs --lock is for Einar only');
  if (base === 'state.mjs' && event.agent_type && rest[0] !== 'show') {
    return deny('bash.execution-state', 'only the controller changes execution state');
  }
  return null;
}

function ruleEnvFiles(n) {
  for (const t of allTokens(n)) {
    const base = path.posix.basename(t);
    if (base !== '.env.example' && /^\.env([.*?[].*)?$/.test(base)) return deny('bash.env-file', `${t} may hold secrets`);
  }
  return null;
}

function ruleLabak(n, cwd, ctx) {
  if (!touchesLabak(n, cwd, ctx)) return null;
  if (!approved(ctx, 'G7')) return deny('labak.no-gate', 'the LABAK repository needs gate G7');
  const branch = gateParam(ctx, 'G7', 'branch');
  if (!branch) return deny('labak.no-branch', 'G7 has no branch parameter');
  if (n.program === 'git') {
    const git = parseGit(n.argv);
    if (git.sub === 'checkout' || git.sub === 'switch') {
      const ps = positionals(git.rest, new Set(['-b', '-c', '-B', '-C', '--orphan']));
      const created = optionValues(git.rest, ['-b', '-c']);
      const target = created[0] ?? ps[0];
      // Switching to the branch, or creating it (optionally from a start point), is allowed.
      if (target === branch && (created.length ? ps.length <= 1 : ps.length === 1)) return null;
      return deny('labak.branch', `in the LABAK repository only ${branch} may be checked out`);
    }
  }
  if (probeBranch(ctx) !== branch) return deny('labak.branch', `the LABAK repository is not on ${branch}`);
  return null;
}

function evaluateBash(command, cwd, event, ctx, depth) {
  if (depth > 5) return deny('bash.nesting', 'command nesting is too deep to check');
  let dir = cwd;
  for (const seg of splitWithOps(command)) {
    const n = normalize(seg.text);
    if (!n.program) continue;
    const result =
      ruleGit(n, dir, ctx) ??
      ruleGh(n, ctx) ??
      ruleHosting(n, ctx) ??
      ruleSupabase(n, ctx) ??
      ruleSystemAndNetwork(n) ??
      rulePackages(n) ??
      ruleContainers(n) ??
      ruleShellTricks(n, seg) ??
      ruleProtected(n, dir, ctx, event) ??
      ruleRm(n, dir, ctx) ??
      ruleHarnessScripts(n, event) ??
      ruleEnvFiles(n) ??
      ruleLabak(n, dir, ctx);
    if (result) return result;
    for (const script of inlineScriptsDetailed(n.argv)) {
      if (script.kind === 'code' && DANGEROUS_CODE.test(script.text)) {
        return deny('bash.inline-code', 'inline interpreter code that starts processes is not allowed');
      }
      const inner = evaluateBash(script.text, dir, event, ctx, depth + 1);
      if (inner) return inner;
    }
    if ((n.program === 'cd' || n.program === 'pushd') && n.argv[1] && !n.argv[1].startsWith('-')) {
      dir = path.resolve(dir, expandHome(n.argv[1], dir));
    } else if (n.program === 'cd' && n.argv.length === 1) {
      dir = os.homedir();
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// File-writing tools

function evaluateWrite(event, ctx) {
  const input = event.tool_input ?? {};
  const target = input.file_path ?? input.notebook_path;
  if (typeof target !== 'string' || target === '') return deny('write.no-path', 'no file path given');
  const cwd = event.cwd || ctx.repoRoot;
  const abs = resolveToken(target, cwd);
  const rel = repoRelative(abs, ctx);
  if (rel === null) {
    const inScratch = typeof event.scratchpad_dir === 'string' && event.scratchpad_dir !== '' &&
      isWithin(abs, realResolve(event.scratchpad_dir));
    const inLabak = ctx.labakRepoPath && isWithin(abs, realResolve(ctx.labakRepoPath));
    if (inLabak) {
      const branch = approved(ctx, 'G7') ? gateParam(ctx, 'G7', 'branch') : null;
      if (!branch) return deny('labak.no-gate', 'the LABAK repository needs gate G7');
      if (probeBranch(ctx) !== branch) return deny('labak.branch', `the LABAK repository is not on ${branch}`);
    } else if (!inScratch) {
      return deny('write.outside-repo', `${target} is outside the repository and the scratchpad`);
    }
  }
  if (isProtectedRel(rel)) return deny('write.protected', `${target} is a protected harness file`);
  if (REVIEWERS.has(event.agent_type)) return deny('write.reviewer', 'reviewers are read-only');
  if (event.agent_type && rel !== null && (rel === 'docs/execution' || rel.startsWith('docs/execution/'))) {
    return deny('write.execution-state', 'only the controller writes docs/execution/');
  }
  return null;
}

// ---------------------------------------------------------------------------
// Entry point

/**
 * Decide on one PreToolUse event.
 * @param {object} event  PreToolUse stdin JSON (tool_name, tool_input, cwd, session_id, scratchpad_dir, agent_id, agent_type)
 * @param {{ repoRoot: string, gates: object, labakRepoPath: string, labakBranch?: () => string, protectedDiffers?: (target: string) => boolean }} ctx
 * @returns {{ decision: 'allow' | 'deny', reason?: string, rule?: string }}
 */
export function evaluate(event, ctx) {
  const name = event && typeof event === 'object' ? event.tool_name : undefined;
  if (typeof name !== 'string' || name === '') return deny('fail-closed', 'the hook event could not be parsed');
  try {
    if (!ctx || !gatesValid(ctx.gates)) {
      return READ_ONLY_TOOLS.has(name) ? allow() : deny('fail-closed', 'gates.json could not be read; only Read, Grep and Glob are allowed');
    }
    const input = event.tool_input ?? {};
    if (name.startsWith('mcp__')) {
      return name.startsWith('mcp__ccd_turn__') ? allow() : deny('tool.mcp', `${name} is not allowed in this session`);
    }
    if (name.startsWith('Artifact') || DENIED_TOOLS.has(name)) return deny('tool.denied', `${name} is not allowed`);
    if (name === 'Agent' || name === 'Task') {
      if (event.agent_type) return deny('agent.nested', 'only the controller dispatches subagents');
      if (!ALLOWED_AGENTS.has(input.subagent_type)) return deny('agent.type', `subagent_type ${input.subagent_type ?? '(none)'} is not allowed`);
      if (input.isolation === 'remote') return deny('agent.remote', 'remote subagents are not allowed');
      return allow();
    }
    if (name === 'Bash') {
      if (typeof input.command !== 'string') return deny('bash.no-command', 'no command given');
      return evaluateBash(input.command, event.cwd || ctx.repoRoot, event, ctx, 0) ?? allow();
    }
    if (WRITE_TOOLS.has(name)) return evaluateWrite(event, ctx) ?? allow();
    return allow();
  } catch (error) {
    return READ_ONLY_TOOLS.has(name) ? allow() : deny('fail-closed', `guard error: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Live probes used by the hook (not by the unit tests)

/** Builds the git probes the hook passes in GuardContext. */
export function gitProbes(repoRoot, labakRepoPath) {
  const git = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 4000 });
  return {
    labakBranch: () => git(['-C', labakRepoPath, 'symbolic-ref', '--short', 'HEAD']).trim(),
    protectedDiffers: (target) => {
      try {
        git(['-C', repoRoot, 'rev-parse', '--verify', '--quiet', `${target}^{commit}`]);
      } catch {
        return false; // not a commit: a path, already checked against the protected list
      }
      try {
        git(['-C', repoRoot, 'diff', '--quiet', 'HEAD', target, '--', ...PROTECTED_DIRS, ...PROTECTED_FILES]);
        return false;
      } catch (error) {
        if (error.status === 1) return true;
        throw error;
      }
    },
  };
}

/** Input as written to guard-log.jsonl: commands truncated, file paths only, never contents. */
export function redactInput(toolName, input) {
  const i = input && typeof input === 'object' ? input : {};
  if (toolName === 'Bash') return { command: String(i.command ?? '').slice(0, 200) };
  if (typeof i.file_path === 'string') return { file_path: i.file_path };
  if (typeof i.notebook_path === 'string') return { notebook_path: i.notebook_path };
  if (toolName === 'Agent' || toolName === 'Task') return { subagent_type: i.subagent_type, isolation: i.isolation };
  return { keys: Object.keys(i) };
}
