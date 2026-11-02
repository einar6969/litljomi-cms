# Decisions 18 and 19 (N1, N2): security review, round 2 (scoped)

- Reviewer: fresh `cms-security-reviewer` (Opus), 2026-11-02
- Changes: cef9a95, 1670c80, 87ad497 (`git diff 84b2899..87ad497 -- supabase/` empty: no migration or config change)
- Result: **PASS** (no checklist failure); Important 1 and Minors 2–7, 9–11 ADDRESSED; Minor 8 cleanup in, the two open choices left to Einar; new: 1 Important (N1), 6 Minor (N2–N7)

## Checklist (verbatim in substance)
1 pass (no function changed; Step 4b pins plpgsql, stable, not security definer, `search_path` `''`; catalog checks cover `api`, `cms`, `private`; `hook-as-tested.sql` schema-qualifies calls). 2 pass (`schemas = ["graphql_public"]`; the test rejects `[]`). 3 not applicable (no grants changed; Step 4b also rules out `service_role`, stricter and compatible with §4.5). 4–9, 11, 12 not applicable. 10 pass (no key, token or secret in the range; probes read keys from the environment). 13 pass (no contradiction; §4.4 and decision 18 agree). 14 pass.

## Verdicts
- Important 1 ADDRESSED: array, non-empty, none of `public`, `cms`, `private`; no override; no vacuous pass (workspace includes the file; missing file or section throws; `toBe(true/false)`). The reviewer ran the real test file against mutated configs: real config 5/5; each of `schemas = []`, `["graphql_public","public"]`, `schemas = "public"`, `enable_confirmations = false`, `enable_confirmations = "env(X)"`, `double_confirm_changes = false`, `double_confirm_changes` removed fails exactly 1 of 5.
- Minor 2 ADDRESSED (residual: N1). Minor 3 ADDRESSED (residual: N3). Minor 4 ADDRESSED. Minor 5 ADDRESSED. Minor 6 ADDRESSED in decision 18, partly in the runbook (N4). Minor 7 ADDRESSED and accurate: in GoTrue's schema `auth.refresh_tokens.session_id` references `auth.sessions(id) on delete cascade` (and `mfa_amr_claims`, SAML tables cascade), so `delete from auth.sessions;` revokes every refresh token; the Auth API rejects access tokens whose session is gone (`internal/api/auth.go:155`), PostgREST and Storage check only signature and expiry, so "until they expire" is the right upper bound; safe as written (caveats N2). Minor 8: cleanup added; recurring check not added; `secure_password_change` not decided (config.toml:229 still false). Minor 9 ADDRESSED. Minor 10 ADDRESSED (14 files byte-identical). Minor 11 ADDRESSED (cannot be checked against the chat).
- The controller's premise that scripts under docs/ are linted is wrong: `eslint.config.mjs` ignores `docs/**` and `tsconfig.json` includes only `tools/checks`.

## New findings (verbatim in substance)
- **N1 Important** (plan:572): Step 4b names no mixed `amr` case; a hook checking only the first element, or allowing if any element is allowed, passes every listed case; the "any" version would allow refresh and TOTP step-up for `[password, totp]`. Name `[otp, password]`, `[password, otp]`, `[password, totp]` as refused and run each `amr` case for both `token_refresh` and `totp`.
- N2 Minor (plan:511): "at most one hour" holds only if hosted `jwt_expiry` stays 3600; nothing verifies the revocation (e.g. `count(*) from auth.sessions` = 0); the cascade means the later "no `password` row" check covers only sessions after the revocation; whether the SQL editor role may delete from `auth.sessions` on hosted is unchecked (Task 28).
- N3 Minor (plan:572): the owner is not pinned (e.g. `postgres`); "reads no tables" and calling the hook as `supabase_auth_admin` are not pinned.
- N4 Minor (plan:512): the runbook's limitations list omits four that decision 18 lists; refer to the full list. The Admin API cannot clear a password, so delete the test account.
- N5 Minor (docs/verification/n1-probes/*.mjs): committed scripts use a secret key outside `privileged/` and `tools/cli`, are not linted, and do not check `API_URL` is local; a local-only check or a "do not run" header would close it.
- N6 Minor (process): the two open choices (recurring hosted check; `secure_password_change`) are not recorded as open items in state.json.
- N7 Minor (supabase-config.test.ts:16-43): only top-level sections are checked; a `[remotes.<branch>]` block, applied on `config push`, could override them on hosted; assert none exists, or that its values match.

## Controller rulings
- N1, N2, N3, N4, N7: applied as plan text (Task 4 Step 4b and Files; Task 3 runbook). N3's "reads no tables" is not made a test (not reliably testable); decision 18 keeps it as a property.
- N5: a "do not run except against a throwaway local stack" warning added to the probe README; the scripts stay byte-identical as evidence.
- N6: both choices recorded as open items for Einar in Task 2's notes.
