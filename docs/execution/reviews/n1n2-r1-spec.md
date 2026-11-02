# Decisions 18 and 19 (N1, N2): spec review, round 1

- Reviewer: fresh `cms-spec-reviewer` (Sonnet), 2026-11-02
- Changes: A = spec and plan amendments 3df8e09 (controller); B = Task 2 configuration correction 84b2899 (implementer)
- Checked against Einar's approval in chat on 2026-11-02 (N1 and N2)
- Result: **PASS** (3 Minor)

Report (verbatim in substance):

Change A
- Plan decision 18 (line 216) matches the N1 approval and the investigation SQL: method allowlist; fail-closed `amr` rule (non-empty array of objects, every method in the allowlist including `totp`); 403 body; `plpgsql stable`, SECURITY INVOKER, `search_path = ''`, `private`; grants for `supabase_auth_admin` only; config section and URI; placement in Tasks 4, 12, 3 (executed in 28) and 29; "no other authentication service"; evidence citations; all listed limitations (password creation possible, 403/400 oracle, hosted activation checked on every project, sessions signed out on first enable, and the rest).
- Lines 217–218: decision 17 correction and decision 19 record the security correction and the wrong earlier wording; line 455 updates Task 2's config list.
- Task 2 correction (lines 482–491, Steps C1–C4) matches the brief; Task 3 carries confirmations, the hook setup, first-enable sign-out, the 403/magic-link/`amr` verification and the limitations; Task 4 carries the migration, config section and `012_auth_hook.test.sql` (nothing implements the hook now: no hook migration, no `[auth.hook]` change); Task 12's `auth-passwordless.test.ts` covers the five regression areas; Task 29 item 11 covers the hook, the 403, no `password` row and the email change.
- Global constraint and reviewer scope ("decisions 1–19") consistent.
- docs/architecture.md:7, 186, 232–233, 277, 659: revision row and §4.2, §4.4, §4.5, §11.2 edits accurate to the investigation; the grant documented and nothing else changed; no plan/spec contradiction; "No passwords in v1" still stands beside the enforcement bullet.
- The 14-item checklist is consistent without a 15th item (decision 18, Task 4 Step 4b and the "decisions 1–19" scope cover it).
- Minor: Task 4 Step 4b ends with "Also address the parked Task 2 security r4 Minor…", which was not part of the N1 approval; it is the existing parked item that state.json says is due in Task 4 at the latest, so it is traceable.

Change B
- tools/checks/__tests__/supabase-config.test.ts asserts exactly the C1 list (`[auth] enable_signup=false`; `[auth.email]` `enable_signup`, `enable_confirmations`, `double_confirm_changes` true; TOTP enroll and verify true; `[api] schemas` contains none of `public`, `cms`, `private`); smol-toml; path from `import.meta.url`; the schemas check stays valid when Task 4 sets `["api"]`; each test names its setting.
- supabase/config.toml:228: the only change is `enable_confirmations` false → true; `double_confirm_changes` untouched.
- package.json and pnpm-lock.yaml: `smol-toml ^1.9.1`; exactly the four files C-R5 allows.
- Minor: package.json:6-8, pnpm expanded the `engines` line to three lines (semantically identical, tool-generated).
- Minor: the C3 evidence lives in the controller's check and the implementer's report; the commit holds only the code, as C4 requires.

Commands: `git show --stat`; read both diffs and the brief; greps over the investigation, spec and plan; `git status --porcelain` (only the controller's files). Suites not re-run; the controller's results relied on.

## Controller notes
- The Task 4 Step 4b line about the parked Minor records an item already parked in Task 2's notes (security r4); it does not extend N1. Kept as a pointer.
- Minors 2 and 3: no change.
