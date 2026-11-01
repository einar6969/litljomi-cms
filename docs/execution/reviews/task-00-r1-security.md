# Task 0 (Execution setup, revised): security review, round 1

- Reviewer: fresh `cms-security-reviewer`, 2026-11-01
- Change: `git diff 013a412..f9f7045` (f34f4fb: R1 + R2; f9f7045: R3 records)
- Result: **PASS**

## Checklist

1–9. Not applicable: the repository has no SQL, schemas, grants, tables, functions, commit path or release code yet.
10. Pass: no apps or `tools/cli`; no secret-shaped strings outside `docs/`; `.gitignore:2-3` ignores `.env*` except `.env.example`; the one `guard-log.jsonl` line holds no secret.
11–12. Not applicable: no live-check code or editor text yet.
13. Pass: `docs/architecture.md` unchanged in the range; the diff contradicts nothing in the spec.
14. Pass: Task 0, with Einar's approval of the design and `.claude/` diff. `.claude/settings.json` matches the task item by item (defaultMode, both disable flags, the 5 deny and 16 ask entries, the sandbox block); no `allow`, hooks, `mcp__`, `excludedCommands` or `additionalDirectories`. Keys exist in the installed Claude Code 2.1.278. Leading-`/` rules resolve to the repository root, so `Edit(/.claude/**)` covers `<repo>/.claude/**`. Agent tool lists: implementer `Read, Edit, Write, Bash, Grep, Glob`; reviewers `Read, Grep, Glob, Bash`; no MCP, browser or web tools. Nothing widens a permission beyond the task text.

Other checks: `state.mjs` changes only `cmdValidate` (`waived` passes the same evidence check); `start`, `done` and `checkpoint` unchanged. `gates.json`: G0 unchanged, G1–G7 pending, only `note` changed. Tests 16/16. The reviewer's own session reports the same sandbox configuration.

## Findings (non-blocking)

- `.claude/settings.local.json` (git-ignored, not in the diff): 7 `allow` rules not in the task text, including `Bash(git apply *)` and an exact `state.mjs commit 0 …` command, apparently from "don't ask again" answers. Not recorded in `environment.md`. Should be listed at the checkpoint or cleared by Einar.
- `docs/execution/environment.md` known limitations omit: (a) the unsandboxed retry is held back only by a prompt; (b) sandboxed Bash commands run with no prompt, so "permission prompts" cover `ask` rules, unsandboxed commands and connectors, not normal Bash; (c) sandbox reads are deny-only, so the machine is readable except listed paths, including `.env.*` variants other than `.env` and `.env.local`.
- `docs/execution/environment.md:87`: Claude Code 2.1.278 appears (binary strings, not a live test) to write-protect `.git/hooks`, `.git/config`, `.claude/agents`, `.claude/commands` and `.mcp.json` by default; the record leaves this unconfirmed.
- `docs/execution/environment.md:82,92`: V-SANDBOX rests on the reported configuration, as R3 allows; the write and network limits are not observed refusals. The Task 2 re-check should include a real refusal test.
- `tools/harness/state.mjs:300`: `waived` is accepted for every validation gate, including A1–A4 ("Stop: security boundary"); the plan defines waivers only for V-HARNESS and V-CONNECTORS. No enforcement reads validation gates, so this affects only what can be recorded. Design point for the controller.
- `.claude/settings.json:14-29` (matches the task text): the `ask` list does not cover other hosted `supabase` subcommands (`db pull`, `db dump --linked`, `migration repair`, `inspect --linked`, `branches`, `storage`, `gen types --project-id`); the network allowlist is the backstop.

`git status --porcelain` during the review showed only the parallel spec review's report, written by the controller.
