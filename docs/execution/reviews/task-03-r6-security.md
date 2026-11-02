# Task 3 (Hosted environments runbook): security review, round 6 (scoped to fc9e807)

- Reviewer: fresh `cms-security-reviewer` (Opus), 2026-11-02
- Result: **PASS**; the five round-5 Minors and the spec r4 stderr note ADDRESSED; F1–F3, N1–N8 and the round-3/4 items still hold; 2 new Minor
- Harness: scratchpad `t3r6sec/` (round-5 harness copied; `env -i`; bash and zsh; curl wrapper allowing only a fake `api.supabase.com/v1/projects/<ref>/config/auth`, rewritten to a stub on 127.0.0.1). Nothing hosted contacted.

Checklist: 1–9, 11 not applicable to this diff (2a, G3.3 and grant checks untouched); 10 pass (no secret patterns; the token 0 times in stdout, stderr, argv or curl's environment across 18 runs; the secret key only via `--config -`); 12 pass; 13 pass; 14 pass.

Verdicts and evidence (verbatim in substance)
- Minor 1: `REF` typed once, checked `[a-z0-9]{20}`, failure to stderr, rc 1, `target project:` printed before the token prompt, used in both URLs. Normal run: target, `PATCH: 200`, `true`, exactly the PATCH and GET to the fake project. Bad `REF` (uppercase, 19 characters, unfilled placeholder): stop line on stderr, rc 1, 0 curl calls, 0 requests, no token prompt.
- Minor 2: revoked whatever the outcome (:221, :244, section 12 :755).
- Minor 3: `jq '.["<field-name>"] == true'`; wrong field `smtp_pass` against a stub holding a fake SMTP password printed `false`, the secret 0 times (round 5 printed it); the PATCH would still send `{"smtp_pass":true}` — inherent to a wrong field name, stated at :244, guarded by "never guessed".
- Minor 4: decline any environment pull on `vercel link`; executor reads only `.vercel/project.json` (:695).
- Minor 5: `SITE_PROJECT` once per site next to its base URL, `--cwd ~/vercel-link/"$SITE_PROJECT"`, unset; `NODE_AUTH_TOKEN` wording resolved (:730–737).
- Stderr note: part 1 :416, part 2 :559, :569 end in `>&2`; wrong-ref, usage and bad-id refusals go to stderr with empty stdout, rc 1, 0 requests.
- Scenarios (bash and zsh): normal; 401 quoting the Bearer token (`PATCH: 401`, `false`); JSON string holding the Authorization header; plain-text 400; transport error (`PATCH: 000` and curl's own lines); bad `REF` (three shapes); wrong field — token printed 0 times in every case, target line first.
- Section 7.2 scripts: only the three `>&2` additions vs 9d15d26; normal runs byte-identical between versions.

New Minor
1. staging.md:226: `printf '%s\n' "$REF" | grep -Eqx` checks line by line, so a `REF` with an embedded newline passes the check (curl then rejects the malformed URL, rc 3, nothing sent); a whole-string test (`[[ $REF =~ ^[a-z0-9]{20}$ ]]` or `case`) would close it.
2. staging.md:737 (and :730): "cannot be swapped" overstates; `SITE_PROJECT` is typed by hand next to the base URL; "less likely to be swapped", or a check against the base URL.

Sandbox note: process substitution and `diff -` were refused inside the sandbox (/dev/fd); the reviewer compared through scratch files; nothing retried unsandboxed.

## Controller ruling
PASS accepted. Both Minors parked and carried to Task 28 with quality r2's six Minors (recorded in Task 3's notes).
