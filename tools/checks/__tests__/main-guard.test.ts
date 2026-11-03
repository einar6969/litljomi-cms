import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evaluatePush, runGuard, type PullSummary, type PushEvent } from '../main-guard.ts';

// The `main` guard (decision 50.3): a push to `main` passes only when every new commit belongs to a
// pull request merged into `main`, or when Einar pushed it. A failure is the alert; nothing is reverted.
const here = dirname(fileURLToPath(import.meta.url));
const fixture = <T>(name: string): T => JSON.parse(readFileSync(join(here, 'fixtures', 'main-guard', name), 'utf8')) as T;

const TRUSTED = 'einar6969';
const SHA_A = '2222222222222222222222222222222222222222';
const SHA_B = '3333333333333333333333333333333333333333';

/** The fixture push (two commits by a bot account), with overrides. */
function push(overrides: Partial<PushEvent> = {}): PushEvent {
  return { ...fixture<PushEvent>('push-event.json'), ...overrides };
}
const mergedPulls = () => fixture<Record<string, PullSummary[]>>('pulls.json');
const evaluate = (event: PushEvent, shas: string[], pulls: Record<string, PullSummary[]>) =>
  evaluatePush({ event, shas, pulls, trustedPusher: TRUSTED });

describe('evaluatePush', () => {
  it('passes when every new commit belongs to a pull request merged into main', () => {
    const verdict = evaluate(push(), [SHA_A, SHA_B], mergedPulls());
    expect(verdict.ok).toBe(true);
    expect(verdict.lines).toEqual([`${SHA_A} pull request #7`, `${SHA_B} pull request #7`]);
  });

  it('passes any push by the trusted account without looking at pull requests', () => {
    const verdict = evaluate(push({ sender: { login: TRUSTED } }), [SHA_A, SHA_B], {});
    expect(verdict.ok).toBe(true);
    expect(verdict.lines).toEqual([`pushed by ${TRUSTED}`]);
  });

  it('fails a commit that belongs to no pull request, naming it', () => {
    const pulls = { ...mergedPulls(), [SHA_B]: [] };
    const verdict = evaluate(push(), [SHA_A, SHA_B], pulls);
    expect(verdict.ok).toBe(false);
    expect(verdict.lines).toContain(`${SHA_B} FAIL: no pull request merged into main`);
  });

  it('fails a commit whose pull request is still open', () => {
    const pulls = { ...mergedPulls(), [SHA_A]: [{ number: 8, merged_at: null, base: { ref: 'main' } }] };
    expect(evaluate(push(), [SHA_A, SHA_B], pulls).ok).toBe(false);
  });

  it('fails a commit whose pull request was merged into another branch', () => {
    const pulls = { ...mergedPulls(), [SHA_A]: [{ number: 9, merged_at: '2026-11-04T10:00:00Z', base: { ref: 'm2/x' } }] };
    expect(evaluate(push(), [SHA_A, SHA_B], pulls).ok).toBe(false);
  });

  it('fails a commit missing from the pull-request lookup (fails closed)', () => {
    const { [SHA_B]: _omitted, ...pulls } = mergedPulls();
    expect(evaluate(push(), [SHA_A, SHA_B], pulls).ok).toBe(false);
  });

  it('fails a force-push or a deletion of main by anyone but the trusted account', () => {
    expect(evaluate(push({ forced: true }), [SHA_A, SHA_B], mergedPulls()).ok).toBe(false);
    expect(evaluate(push({ deleted: true, commits: [] }), [], {}).ok).toBe(false);
    expect(evaluate(push({ forced: true, sender: { login: TRUSTED } }), [SHA_A, SHA_B], {}).ok).toBe(true);
  });

  it('ignores a push to another branch', () => {
    const verdict = evaluate(push({ ref: 'refs/heads/m2/M2-01-x' }), [SHA_A], {});
    expect(verdict.ok).toBe(true);
    expect(verdict.lines).toEqual(['not main: nothing to check']);
  });
});

describe('runGuard', () => {
  /** A fake `gh api` that answers compare and commit-pulls calls from the fixture, recording each call. */
  function fakeGh(pulls: Record<string, PullSummary[]>, compare: string[] = [SHA_A, SHA_B]) {
    const calls: string[][] = [];
    const gh = async (args: string[]): Promise<string> => {
      calls.push(args);
      const path = args.find((arg) => arg.startsWith('repos/')) ?? '';
      if (path.includes('/compare/')) return compare.join('\n');
      const sha = /\/commits\/([0-9a-f]{40})\/pulls$/.exec(path)?.[1];
      if (sha) return JSON.stringify(pulls[sha] ?? []);
      throw new Error(`unexpected gh call: ${args.join(' ')}`);
    };
    return { gh, calls };
  }
  const run = (event: PushEvent, gh: (args: string[]) => Promise<string>) =>
    runGuard({ event, gh, trustedPusher: TRUSTED, retryDelaysMs: [0, 0], sleep: async () => {} });

  it('lists the new commits with the compare API and passes merged ones', async () => {
    const { gh, calls } = fakeGh(mergedPulls());
    const result = await run(push(), gh);
    expect(result.exitCode).toBe(0);
    expect(calls[0]).toEqual([
      'api',
      '--paginate',
      `repos/einar6969/litljomi-cms/compare/${'1'.repeat(40)}...${SHA_B}`,
      '--jq',
      '.commits[].sha',
    ]);
    expect(calls.slice(1).map((c) => c.at(-1))).toEqual([
      `repos/einar6969/litljomi-cms/commits/${SHA_A}/pulls`,
      `repos/einar6969/litljomi-cms/commits/${SHA_B}/pulls`,
    ]);
  });

  it('uses the event commits when main is created (no base to compare)', async () => {
    const { gh, calls } = fakeGh(mergedPulls());
    const result = await run(push({ created: true, before: '0'.repeat(40) }), gh);
    expect(result.exitCode).toBe(0);
    expect(calls.some((c) => c.some((arg) => arg.includes('/compare/')))).toBe(false);
  });

  it('asks again before failing, since GitHub may link a merge to its pull request a little late', async () => {
    let asked = 0;
    const gh = async (args: string[]): Promise<string> => {
      const path = args.find((arg) => arg.startsWith('repos/')) ?? '';
      if (path.includes('/compare/')) return SHA_A;
      asked += 1;
      return asked < 3 ? '[]' : JSON.stringify(mergedPulls()[SHA_A]);
    };
    const result = await run(push(), gh);
    expect(result.exitCode).toBe(0);
    expect(asked).toBe(3);
  });

  it('exits 1 with an error line naming the unmerged commit', async () => {
    const { gh } = fakeGh({ ...mergedPulls(), [SHA_B]: [] });
    const result = await run(push(), gh);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain(`::error::main guard: ${SHA_B} FAIL: no pull request merged into main`);
  });

  it('makes no API call for a push by the trusted account', async () => {
    const { gh, calls } = fakeGh({});
    const result = await run(push({ sender: { login: TRUSTED } }), gh);
    expect(result.exitCode).toBe(0);
    expect(calls).toEqual([]);
  });

  it('fails closed when the GitHub API call fails', async () => {
    const gh = async (): Promise<string> => {
      throw new Error('HTTP 502');
    };
    const result = await run(push(), gh);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('::error::main guard: GitHub API call failed: HTTP 502');
  });
});
