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
