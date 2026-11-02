# Decisions 18 and 19 (N1, N2): security review, round 3 (scoped to plan text, 1b00597)

- Reviewer: fresh `cms-security-reviewer` (Opus), 2026-11-02
- Result: **PASS**; N1–N7 ADDRESSED as ruled; 3 new Minor (M1–M3)
- No code, migration, config or `.claude/**` change in 1b00597 (`git diff 87ad497..1b00597 -- supabase/ apps/ tools/ .claude/` empty).

Checklist: 1 pass (Step 4b keeps plpgsql, stable, not security definer, `search_path` `''`); 2 pass (no config change; the `[remotes.*]` assertion further protects hosted exposure); 3 pass (owner `postgres`, grantees exactly `postgres` and `supabase_auth_admin` via `aclexplode`; stricter than and compatible with §4.5); 4–9, 11, 12 not applicable; 10 pass; 13 pass (one weakening reported as M1, not a contradiction); 14 pass.

Verdicts (verbatim in substance): N1 ADDRESSED (each `amr` case for both `token_refresh` and `totp`; first-only, any-element and last-only implementations each fail a listed case; the tested hook passes all). N2 ADDRESSED (cascade stated; `count(*) from auth.sessions` = 0 and the role's delete permission checked before relying on it; old access tokens bounded by `jwt_expiry` kept at 3600, matching config.toml:166; the later no-`password`-row check correctly scoped). N3 ADDRESSED as ruled (owner pinned; cases also run after `set local role supabase_auth_admin`; "reads no tables" stays a property). N4 ADDRESSED (runbook refers to decision 18's full list; its six named items match; delete the test account, since GoTrue's admin update cannot clear a password). N5 ADDRESSED (README warning accurate; small omission: OTP and magic-link requests against a hosted project would also send real email; covered by "do not run"). N6 ADDRESSED (state.json Task 2 notes; `secure_password_change` still false). N7 ADDRESSED (`[remotes.x]` parses to a top-level `remotes` key; none exists; no hosted push before Task 28).

New findings
- M1 Minor (plan:572): the new text replaced "any method outside the allowlist" with password cases, so no listed `amr` case has a method that is neither email nor password (`[oauth]`, `[sso/saml]`, `[anonymous]`); a hook refusing only `password` would pass. Restore e.g. `[oauth]`, `[otp, oauth]` for both methods.
- M2 Minor (plan:572, unverified): `set local role supabase_auth_admin` assumes the `supabase test db` role is a member of `supabase_auth_admin`; never exercised; if denied, the implementer should stop and report rather than weaken the check.
- M3 Minor (state.json Task 2 notes): an earlier sentence still says "OPEN for Einar: N1 …" although N1 is decided later in the same notes.

## Controller rulings (applied directly; they restore or clarify reviewed text)
- M1: refused `amr` cases now include `[oauth]`, `[sso/saml]`, `[anonymous]` and `[otp, oauth]`, for both methods.
- M2: Step 4b says to stop and report if the role switch is not permitted, rather than drop the check.
- M3: the earlier N1 sentence in Task 2's notes is marked superseded.
