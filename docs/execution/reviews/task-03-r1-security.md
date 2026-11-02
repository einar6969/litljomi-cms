# Task 3 (Hosted environments runbook): security review, round 1

- Reviewer: fresh `cms-security-reviewer` (Opus), 2026-11-02. Task 3 is not on the sensitive list; run because the runbook fixes hosted Auth configuration, secrets handling, the hook procedures (decisions 18, 20) and decision 21, and 27e3d3b changed the local Auth config.
- Changes: 27e3d3b, 2f5c62f (7e9aea2..2f5c62f)
- Result: **PASS** (no checklist failure); 3 Important, 10 Minor. Nothing hosted run; no stack started.

## Checklist (verbatim in substance)
1 not applicable (no SQL; the runbook says stop rather than move the function or change grants if the hooks page cannot select it). 2 pass (hosted exposes `api` only, removing `public` and `graphql_public`; forbids the custom-schema GRANT ALL recipe; expects 406 for `public`, `cms`, `private`, `graphql_public`; local bootstrap unchanged). 3 pass as relevant (hook grant checks match §4.5; "nothing else" not checked: Minor). 4–9, 11, 12 not applicable (line 404 states third-party cache withdrawal is best-effort). 10 pass (no secret patterns; `.env.example` values empty and tested; `.gitignore` covers `.env*`; `NEXT_PUBLIC_*` only URL and publishable key; secret key only in the CMS server environment and Einar's local CLI environment; sites get only `CMS_WEBHOOK_SECRETS` and non-secret values; SMTP credentials not in the CMS environment, tracked as an open item; the script sets no xtrace and writes no files; caveat F2). 13 pass (Standard Protection or none matches A15 and §7.4). 14 pass.

Commit 27e3d3b: only `secure_password_change` false → true; nothing else loosened (non-comment config compared); the test fails on false or missing; the runbook's decision 21 wording matches the verified behaviour exactly and is not overstated.

## Findings (verbatim in substance)
Important
- **F1** staging.md:197, 215, 234: H5 cannot catch the test account: the script's `trap cleanup EXIT` deletes the account before H5 runs, and deletion cascades to `auth.sessions` and `auth.mfa_amr_claims`, so a `password` row from H3 is gone and H5 returns 0 (on the first run no other account exists, so H5 checks nothing). Reverses the task's order (check, then delete). The script asserts nothing and exits 0 whether H3 is 403 or 200; detection rests on H1 and a person reading the output. Fixes: run H5 (or check the session's `amr`) before cleanup, assert codes and exit non-zero, keep the trap only for the failure path.
- **F2** staging.md:208 (also 212, 219–220, 225–226, 231): `admin()` passes `apikey` and `Authorization: Bearer` with the secret key on curl's command line (process listings, argument auditing); `-d "$(jq …)"` does the same for the test password, `token_hash` and the refresh token. Pass headers and bodies through stdin or file descriptors (`-H @…`, `--data @-`, `--config`).
- **F3** staging.md:297, 311 (approval boundary): creating `labak-hub-staging` from the LABAK repository installs the Vercel GitHub integration there; Vercel then builds previews for every branch, including LABAK `main`, and posts statuses or comments; G6.3 allows protection "disabled", making them public; this touches the LABAK repository beyond G7's scope ("never main") and is covered only under G6. Options: limit builds to `hub-integration`, require Standard Protection for all three projects, or deploy without the Git integration; state it under G7.

Minor
1. :187 vs :200, 305, 326, 414: who runs the secret-key steps is inconsistent (executor vs "Einar's machine"; agents cannot read `.env.local`: settings deny and sandbox); say who runs each; Task 29's "secret key from the local environment" needs the same answer.
2. :97: "Do not use `supabase config push`" is right, but the reason "without the hook block" will not hold after Task 4; the rule is behavioural only (`.claude/settings.json` has no `ask` rule for `supabase config push`, `supabase db reset --linked`, `supabase migration repair`) — for the controller to raise with Einar.
3. :45, 112: G3.5 requires "before any editor account exists" but checks nothing; sign-up is open until G3.4; do G3.4 right after G3.1 and check `count(*) from auth.users` = 0 at G3.5.
4. :132: the sign-up check would create a real account and send email if sign-up were on; use a throwaway address and delete any account.
5. :236: failure handling does not cover the window when the hook was off (review Auth logs for password grants, accounts with passwords, distrust tokens for `jwt_expiry`).
6. :161–169: H2 does not check that `supabase_auth_admin` has nothing else in `api`, `cms`, `private`, nor `prosecdef = false` or `proconfig`.
7. :317: no staging check that the internal worker route refuses a missing `x-cms-internal-secret`, or that a wrong cron bearer is refused.
8. :329: P-2 pipes the webhook secret into the CLI but Einar must enter the same value in Vercel; say how to carry it without a file, clipboard or history (`read -s`, then `unset`).
9. :348–349: GitHub Packages tokens: name the type and scopes (classic PAT `write:packages` / `read:packages` only, short expiry, publish token revoked after G2.5); Vercel environment variables are also available at runtime.
10. G2.2/G2.4: also check the repository's default workflow-token permission (read-only) and "allow Actions to create and approve pull requests" (off). (:311: the consequences of "disabled" vs Standard Protection are not stated — folded into F3.)

## Controller rulings
- F1: the script asserts every expected result and exits non-zero on any mismatch; it does not delete the account; H5 runs while the account still exists; deletion and H6 are a separate final step; on failure the account is kept as evidence until the failure handling deletes it.
- F2: the secret key, the test password and tokens never appear on a command line (curl reads headers and bodies from stdin or a config on stdin).
- F3: Standard Protection on all three Vercel projects (staging hostnames are their production domains, so A15 holds); builds limited to `hub-integration` for `labak-hub-staging`; connecting the LABAK repository to Vercel is stated under G6 and G7 as needing Einar's explicit approval at that gate, and listed as an open item.
- Minors 1, 3–10: applied in the runbook. Minor 1: every step that needs the secret key or another secret value is run by Einar (agents cannot read `.env.local`); the Task 29 wording is raised with Einar as an open item.
- Minor 2: the runbook keeps "do not use `supabase config push`" with a reason that stays true after Task 4; `ask` rules for risky hosted Supabase commands are a `.claude/**` change, raised with Einar, not applied.
