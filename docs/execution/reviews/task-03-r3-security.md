# Task 3 (Hosted environments runbook): security review, round 3 (scoped to fix round 2)

- Reviewer: fresh `cms-security-reviewer` (Opus), 2026-11-02
- Changes: 6a5f940 (runbook), 898d834 (Task 27 note)
- Result: **PASS**; N1–N8 ADDRESSED; F1–F3 still hold; 3 new Minor
- Method: both section 7.2 scripts extracted from 6a5f940 (only `ENV_FILE` pointed at scratch files), `bash -n`, run under /bin/bash 3.2.57 with `env -i` against a stub HTTP server on 127.0.0.1, with argv-logging wrappers for `curl`, `jq`, `openssl`; the curl wrapper allowed only one fake `*.supabase.co` URL (rewritten to the stub) and logged any other (none). Harness: scratchpad `t3r3sec/`. Nothing hosted contacted.

## Checklist (verbatim in substance)
1 not applicable (H2 still requires `prosecdef = false`, `search_path=""`). 2 pass (`api` only; 406 for the others; GRANT ALL recipe forbidden). 3 pass (column-level grants checked; success means no rows; grants never changed by hand). 4–9, 11 not applicable. 10 pass (48 curl calls, all exactly `curl --config -`; openssl only `rand -base64 24`; jq filters only; none of the fake secret key, publishable key, unrelated `CMS_INTERNAL_SECRET`, 6 stub tokens/hashes or 10 generated passwords in argv or output; child environments hold only `EXPECT_REF`; the stub received the headers intact). 12 pass. 13 pass. 14 pass (`.env*` Edit/Write deny raised as an open item, not applied).

## Verdicts
- N1 ADDRESSED: never sourced; `read -r` evaluates nothing; every hostile case printed one FAILED line, exited 1, made 0 requests, ran nothing (`$(touch …)` and backtick lines in the file; duplicate key "found 2"; later URL or `export URL=` "found 2"; substitution or backtick in a value "unexpected form"; CRLF "unexpected form"; missing name "found 0"; spaces around `=` treated as not plain; quoted values and `"`, `\`, `%s%d`, `é` refused, under en_US and is_IS UTF-8; suffix host, trailing `/`, `http://127.0.0.1:54321` refused; wrong, empty or substituted `EXPECT_REF` refused, printing only public hosts; part 2 the same across 9 cases); a file without a trailing newline works; "target:" printed before the first request.
- N2 ADDRESSED (local URL refused in both parts). N3 ADDRESSED (G6.0, step 0, required by P3; caveat below). N4 ADDRESSED (hidden `read -rs` in a subshell, exported only there, unset; tested in zsh and bash). N5 ADDRESSED (no query selects a secret column). N6 ADDRESSED (server down: FAILED with hint in both parts; verify 502: refresh skipped, no jq noise; hook off, `expires_in` 7200, refresh 400, wrong `redirect_to`: FAILED, exit 1, no token printed). N7 ADDRESSED (plan:1476; runbook 25, 584, 737). N8 ADDRESSED.
- F1 (no trap, no DELETE in part 1; H5 before deletion, needs ≥1 row), F2 (`--config -` from builtin `printf`; jq bodies), F3 (Standard Protection on all three; `hub-integration`-only builds with stop-if-absent; approval at G6 and G7; selected repositories) still hold.

## New findings
- Minor (staging.md:586-587): G6.0 passes when the existing project has "an Ignored Build Step, or a setting that turns off builds" for other branches; Vercel likely still creates a (Canceled/Ignored) deployment and posts a commit status when an Ignored Build Step skips a build (confirm at execution time); the post-push check then stops, but only after the off-limits project was touched. Require that no deployment of any kind would be created, or treat any connection to the LABAK repository as stop-and-report.
- Minor (staging.md:126, 287, 294-295): `EXPECT_REF` is "recorded at G3.1" in `docs/verification/m1-report.md`, a repository file agents can write; with `.env.local` also agent-writable (open item 738), an agent could point both at another `*.supabase.co` project. Einar should take `EXPECT_REF` from his Supabase dashboard or his own records, not from a repository file.
- Minor (staging.md:364, 498): `curl --config -` still reads `~/.curlrc`, and curl honours `HTTPS_PROXY`/`ALL_PROXY`; hardening only: `curl -q --config -`.

Process: one of the reviewer's commands (`rm -f` of a scratch log in `t3r3sec/`) was denied by a built-in safety check; not retried; a new log name was used.

## Controller rulings
All three Minors are fixed in a final small round: G6.0 stops on any connection between the existing project and the LABAK repository; `EXPECT_REF` comes from Einar's Supabase dashboard (the value in `m1-report.md` is for the record only); both scripts use `curl -q --config -`. A scoped security check follows, then the quality review.
