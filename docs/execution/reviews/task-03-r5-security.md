# Task 3 (Hosted environments runbook): security review, round 5 (scoped to the quality fixes, 9d15d26)

- Reviewer: fresh `cms-security-reviewer` (Opus), 2026-11-02
- Result: **PASS**; 5 Minor. Harness: scratchpad `t3r5sec/` (stub servers on 127.0.0.1; curl wrappers allowing only the fake staging URL and a fake `api.supabase.com/v1/projects/<ref>/config/auth`). Nothing hosted contacted.

Checklist: 1 not applicable (2a still requires `prosecdef = false`, `search_path=""`); 2 pass (G3.3 `api` only, in the same shell as the URL check, which exits 1); 3 pass (grant checks split, unchanged in substance; 2e keeps table, column and sequence parts in one statement, expects no rows); 4–9, 11 not applicable; 10 pass (no secret patterns in the diff; the token never in output, argv or a child environment; the secret key only in headers); 12 pass; 13 pass (consistent with decision 21); 14 pass (only the runbook and the env test changed).

Evidence (verbatim in substance)
- Einar's Management API block (:221-240), extracted verbatim with a fake reference and field, run under bash and zsh with `env -i`, eight server scenarios each (normal; echo of request headers; plain-text echo 400; 401 quoting the Bearer token; a JSON string holding the Authorization header; 502 HTML; transport error; a pasted token containing `"`): across 16 runs the token appeared 0 times in stdout, stderr, argv or curl's environment; argv only `curl -q --config -` and jq filters; the response body goes to /dev/null; the block holds no secret, so history gets none; the subshell is parsed before `read`, so a pasted block does not feed the prompt. Endpoint `PATCH /v1/projects/{ref}/config/auth` correct; the field left as a placeholder (believed `security_update_password_require_reauthentication`, confirm at execution time).
- SQL: all 15 blocks single statements; 4a (`has_table_privilege`) gates 4b (`delete`); H5 before deletion (:350, :506, :520, :522).
- Scripts vs 30c8a25: only comments, `body`→`data_line`, `check`→`jq_or_false` (no leftover calls), the `EXPECT_REF` refusal to stderr; `env_value` byte-identical; all 9 round-4 outputs byte-identical; same 11 requests.
- `--cwd ~/vercel-link/<project>` on every `vercel env` command, outside the repository; project-ID check sound.
- F1–F3, N1–N8 and the round-3 items still hold.

Minor
1. :221-238: the project reference is typed by hand twice and never checked (`^[a-z0-9]{20}$`, against the dashboard value used for `EXPECT_REF`, or by printing the target); a personal access token is probably account-wide, so a wrong reference would PATCH another project's Auth config. One `REF` variable, checked, used in both URLs, target printed first; shortest expiry or narrowest scope for the token.
2. :221, 240, 750: the token is revoked "once the setting is verified"; the failure path does not say to revoke it; revoke it whatever the outcome.
3. :235: the check prints the field's raw JSON value; with a wrong field name it prints a secret (with `smtp_pass`, the run printed the fake SMTP password) and the PATCH would overwrite that setting with `true`; "stop and report" invites pasting the output into chat. Print `.["<field-name>"] == true` (or check the type is boolean).
4. :691: `vercel link` may offer to pull Development environment variables into `~/vercel-link/<project>/.env.local` (possibly a `VERCEL_OIDC_TOKEN`; confirm at execution time), outside the repository's `.env` read deny, in a directory the executor reads. Say to decline the pull; the executor reads only `.vercel/project.json`.
5. :729-732: P-2's verify checks names only, so swapping `<site-project>` between the sites would put one site's webhook secret on the other undetected until Task 29 (pre-existing; `--cwd` reduces it); set the site project once per session next to the base URL. Also :732 "exactly section 13's names" conflicts with `NODE_AUTH_TOKEN` on `labak-hub-staging` (the parenthesis resolves it; wording only).

## Controller ruling
All five fixed in a final small round, together with spec r4's stdout/stderr note (part 1's "points at … not …" refusal and part 2's usage refusal to stderr). Then a scoped security check and the quality re-review.
