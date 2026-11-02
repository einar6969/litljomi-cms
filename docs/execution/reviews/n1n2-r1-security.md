# Decisions 18 and 19 (N1, N2): security review, round 1

- Reviewer: fresh `cms-security-reviewer` (Opus), 2026-11-02
- Changes: A = spec and plan amendments 3df8e09; B = Task 2 configuration correction 84b2899
- Result: **PASS** (no checklist item fails); 1 Important, 10 Minor

## Checklist (verbatim in substance)
1 pass (no function added; spec and decision 18 require INVOKER and `search_path = ''`; Task 4's catalog test covers every function in `api`, `cms`, `private`; appendix SQL schema-qualifies every call). 2 pass (`schemas = ["graphql_public"]`; the hook only in unexposed `private`; see Important 1). 3 not applicable to implementation; docs consistent: §4.5 adds only `supabase_auth_admin` USAGE on `private` and EXECUTE on the one function, revoked from PUBLIC, anon, authenticated. 4–9, 11, 12 not applicable. 10 pass (no keys in either commit; check scripts read keys from the environment; transcripts redacted). 13 pass (no contradiction; decision 18 narrower than §4.4's wording but compatible). 14 pass (no `.claude/**`).

Decision 18 compared with the investigation's appendix SQL and the throwaway migration: every property carried over, none weakened (allowlist; `token_refresh`/`totp` need a non-empty array of objects whose every method is an email method or `totp`; exact 403 body; plpgsql, stable, INVOKER, `search_path = ''`, `private`, reads no tables; the three grant statements; config section and URI); the probe-only claim correctly excluded. Decision 18 alone is precise enough for Task 4.
§4.5 grants `supabase_auth_admin` nothing beyond what the hook needs.
Change B: only `enable_confirmations` false → true (config.toml:227); `double_confirm_changes` true (:225); SMS unchanged (:262); nothing loosened; smol-toml 1.9.1 with integrity hash, no install scripts; the test catches either email setting being turned off or removed.

## Findings (verbatim in substance)
Important
1. supabase-config.test.ts:35-40 (and plan:488): the exposure assertion "contains none of public, cms, private" accepts `schemas = []`, which makes PostgREST fall back to exposing `public` (decision 17 F2) — the regression that already happened once. Require a non-empty list, or assert the exact value.

Minor
2. Task 4 Step 4b test list: allowed result should return the incoming claims unchanged; exact 403 body; name `mfa/recovery_code`, `mfa/webauthn`, `mfa/phone`, `passkey`; positive refresh cases; malformed shapes spelled out; `stable`/`plpgsql`; `search_path` pinned to `''`.
3. Grant test: grantees exactly `supabase_auth_admin` (and owner) via `aclexplode`, `service_role` not covered; nothing else for `supabase_auth_admin` in `api`, `cms`, `private`. (Optional design note: a dedicated hook schema would scope USAGE more tightly.)
4. Task 4 does not extend supabase-config.test.ts to assert the hook is enabled with its URI.
5. architecture.md:232: "every method in the session's `amr` is one of these" can be read loosely; decision 18 is exact.
6. Limitations omitted: 2-second timeout and failing closed; refused attempts only in the Auth logs; `user_banned`/`email_not_confirmed` disclosure; a config push switching the hook off; `secure_password_change = false` letting a session holder revoke the editor's other sessions — neither listed nor decided.
7. Signing everyone out stops refresh but not access tokens already issued (up to `jwt_expiry` 3600); the runbook does not say how to sign everyone out.
8. Detecting the hook being off is point-in-time only; no recurring check (e.g. alerting on `password` rows in `auth.mfa_amr_claims`); the runbook should remove the test editor's password or account after the check.
9. Task 12 list: email change confirmed only from the old address, email change over PKCE, `/reauthenticate`, a later magic-link sign-in being `aal1`.
10. The probes Tasks 4 and 12 reproduce live only in the ephemeral scratchpad (decision 15).
11. Decisions 18 and 19 and the Task 3 unblock do not quote Einar's words.

## Controller rulings
- Important 1: fix in a fresh implementer round; the test requires a non-empty list containing none of `public`, `cms`, `private`; plan Step C1 amended to match.
- Minors 2, 3, 4, 7, 9: plan text sharpened in Tasks 3, 4 and 12 (within the approved requirements: stronger tests and runbook steps for the same decisions).
- Minor 5: spec wording made exact ("one of these email methods or `totp`").
- Minor 6: limitations added to decision 18 and the Task 3 runbook; `secure_password_change` listed as a limitation and raised with Einar as an open choice (not decided by the controller).
- Minor 8: runbook cleanup of the test editor added; a recurring hosted check is new scope and is raised with Einar (not added).
- Minor 10: the probes are copied unchanged into `docs/verification/n1-probes/` with a README.
- Minor 11: decisions 18 and 19 now quote Einar's words; the Task 3 unblock is noted in state with his words.
- Optional dedicated hook schema: not adopted; Einar approved the unexposed `private` schema.
