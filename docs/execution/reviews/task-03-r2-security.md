# Task 3 (Hosted environments runbook): security review, round 2 (scoped to fix round 1)

- Reviewer: fresh `cms-security-reviewer` (Opus), 2026-11-02
- Change: 771127c (`docs/runbooks/staging.md` only)
- Result: **PASS** (no checklist failure); F1, F2, F3 and ruled Minors 1–10 ADDRESSED; new: 2 Important (N1, N3), 6 Minor (N2, N4–N8)
- Method: the section 7.2 scripts extracted to the scratchpad (`t3r2sec/`), `bash -n`, then run under /bin/bash 3.2 against a stub server on 127.0.0.1 with wrappers logging the argv of `curl`, `jq` and `openssl`; nothing hosted contacted.

## Checklist (verbatim in substance)
1 not applicable (checks expect `prosecdef = false`, `search_path=""`). 2 pass (`api` only; 406 for `public`, `cms`, `private`, `graphql_public`). 3 pass as relevant (grant checks match §4.5; "nothing else" checks added; grants never changed by hand). 4–9, 11 not applicable. 10 pass (no secret patterns; argv log: 0 matches for the key, tokens or any of 7 generated passwords; only `curl --config -`, jq filters, `openssl rand -base64 24`; caveats N1, N4). 12 pass (line 591). 13 pass (Standard Protection leaves production domains unprotected: satisfies A15 arch:644, §7.4 arch:506/601, plan:529/1524). 14 pass.

## Round 1 verdicts
- F1 ADDRESSED: part 1 has no trap and does not delete; H5 runs while the account exists and needs at least 1 row; failure keeps the account as evidence. Dry runs: normal exit 0; hook off (H3 200 with tokens) FAILED exit 1 without printing tokens; `expires_in` 7200 FAILED; refresh 400 FAILED; wrong `redirect_to` with `EXPECT_REDIRECT` FAILED; verify 502 HTML FAILED (jq prints only a parse error); connection error exit 7 via `set -e`. Part 2 deletes, prints 200 (ok), rejects `../users`; a leftover account blocks the next part 1 run.
- F2 ADDRESSED: headers, URL and body via `--config -` from builtin `printf` with values as arguments (a key containing `%s`/`%d` arrived intact); bodies built by jq from stdin; escaping round-trips (e.g. `a"b\c%d`); script variables not exported; the sign-up check pipes its password.
- F3 ADDRESSED: Standard Protection on all three projects; `hub-integration`-only builds via an Ignored Build Step with the correct exit-code sense, stop if absent, verified; explicit approval at G6 and G7 (lines 22, 52, 469, open item 604); integration limited to selected repositories.
- Minors 1–10 ADDRESSED as ruled (Minor 2: reason holds after Task 4; `ask` rules an open item).

## New findings (verbatim in substance)
- **N1 Important** staging.md:247-251: `. ./.env.local` executes the file as shell code in a shell holding the secret key. `.claude/settings.json` denies only `Read` of `.env*`, not Edit or Write, and the repository root is sandbox-writable for agents (write not attempted). Anything that can append could run code in Einar's unsandboxed shell, or add a later `NEXT_PUBLIC_SUPABASE_URL=` so the scripts send the secret key to that host; the scripts never check the target. Malformed values would be executed or expanded. Fix: read only the three needed names without executing the file; assert the URL is `https://<project-ref>.supabase.co` before any request; print the target host. An Edit/Write deny for `.env*` is a `.claude/**` change for Einar.
- **N3 Important** staging.md:20, 22, 468: nothing checks whether the existing Vercel project `landssamband-bakarameistara` is connected to the LABAK repository through the Git integration; if so, every `hub-integration` push (G7, G2.5) builds a preview inside it with its environment and posts statuses, conflicting with "never the existing Vercel project" (plan:55). Confirm at execution time, before the first push; stop and report if it would build other branches.
- N2 Minor: `.env.local` may point at the local stack; then part 1 tests the local stack (caught only by H5's "at least 1"), part 2 deletes locally and H6 passes vacuously; N1's URL assertion fixes it.
- N4 Minor (:86, 93): publish and read tokens "for that command only" without a method; apply P-2's `read -rs` / subshell / `unset` pattern.
- N5 Minor (:14, 122, 181-225): the executor in the dashboard and SQL editor (as `postgres`) can see the API keys page and `vault.decrypted_secrets`; state that the executor never reveals the secret key there and runs only the queries given.
- N6 Minor (:273-289, 324-334): after a curl transport error `set -e` aborts with only curl's message (no FAILED line, no evidence hint; the id printed only if the account was created); the refresh runs even when verify failed (no body; jq parse error). No leak; exit still non-zero.
- N7 Minor (plan:55, Task 27): G7 is approved at Task 27, before G6; neither the G7 row nor Task 27 mentions the Vercel connection; open item 604 does not say to raise it at Task 27's G7 request or re-request G7 at Task 28.
- N8 Minor (:202-212): `has_table_privilege` misses column-level grants; add `has_any_column_privilege('supabase_auth_admin', c.oid, …)`.

## Controller rulings
- N1: fix in the runbook (read the three names without executing `.env.local`, refuse duplicate or malformed lines, assert the URL shape and print the host before any request). A deny for agent Edit/Write of `.env*` is raised with Einar as a `.claude/**` change.
- N3: fix in the runbook (check the existing project's Git connection before the first `hub-integration` push; stop and report if it would build the branch).
- N2, N4, N5, N6, N8: fix in the runbook.
- N7: the controller adds a note to Task 27 in the plan (raise the Vercel connection and the N3 check when G7 is requested) and the runbook's open item says the same.
