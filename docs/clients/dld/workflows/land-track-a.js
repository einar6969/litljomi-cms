export const meta = {
  name: 'dld-land-track-a',
  description: 'Land the eight reviewed Track A pull requests as one integration PR: merge them into one branch, fix the two database collisions, then verify in CI, in the browser suite, in an upgrade rehearsal and by review of the overlapping files. Nothing is merged to main.',
  phases: [
    { title: 'Integrate', detail: 'one branch with all eight heads, conflicts and collisions fixed (slot 1)' },
    { title: 'Verify', detail: 'CI, browser suite (slot 1), upgrade rehearsal (slot 2), reviews of the overlap' },
    { title: 'Fix', detail: 'only what verification found; what failed runs again' },
  ],
}

// The task text is docs/clients/dld/PLAN.md, section 5, "WP1". This script is its mechanics.
// The coordinator merges; no agent here does.

const HUB = '/Users/einarzoega/litljomi-cms'
const REPO = 'einar6969/litljomi-cms'
const BRANCH = 'integration/track-a'
const PLAN = HUB + '/docs/clients/dld/PLAN.md'
const CTX = 'Read ' + HUB + '/docs/agents/CONTEXT.md first: where things are, which commands you may run, how a task ends. This task is not from the M0-M1 plan; this message and ' + PLAN + ' section 5 "WP1" are its task text. The machine is short of disk: if df shows less than 3 GB free on /System/Volumes/Data, stop and report blocked; before you finish, delete your worktree .next folders and test output. This shell is zsh: it does not split an unquoted variable into words, and "$1:x" is read as a modifier, so write ${1} and loop over arrays. '
const SLOT1 = 'You hold local stack slot 1 (CMS_STACK_SLOT unset) for this task; nobody else is on it. Run pnpm db:start if it is not running and pnpm db:reset before your own database or browser runs. Never touch slot 2. '
const SLOT2 = 'You hold local stack slot 2 for this task: put CMS_STACK_SLOT=2 on every pnpm db:*, test:integration, seed and browser command, and run them from your own worktree. Start it from your worktree with CMS_STACK_SLOT=2 pnpm db:stop then CMS_STACK_SLOT=2 pnpm db:start (the stack mounts email templates from the worktree that started it). Never touch slot 1. '
const BOUNDARY = 'This is BOUNDARY work: production has no backups, so every migration is additive and forward-only (no dropped object, no changed signature, new checks only on new nullable columns), every function stays SECURITY INVOKER with search_path empty and schema-qualified names, and the tenant is derived from the row. '
const REPORT_ONLY = 'You REPORT ONLY: change no tracked file, commit nothing, push nothing, comment on nothing. '

const INTEGRATE = { type: 'object', properties: { pr_url: { type: 'string' }, branch: { type: 'string' }, head_sha: { type: 'string' }, summary: { type: 'string' }, integration_commits: { type: 'array', items: { type: 'string' } }, conflicts_resolved: { type: 'array', items: { type: 'string' } }, files_changed: { type: 'array', items: { type: 'string' } }, not_run: { type: 'array', items: { type: 'string' } }, open_choices: { type: 'array', items: { type: 'string' } }, blocked: { type: 'string' } }, required: ['branch', 'head_sha', 'summary'] }
const CHECK = { type: 'object', properties: { ok: { type: 'boolean' }, head_sha: { type: 'string' }, failures: { type: 'array', items: { type: 'string' } }, notes: { type: 'array', items: { type: 'string' } } }, required: ['ok', 'head_sha', 'failures'] }
const REVIEW = { type: 'object', properties: { verdict: { type: 'string', enum: ['PASS', 'FAIL'] }, head_sha: { type: 'string' }, blocking: { type: 'array', items: { type: 'string' } }, minors: { type: 'array', items: { type: 'string' } } }, required: ['verdict', 'head_sha', 'blocking'] }
const FIX = { type: 'object', properties: { head_sha: { type: 'string' }, summary: { type: 'string' }, files_changed: { type: 'array', items: { type: 'string' } }, blocked: { type: 'string' } }, required: ['head_sha', 'summary', 'files_changed'] }

// ---------------- Integrate ----------------
const INTEGRATE_PROMPT = CTX + SLOT1 + BOUNDARY + [
  'Task: build the integration branch for Track A. Eight pull requests were built in parallel from the same main. Each has a reviewer PASS on its own head and green CI, but they were never tested together, they conflict in several files, and two pairs collide in the database. Read ' + PLAN + ' section 5 "WP1" now: it gives the merge order with each head, the conflicts to expect, the five fixes, and what must not change.',
  'Steps:',
  '1. In your worktree: git fetch origin; git checkout -b ' + BRANCH + ' origin/main; pnpm install.',
  '2. Merge in the order the plan gives, each with git merge --no-ff -m "Merge #<n> <title>": origin/fix/editor-probe-findings (#73), origin/feat/media-library-l6 (#82, which carries #78 and #81), origin/feat/media-library-l3 (#76), origin/feat/a7-live-checks-without-own-path (#79), origin/feat/a12-manual-ordering (#77), origin/feat/a4-local-rehearsal (#80). Before each merge check that the branch head is the one the plan names; if a head has moved, stop and report blocked.',
  '3. Resolve each conflict keeping both sides\' behaviour, in the merge commit itself. Never hand-merge a generated file: once all six are merged, regenerate modules/demo/schema.snapshot.json (pnpm check:schema --update) and apps/demo-site/src/types/cms.ts (the gen-types command in docs/runbooks/operations.md, "Site 4"), and check the result holds what every PR added.',
  '4. Then the five fixes of the plan, one commit each, in its order. For fix 2 read L3\'s and A12\'s migrations side by side: api.worker_release_snapshot in A12\'s file must be L3\'s body (caption and credit on every image) with A12\'s ordering added and nothing else, same signature, grants, SECURITY INVOKER and empty search_path. Then list every object that two of the three new migrations both create or replace, and confirm the later file carries the earlier file\'s change.',
  '5. Change no behaviour beyond those fixes. If the merge reveals a real defect between two PRs, make the smallest change that lets both PRs\' own tests pass and name it under open_choices.',
  '6. Run all of: pnpm lint, pnpm typecheck, pnpm test, pnpm check:slugs, pnpm check:schema, pnpm db:reset, pnpm db:test, pnpm test:integration. Do not run the browser suite; another agent does.',
  '7. git push -u origin ' + BRANCH + '. Open a PR against main titled "Track A: land the eight reviewed pull requests together". Its body lists the eight PRs it lands, one per line (#73, #76, #77, #78, #79, #80, #81, #82), every conflict and how it was resolved, every integration-only commit (sha and one line), and what was not run. Do not wait for CI. Do not merge.',
  'Report: pr_url, branch, the full head sha, integration_commits (sha and one line each, merge commits excluded), conflicts_resolved (file and one line each), files_changed (every path the conflict resolutions and the integration-only commits touched), not_run, open_choices.',
].join('\n')

phase('Integrate')
const impl = await agent(INTEGRATE_PROMPT, { label: 'integrate', phase: 'Integrate', model: 'opus', agentType: 'cms-implementer', isolation: 'worktree', schema: INTEGRATE })
if (!impl) return { status: 'integrate_failed' }
if (impl.blocked) return { status: 'blocked', blocked: impl.blocked, summary: impl.summary }

// ---------------- Verify ----------------
const pr = impl.pr_url || ('branch ' + BRANCH)
const OVERLAP = 'the new migrations under supabase/migrations/ that origin/production does not have (does a later one undo an earlier one; is api.worker_release_snapshot L3\'s body plus A12\'s ordering and nothing else; is each still additive and forward-only against origin/production), apps/cms/src/privileged/worker/build-release.ts, projection-context.ts (A4\'s loopback-http image rule together with L3 and A7), deliver.ts, process-request.ts and live-targets.ts, apps/cms/src/privileged/preview/, packages/schema/src/module.ts and projection.ts'
const scope = sha => 'Subject: ' + pr + ' in ' + REPO + ' at head ' + sha + ', the Track A integration branch. Eight pull requests (#73, #76 to #82) each passed review on its own head: do NOT review their content again. Review two things. (1) The conflict resolutions and the integration-only commits: git log --first-parent origin/main..' + sha + ' lists them; for a merge commit, git show <merge> shows only what the resolution changed. The builder reported these commits:\n- ' + (impl.integration_commits || []).join('\n- ') + '\nand these resolutions:\n- ' + (impl.conflicts_resolved || []).join('\n- ') + '\n(2) The combined behaviour of the files more than one of the PRs changed, which nobody has read together: ' + OVERLAP + '. The task text is ' + PLAN + ' section 5 "WP1". '
const again = (round, prev, sha, note) => round > 1 && prev ? ' This is re-review round ' + round + ': a fix moved the head from ' + prev + ' to ' + sha + ' for these findings:\n- ' + note + '\nRead git diff ' + prev + '..' + sha + ' and judge whether the findings in your area are fixed and whether the fix broke anything in your area. Your PASS covers the fix; earlier passes cover the rest.' : ''
const tail = (sha, word) => ' Do not use any local Supabase stack. Verdict PASS or FAIL; blocking = Critical and Major findings as file:line with one sentence each; minors separately. On PASS post exactly "' + word + ': PASS ' + sha + '" as a PR comment, followed by the minors; on FAIL post the blocking findings as a PR comment. head_sha is ' + sha + '.'

const CHECKS = {
  ci: (sha) => agent('In ' + HUB + ', for ' + pr + ' (' + REPO + '): confirm with gh pr view that its head is ' + sha + ', then wait for every check on that head with gh pr checks --watch --interval 30. ok is true only if every check passed. For each failed job, read it with gh run view <run id> --log-failed and give the test or step name and the first error lines as one item of failures. If the only failure is in apps/cms/src/privileged/worker/__tests__/deliver.test.ts (a known flake, OPEN-ISSUES R6), re-run that job once with gh run rerun --failed and report what the second run did. Change nothing else. head_sha is ' + sha + '.',
    { label: 'verify:ci', phase: 'Verify', model: 'haiku', agentType: 'general-purpose', schema: CHECK }),
  browser: (sha) => agent(CTX + SLOT1 + REPORT_ONLY + 'Run the whole browser suite of apps/cms on the integration head. In your worktree: git fetch origin; git checkout --detach ' + sha + '; pnpm install; pnpm db:reset. Then run every spec under apps/cms/e2e the way its Playwright config expects, seeds and app server included (read apps/cms/package.json, apps/cms/playwright.config.ts and tests/integration for the commands). It includes apps/cms/e2e/manual-order.spec.ts, which has never been run on a stack. Re-run each failed spec once on its own before reporting it, and say whether it passed alone. ok is true only if every spec passed. failures: one item per failing test, with the spec file, the test name, the first error, and one sentence saying whether the SPEC is wrong (a selector, timing, or an assertion another PR made untrue) or the CODE is wrong, with your evidence. notes: totals passed, failed and skipped, and the wall time. Leave the stack running. head_sha is ' + sha + '.',
    { label: 'verify:browser', phase: 'Verify', model: 'sonnet', agentType: 'general-purpose', isolation: 'worktree', schema: CHECK }),
  rehearsal: (sha) => agent(CTX + SLOT2 + REPORT_ONLY + [
    'Goal: prove that the migrations production does not have yet apply cleanly as an UPGRADE of a database that already holds rows, and that the code deployed today keeps working between the migration and the new deployment. Production has no backups, and CI only ever applies migrations to an empty database, so this is the only test of the upgrade.',
    '1. In your worktree: git fetch origin; git checkout --detach origin/production; pnpm install. Start slot 2 from here and reset it: the database now has exactly production\'s migrations.',
    '2. Put rows in it with production\'s own code: the local seeds under tests/integration, and at least one published, delivered release for a tenant with images (the integration helpers or tests of that commit do this). Record the counts of entries, assets and releases.',
    '3. Without resetting, apply the pending migrations from ' + sha + ': check that commit out and apply only the files origin/production lacks to the running slot-2 database (the stack tooling under tools/stack and the Supabase CLI\'s local "migration up"; never anything --linked). Expect exactly four: 20261112200000_media_library.sql, 20261112210000_media_library_delivery.sql, 20261112220000_nothing_checked.sql, 20261112230000_manual_order.sql. A different list is a failure. Record how long each took and any lock wait.',
    '4. Old code on the new database: check out origin/production again, leave the database alone, and have that code\'s worker build and deliver one more release. It must succeed.',
    '5. New code on the upgraded database: check out ' + sha + ', pnpm install, restart the slot-2 stack if supabase/templates or supabase/config.toml differ between the two commits. Run the integration tests that publish, deliver and preview with CMS_STACK_SLOT=2. Run pnpm db:test only if tools/db/test.mjs does not reset the database. Confirm the rows from step 2 are intact: the same counts, the old release still readable, an old asset has null caption, credit and thumbnail path, an old entry has a null order key.',
    'ok is true only if steps 3, 4 and 5 all hold. failures: each thing that did not hold, with the command and the first error. notes: the timings and the counts. head_sha is ' + sha + '.',
  ].join('\n'),
    { label: 'verify:rehearsal', phase: 'Verify', model: 'opus', agentType: 'general-purpose', isolation: 'worktree', schema: CHECK }),
  spec: (sha, round, prev, note) => agent('Read ' + HUB + '/docs/agents/CONTEXT.md (its last paragraph is for reviewers). Spec-compliance review. ' + scope(sha) + 'Check that the branch does exactly what WP1 says and nothing beyond it: the six merges in order, the five fixes, no other change of behaviour; that additive-and-forward-only holds literally for every migration production lacks; and that amended sentences in docs/architecture.md say what the combined code does.' + again(round, prev, sha, note) + tail(sha, 'Spec review'),
    { label: 'review:spec:' + round, phase: 'Verify', model: 'sonnet', agentType: 'cms-spec-reviewer', schema: REVIEW }),
  security: (sha, round, prev, note) => agent('Read ' + HUB + '/docs/agents/CONTEXT.md (its last paragraph is for reviewers). Security review; apply your checklist where relevant and mark the rest not applicable. ' + scope(sha) + 'Look hardest at: whether any object replaced by more than one migration lost a guard, a tenant join or a key on the way; tenant isolation of every function and view the new migrations touch; that the loopback-http image rule cannot deliver an http address on a hosted project now that L3 and A7 changed the same projection; grants and RLS after all three migrations run in order; and that success is never shown before its proof exists (spec 7.4) in the combined publish and unpublish paths.' + again(round, prev, sha, note) + tail(sha, 'Security review'),
    { label: 'review:security:' + round, phase: 'Verify', model: 'opus', agentType: 'cms-security-reviewer', schema: REVIEW }),
  quality: (sha, round, prev, note) => agent('Read ' + HUB + '/docs/agents/CONTEXT.md (its last paragraph is for reviewers). Code-quality review. ' + scope(sha) + 'Judge: that each conflict resolution keeps both sides\' behaviour and reads as one piece of code, not two pasted together; that generated files were regenerated, not hand-merged; that tests still pin behaviour and will not flake in CI; and that comments say what is true after the merge.' + again(round, prev, sha, note) + tail(sha, 'Review'),
    { label: 'review:quality:' + round, phase: 'Verify', model: 'sonnet', agentType: 'cms-quality-reviewer', schema: REVIEW }),
}
const REVIEWERS = ['spec', 'security', 'quality']
const BOUNDARY_RE = /^(supabase\/|apps\/cms\/src\/privileged\/|apps\/cms\/src\/proxy|packages\/schema\/src\/(module|projection)\.ts)/
const APP_RE = /^(apps\/cms\/(src|e2e)\/|modules\/|packages\/)/

let head = impl.head_sha
let prev = null
let note = ''
let want = { ci: true, browser: true, rehearsal: true, spec: true, security: true, quality: true }
const last = {}
const isFail = n => !!last[n] && (REVIEWERS.includes(n) ? last[n].verdict === 'FAIL' : !last[n].ok)
const out = (status, blocking, missing) => ({
  status, pr: impl.pr_url, branch: BRANCH, head, first_head: impl.head_sha,
  summary: String(impl.summary).slice(0, 1500), integration_commits: impl.integration_commits, conflicts_resolved: impl.conflicts_resolved,
  not_run: impl.not_run, open_choices: impl.open_choices, blocking, missing,
  checks: Object.fromEntries(Object.keys(last).map(n => [n, last[n] ? (REVIEWERS.includes(n) ? { verdict: last[n].verdict, head: last[n].head_sha, minors: last[n].minors } : { ok: last[n].ok, head: last[n].head_sha, failures: last[n].failures, notes: last[n].notes }) : null])),
})

for (let round = 1; round <= 3; round++) {
  const names = Object.keys(want).filter(n => want[n])
  log('round ' + round + ' on ' + head.slice(0, 7) + ': ' + names.join(', '))
  const got = await parallel(names.map(n => () => CHECKS[n](head, round, prev, note)))
  names.forEach((n, i) => { last[n] = got[i] || null })
  const missing = names.filter(n => !last[n])
  const blocking = []
  for (const n of names) {
    const r = last[n]
    if (!r) continue
    if (REVIEWERS.includes(n)) { if (r.verdict === 'FAIL') (r.blocking || []).forEach(b => blocking.push('[' + n + ' review] ' + b)) }
    else if (!r.ok) (r.failures || []).forEach(f => blocking.push('[' + n + '] ' + f))
  }
  if (blocking.length === 0 && missing.length === 0) return out('passed')
  if (round === 3) return out(blocking.length ? 'failed' : 'incomplete', blocking, missing)
  if (blocking.length === 0) {
    log('no findings, but did not return: ' + missing.join(', ') + '; running those again')
    want = Object.fromEntries(Object.keys(want).map(n => [n, missing.includes(n)]))
    continue
  }
  log('round ' + round + ': ' + blocking.length + ' finding(s), fixing')
  const fixed = await agent(CTX + SLOT1 + BOUNDARY + 'Fix round on ' + BRANCH + ' (' + pr + '). In your fresh worktree: git fetch origin; git checkout --detach origin/' + BRANCH + '; pnpm install. Fix exactly these findings and nothing else, with a test for each where one fits:\n- ' + blocking.join('\n- ') + '\nFor a browser failure judged "the spec is wrong", fix the spec; judged "the code is wrong", fix the code and say which PR\'s behaviour changed. Run the tests that cover your changes plus pnpm lint and pnpm typecheck; if you changed a migration or anything under apps/cms/src/privileged, also pnpm db:reset, pnpm db:test and the integration tests it touches. Push with git push origin HEAD:' + BRANCH + '. Do not wait for CI. Report the new full head sha as head_sha, a summary, and files_changed (every path your commits touched).',
    { label: 'fix:' + round, phase: 'Fix', model: 'opus', agentType: 'cms-implementer', isolation: 'worktree', schema: FIX })
  if (!fixed) return out('fix_failed', blocking, missing)
  if (fixed.blocked) return out('blocked', blocking.concat('[fix] ' + fixed.blocked), missing)
  const files = fixed.files_changed || []
  const boundary = files.some(f => BOUNDARY_RE.test(f))
  const app = files.some(f => APP_RE.test(f))
  want = {
    ci: true,
    browser: isFail('browser') || app || missing.includes('browser'),
    rehearsal: isFail('rehearsal') || boundary || missing.includes('rehearsal'),
    spec: isFail('spec') || boundary || missing.includes('spec'),
    security: isFail('security') || boundary || missing.includes('security'),
    quality: true, // always: its comment is the pass on the final head
  }
  prev = head
  head = fixed.head_sha
  note = blocking.join('\n- ')
}
