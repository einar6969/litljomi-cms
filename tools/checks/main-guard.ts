import { execFile } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// The `main` guard (decision 50.3), run by .github/workflows/main-guard.yml on every push to `main`.
// `main` has no branch protection, so this check is the alert: it fails unless each new commit belongs
// to a pull request merged into `main`, and a force-push or deletion of `main` always fails. There is no
// trusted pusher: every cloud thread acts as einar6969, so a pusher exemption would exempt them all.
// It reverts nothing.
// It needs only Node's standard library and the runner's `gh`, so the workflow installs no packages.

export type PushEvent = {
  ref: string;
  before: string;
  after: string;
  created: boolean;
  deleted: boolean;
  forced: boolean;
  repository: { full_name: string };
  sender: { login: string };
  commits: { id: string }[];
};

export type PullSummary = { number: number; merged_at: string | null; base: { ref: string } };

export type Verdict = { ok: boolean; lines: string[] };

const MAIN = 'refs/heads/main';
const ZERO_SHA = /^0{40}$/;

/** True when one of the commit's pull requests was merged into `main`. */
function mergedIntoMain(pulls: PullSummary[] | undefined): PullSummary | undefined {
  return pulls?.find((pull) => pull.merged_at !== null && pull.base.ref === 'main');
}

/**
 * Judges a push from its event, the new commits and each commit's pull requests. Pure.
 * A force-push or deletion of `main` always fails, whoever made it; a commit missing from `pulls`
 * counts as having no pull request (fails closed).
 */
export function evaluatePush(input: { event: PushEvent; shas: string[]; pulls: Record<string, PullSummary[]> }): Verdict {
  const { event, shas, pulls } = input;
  if (event.ref !== MAIN) return { ok: true, lines: ['not main: nothing to check'] };

  const lines: string[] = [];
  if (event.deleted) lines.push(`FAIL: main deleted by ${event.sender.login}`);
  if (event.forced) lines.push(`FAIL: main force-pushed by ${event.sender.login}`);
  for (const sha of shas) {
    const pull = mergedIntoMain(pulls[sha]);
    lines.push(pull ? `${sha} pull request #${pull.number}` : `${sha} FAIL: no pull request merged into main`);
  }
  return { ok: !lines.some((line) => line.includes('FAIL')), lines };
}

type Gh = (args: string[]) => Promise<string>;

/** The commits this push added to `main`: the compare API, or the event's list when `main` was created. */
async function newCommitShas(event: PushEvent, gh: Gh): Promise<string[]> {
  if (event.deleted) return [];
  if (event.created || ZERO_SHA.test(event.before)) return event.commits.map((commit) => commit.id);
  const repo = event.repository.full_name;
  const out = await gh(['api', '--paginate', `repos/${repo}/compare/${event.before}...${event.after}`, '--jq', '.commits[].sha']);
  return out.split('\n').map((line) => line.trim()).filter(Boolean);
}

async function pullsOf(repo: string, sha: string, gh: Gh): Promise<PullSummary[]> {
  return JSON.parse(await gh(['api', `repos/${repo}/commits/${sha}/pulls`])) as PullSummary[];
}

/**
 * Runs the guard against GitHub through `gh`. A commit without a merged pull request is asked about again
 * after each of `retryDelaysMs`, because GitHub can link a merge commit to its pull request a little late.
 */
export async function runGuard(input: {
  event: PushEvent;
  gh: Gh;
  retryDelaysMs: number[];
  sleep: (ms: number) => Promise<void>;
}): Promise<{ exitCode: number; output: string }> {
  const { event, gh, retryDelaysMs, sleep } = input;
  const repo = event.repository.full_name;
  let verdict: Verdict;
  try {
    const shas = event.ref === MAIN ? await newCommitShas(event, gh) : [];
    const pulls: Record<string, PullSummary[]> = {};
    for (const sha of shas) {
      pulls[sha] = await pullsOf(repo, sha, gh);
      for (const delay of retryDelaysMs) {
        if (mergedIntoMain(pulls[sha])) break;
        await sleep(delay);
        pulls[sha] = await pullsOf(repo, sha, gh);
      }
    }
    verdict = evaluatePush({ event, shas, pulls });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, output: `::error::main guard: GitHub API call failed: ${reason}` };
  }
  const header = `main guard: push ${event.before.slice(0, 7)}..${event.after.slice(0, 7)} by ${event.sender.login}`;
  if (verdict.ok) return { exitCode: 0, output: [header, ...verdict.lines].join('\n') };
  const errors = verdict.lines.filter((line) => line.includes('FAIL')).map((line) => `::error::main guard: ${line}`);
  return { exitCode: 1, output: [header, ...verdict.lines, ...errors].join('\n') };
}

/** True when this file is the script Node was started with, also when started through a symlink. */
function isEntryPoint(): boolean {
  const started = process.argv[1];
  if (!started || !existsSync(started)) return false;
  return realpathSync(started) === realpathSync(fileURLToPath(import.meta.url));
}

if (isEntryPoint()) {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    console.error('::error::main guard: GITHUB_EVENT_PATH must be set');
    process.exitCode = 1;
  } else {
    const run = promisify(execFile);
    const { exitCode, output } = await runGuard({
      event: JSON.parse(readFileSync(eventPath, 'utf8')) as PushEvent,
      gh: async (args) => (await run('gh', args, { maxBuffer: 16 * 1024 * 1024 })).stdout,
      retryDelaysMs: [10_000, 20_000],
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    });
    (exitCode === 0 ? console.log : console.error)(output);
    process.exitCode = exitCode;
  }
}
