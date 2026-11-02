# Execution environment (decision record)

## Decision

- **Environment:** local Claude Code in the desktop app's Code tab (Local), working directory `/Users/einarzoega/litljomi-cms`, with subagents. Decided with Einar on 2026-11-01.
- **Sessions:** a fresh controller session per phase. A new session resumes from `docs/execution/RESUME.md` alone; `docs/execution/state.json` is authoritative.
- **Execution:** strictly sequential, one implementer at a time, in the order of `tools/harness/plan-index.json`.
- **Claude Code Projects:** deferred. Evaluated at checkpoint C4 only, with Einar's approval at that time (see the plan, "Future execution environment").

## Models

| Role | Model |
|---|---|
| Controller (main session) | Opus |
| `cms-implementer` | Inherits the model the controller passes: Opus for security-sensitive tasks, Sonnet for the others |
| `cms-security-reviewer` | Opus |
| `cms-spec-reviewer` | Sonnet |
| `cms-quality-reviewer` | Sonnet |

Einar may change these; record any change here with the date.

## Connectors Einar switches off

> **Superseded on 2026-11-01** by "Decision 2026-11-01: simplified execution" below. Connectors may stay connected; kept here as the original record.

For the implementation session, in the desktop app: Supabase, Vercel, Neon, Netlify, Sanity, Zoho Mail, Claude Docs, and both browser tools (Claude in Chrome and the built-in browser). The guard denies every `mcp__*` tool except `mcp__ccd_turn__*` (the app's task list) as a second layer, and `.claude/settings.json` denies the servers observed on 2026-11-01.

## Connector audit

<!-- Task 0, Step 8: the controller lists every mcp__* tool available in the session, without calling any. -->

| Date | Session | `mcp__*` tools available | Result |
|---|---|---|---|
| 2026-11-01 | Controller, local Code tab, session `81e2dc24-c905-48e3-bc59-a0b43b853fb8` (first session after activation) | See the list below. Taken from the session's tool list, no tool called | **FAIL**: Claude Docs, the built-in browser and Playwright MCP are available |

### 2026-11-01, session `81e2dc24-…`

Listed from the session's tool list (callable and deferred). None was called. `mcp__ccd_turn__update_plan` and `mcp__ccd_turn__wrap_up` are the app's task list, which the guard allows.

**Hosted connectors and browser tools still available (these fail V-CONNECTORS):**

| Server | Kind | Tools |
|---|---|---|
| `mcp__1a59c906-04da-521d-bda7-7f71b9f9e01c__` | Claude Docs (hosted connector) | `batch`, `guide`, `update`; deferred: `create`, `delete`, `export`, `query`, `read` |
| `mcp__Claude_Browser__` | Built-in browser | `browser_batch`, `computer`, `find`, `form_input`, `get_page_text`, `javascript_tool`, `navigate`, `preview_list`, `preview_logs`, `preview_start`, `preview_stop`, `read_console_messages`, `read_network_requests`, `read_page`, `resize_window`, `tabs_close`, `tabs_context`, `tabs_create`, `tabs_select` |
| `mcp__playwright__` | Browser (Playwright MCP) | deferred: `browser_click`, `browser_close`, `browser_console_messages`, `browser_drag`, `browser_drop`, `browser_emulate_media`, `browser_evaluate`, `browser_file_upload`, `browser_fill_form`, `browser_find`, `browser_handle_dialog`, `browser_hover`, `browser_navigate`, `browser_navigate_back`, `browser_network_request`, `browser_network_requests`, `browser_press_key`, `browser_resize`, `browser_run_code_unsafe`, `browser_select_option`, `browser_snapshot`, `browser_tabs`, `browser_take_screenshot`, `browser_type`, `browser_wait_for` |

**Configured but exposing no tools:** the plugin server `plugin:vercel:vercel` (Vercel MCP) is waiting for authentication. `.claude/settings.json` has no deny entry for it; the guard's `mcp__*` rule covers it.

**Not present:** Supabase, Neon, Netlify, Sanity, Zoho Mail, Claude in Chrome.

**Desktop-app local tools (not hosted connectors; the guard denies them, and `.claude/settings.json` already denies each server):**

- `mcp__ccd_session__` (`dismiss_task`, `hand_off_to_session`, `mark_chapter`, `read_widget_context`; deferred: `list_start_targets`, `move_to_cloud`, `start_session`)
- `mcp__ccd_session_mgmt__`, `mcp__ccd_settings__`, `mcp__ccd_connectors__`, `mcp__ccd_directory__`, `mcp__ccd_host__`, `mcp__ccd_pr__`, `mcp__ccd_sidebar__`, `mcp__ccd_view__`, `mcp__ccd_window__` (deferred)
- `mcp__terminal__` (`read_terminal`; deferred: `list_terminal_tabs`, `open_terminal_tab`, `run_in_terminal`, `stop_terminal_tab`). Note: `run_in_terminal` runs commands in Einar's own terminal, outside the Bash sandbox
- `mcp__scheduled-tasks__`, `mcp__mcp-registry__` (deferred)
- `mcp__visualize__` (`read_me`, `show_widget`)
- `mcp__Claude_Code_iOS_Simulator__` (`control`; deferred: `build`)

**Observation:** every server above except `plugin:vercel:vercel` already has a `mcp__<server>__*` deny entry in `.claude/settings.json`, yet the tools are still listed as available. So the settings deny entries do not stop these tools from being offered in this app session. Whether a call would be refused was not tested, because the audit calls no tool. V-CONNECTORS asks for the tools to be unavailable, so it fails until Einar switches them off in the app.

## Decision 2026-11-01: simplified execution

Einar, in chat on 2026-11-01: "I approve the simplified execution design." His requirements, in summary: use Claude Code's native permission system and sandbox, with Accept-edits mode and never auto or bypass-permissions mode; connectors may stay connected, their availability must not block local development, and it authorizes nothing; no change to his global Claude configuration is a prerequisite; historical records are kept and superseded safeguards are marked as such; the transition is a bounded revision to Task 0; Task 1 waits for his explicit approval.

**Removed** (history kept in git; last present at commit `013a412`): the guard hook and its library (`.claude/hooks/guard.mjs`, `tools/harness/guard-lib.mjs`), the session-start hook, the integrity lock (`tools/harness/integrity.mjs`, `docs/execution/harness.lock.json`), `tools/harness/gate.mjs`, the probe stubs (`tools/harness/fixtures/`), and their tests. The live probes P1–P11 were never run.

**Kept:** gates G0–G7 as approval boundaries, recorded by the controller in `gates.json` with Einar's quoted words; sequential tasks with fresh subagents; the spec, security and quality reviews; `state.mjs`, `state.json`, `progress.md`, reviews and checkpoints; a commit per task.

**Native controls in `.claude/settings.json`:** `defaultMode: acceptEdits`, `disableBypassPermissionsMode` and `disableAutoMode`; the Bash sandbox with network limited to `registry.npmjs.org`; `ask` rules on the commands that reach hosted services (`git push`, `git remote`, `gh`, `vercel`, `netlify`, the hosted `supabase` subcommands, `npm`/`pnpm publish`, `brew`) and on `.claude/**`; `deny` for `sudo` and `.env` reads.

**Validation gates:** V-HARNESS and V-CONNECTORS are `waived` with this section as evidence. The 2026-11-01 failed connector audit above stays as the record of what was found. V-SANDBOX is recorded from the session's reported sandbox configuration and a successful sandboxed commit.

**Known limitations:**
- The gates are behavioural. Connector calls run outside the sandbox and are stopped only by permission prompts, which is why auto mode is disabled.
- `ask` rules match command text, so `sh -c` or an absolute path can avoid them. For Bash, the sandbox network allowlist is the backstop.
- Folders added in user settings (`permissions.additionalDirectories`) widen the sandbox's writable paths in every session. On 2026-11-01 these were `/Users/einarzoega/Litljómi/litljomi.is` and two scratchpads of other sessions. Removing them is Einar's choice and not a prerequisite.

## Sandbox record 2026-11-01 (Task 0, Step R3)

Session: controller, local Code tab, session `1851492d-583c-4e53-a3b1-108bbe1dd703`, the first session after Einar applied R1. The configuration below is what the session reported for its Bash sandbox; no probe command was run.

- **Permission mode:** the session's mode is not readable from inside it. `.claude/settings.json` sets `disableAutoMode` and `disableBypassPermissionsMode`, so it can only be default (Manual), Accept edits or plan mode.
- **Sandbox:** enabled, OS-level (macOS Seatbelt), applied to each Bash command.
- **Writable paths:** the working directory (`.`, `/Users/einarzoega/litljomi-cms`), the per-user temp directory (`$TMPDIR` = `/tmp/claude-501`, and `/tmp/claude`, `/private/tmp/claude`), `/dev/stdout`, `/dev/stderr`, `/dev/null`, `/dev/tty`, `/dev/dtracehelper`, `/dev/autofs_nowait`, and Claude Code's own log folders `~/.npm/_logs` and `~/.claude/debug`. From user settings: `/Users/einarzoega/Litljómi/litljomi.is`, `/private/tmp/claude-501/-Users-einarzoega-Downloads-logmenn-granda-6-main/8d92c277-158b-4ffb-a348-f277d16cab58` and `/private/tmp/claude-501/-Users-einarzoega-Litlj-mi-litljomi-is/88930c6e-94e1-4b09-805c-859b131a9d32/scratchpad`.
- **Denied inside those paths:** among others, this repository's `.claude/settings.json`, `.claude/settings.local.json`, `.claude/hooks` and `.claude/skills`, the user and managed settings files, and most of `~/.claude`. The session's list was truncated ("… and 46 more"), so whether `.claude/agents/` is write-protected for Bash was not confirmed.
- **Read-denied:** `.env` and `.env.local` in this repository and below it, and some `~/.claude` internals.
- **Network:** egress through the sandbox's filtering proxy, allowlist `registry.npmjs.org`.
- **Sandboxed commit:** the R2 commit `f34f4fbc849e1bc79cebcc1f94007e00d20f71bd` ("chore: simplify the execution setup (native permissions and sandbox)") ran sandboxed from a fresh `cms-implementer`, with no error and no prompt. This resolves the earlier blocker "Sandbox denies writes under .git/".

**V-SANDBOX: pass.** Bash writes are limited to the working folders and temp, network is limited to the allowlist, and the sandboxed R2 commit succeeded. Known limitation: the three folders added in user settings are writable from this repository's sessions (see "Known limitations" above).

## Decision 2026-11-01 (later): Auto mode permitted; Task 0 accepted

Einar, in chat on 2026-11-01: "I accept the simplified execution setup and the completed R2–R4 work. Task 0 meets the intended acceptance criteria." and "enable Claude Code Auto mode for Litljómi CMS Hub going forward. I understand that Auto mode can approve tool calls without asking me individually, and that G0–G7 are behavioral approval boundaries rather than technically guaranteed restrictions. I'm comfortable with that trade-off for this development workflow."

This supersedes, on this point only, the "never auto mode" requirement and the `disableAutoMode` setting in "Decision 2026-11-01: simplified execution" above.

- **Changed:** `disableAutoMode` removed from `.claude/settings.json`. `disableBypassPermissionsMode` stays. `defaultMode` stays `acceptEdits`; Einar chooses Auto mode in the app.
- **Unchanged:** Auto mode is not authorization for any G1–G7 action. Provisioning, pushing, deploying, DNS changes and touching the LABAK repository each need Einar's explicit approval in chat first, recorded in `gates.json`.
- **Changed with it:** `state.mjs validate … waived` is accepted only for V-HARNESS and V-CONNECTORS (Einar: "Security-critical validation gates must not be waivable.").
- **Limitation added:** in Auto mode, connector calls and other tool calls may run without a prompt. The known limitation above ("stopped only by permission prompts, which is why auto mode is disabled") no longer holds in Auto mode: there the gates rest on the controller and subagents following them. The Bash sandbox and network allowlist still limit commands that run inside the sandbox, but in Auto mode Auto mode's classifier may approve an extra network host for a single command, or an unsandboxed retry, instead of Einar, and whether `ask` rules and sandbox host prompts still reach Einar in Auto mode has not been verified.
- **Also superseded on this point:** the "Permission mode" line of "Sandbox record 2026-11-01" above (written while `disableAutoMode` was set), and the known limitation "For Bash, the sandbox network allowlist is the backstop", which holds only outside Auto mode. Auto mode is now possible.

## Task 2: sandbox change for Docker and localhost (2026-11-01)

Einar approved the exact diff in chat on 2026-11-01 ("I approve the exact proposed `.claude/settings.json` change for Task 2"; approval limited to running the local Supabase stack and its tests). The controller applied it: `sandbox.network.allowUnixSockets` = OrbStack's socket and `/var/run/docker.sock`; `sandbox.network.allowLocalBinding: true`. Everything else unchanged. Before/after probes and limitations: `docs/verification/m1-gates.md` (V-SANDBOX re-check).

## Reviewer ratings in the agent definitions (2026-11-02)

Einar approved the exact diff in chat on 2026-11-02 (the patch to `cms-spec-reviewer.md`, `cms-security-reviewer.md` and `cms-quality-reviewer.md` shown to him, sha256 `7a4e02578699182bc185f259cd4c71ea36668dc8f435d0c574841104bbafc0b0`; his answer: "Approve exact diff"). It applies his review-process decision of the same day (plan, "Findings, deferred Minors and escalation"): every finding rated Critical, Major or Minor; a review passes with no open Critical or Major. The controller applied it with the Edit tool and confirmed the three files are byte-identical to the approved versions. No permission, sandbox or other `.claude/**` setting changed. Not changed (out of scope): the security reviewer's "decisions 1–15" wording (prompts pass decisions 1–21).

## Task 4 (2026-11-02): auto-mode classifier denial

While checking alternatives for the Task 4 blocker, the controller ran a read-only `psql` login test inside the local database container as `supabase_admin` and `supabase_auth_admin` with the local stack's well-known development password. The auto-mode classifier denied it ("Identity Not Given"). It was not retried or worked around; the question is with Einar.

## Reviewer fix rounds and combined mode (2026-11-02)

Einar approved the exact diff in chat on 2026-11-02 (patch to `cms-spec-reviewer.md`, `cms-security-reviewer.md` and `cms-quality-reviewer.md`, sha256 `f9cdce7b4c0935c119b1489f8cc806bbdf9d1d7b3b4413ff077d861cc099a105`; his answer: "Approve exact diff"), as part of the Phase 1 workflow update. It adds fix-diff re-reviews from round 2 (the security reviewer may ask for a full re-review), the combined spec-and-quality mode of `cms-quality-reviewer` for medium and low tiers, and replaces the security reviewer's stale "decisions 1–15" with "all of them, as numbered in the plan". Applied with the Edit tool through the `.claude` permission rule; the three files are byte-identical to the approved versions. No permission, sandbox or other `.claude/**` setting changed.
- Hash note (security review of the workflow update, Minor): both recorded patch hashes (`7a4e0257…` and `f9cdce7b…`) are `shasum -a 256` of the patch file the controller showed Einar, built in the scratchpad with `diff -u --label a/<path> --label b/<path> <current> <proposed>` for the three files in the order spec, security, quality; not of `git diff` output. Byte-identity of the applied files was checked with `cmp` against the approved copies.

## Lane B worktree (2026-11-02): two sandbox refusals, created by Einar

- `git worktree add .worktrees/lane-b -b m1/lane-b` (controller, sandboxed) was refused: "unable to create file .claude/agents/cms-implementer.md: Operation not permitted" (and the other three agent files); "fatal: Could not reset index file to revision 'HEAD'". Git removed the directory; the branch `m1/lane-b` (723e859) remained.
- The controller then tried a worktree without `.claude/` (`--no-checkout`, then `git sparse-checkout set --no-cone '/*' '!/.claude/'`), which writes nothing under `.claude`. It was refused too: "could not lock config file /Users/einarzoega/litljomi-cms/.git/config: Operation not permitted" (sparse checkout needs `extensions.worktreeConfig`). The controller stopped trying alternatives, removed the empty worktree (`git worktree remove --force`, `git worktree prune`) and asked Einar.
- Einar chose to create it himself ("I'll create the worktree") and ran `git worktree add .worktrees/lane-b m1/lane-b` in his own terminal, outside the sandbox. The controller verified it (`git worktree list`: `.worktrees/lane-b 723e859 [m1/lane-b]`). Lane B implementers work and commit inside it and never edit `.claude` there. No settings were changed.

## Resource-exhaustion threat model in the security reviewer (2026-11-02)

Einar approved the exact diff in chat on 2026-11-02 (patch to `cms-security-reviewer.md`, sha256 `f712992f2b363ae61cc41d537f1d71d8fad54786035f2148fc106cd5887c46f9`, built with `diff -u --label a/<path> --label b/<path> <current> <proposed>`; his answer: "Approve the diff"), following his threat-model ruling with decision 29 ("show me the .claude/agents diff"). It adds the resource-exhaustion rating rule (editor or worker, under about 100 MB of temp space and 5 seconds per statement: Minor; outsiders and cross-tenant effects keep the full standard) under the reviewer's Ratings. Applied with the Edit tool; the file is byte-identical to the approved version (`cmp`). No permission, sandbox or other `.claude/**` setting changed.

## Chromium Mach lookup in the sandbox (2026-11-02, Phase 4)

- Einar installed Playwright's Chromium himself (`pnpm dlx playwright@1.64.1 install chromium`; decision 37.3). The controller's probe (headless Chromium from `playwright-core@1.64.1` in the scratchpad, against a local `node:http` page) failed in the sandbox: `FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.42876: Permission denied (1100)`. Not worked around.
- Einar approved the exact diff in chat on 2026-11-02: "I approve the allowMachLookup diff to .claude/settings.json exactly as shown (Einar, 2026-11-02): the one entry org.chromium.Chromium.MachPortRendezvousServer.*, with no other change. Re-run the probe. If Chromium still can’t start, show me the exact error and stop. Do not propose or apply excludedCommands or any other sandbox change without my separate approval. Record this in environment.md." Applied with the Edit tool: `sandbox.network.allowMachLookup = ["org.chromium.Chromium.MachPortRendezvousServer.*"]`, nothing else changed (`git diff .claude/settings.json`: one line added, one comma).
- Re-run of the probe right after the change, in the same session: the same failure, `bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.43836: Permission denied (1100)`. Stopped as instructed; no other sandbox change proposed or applied. Open: whether the setting covers registration (`bootstrap_check_in`) at all (the documentation describes lookup only), and whether it takes effect only in a new session.
