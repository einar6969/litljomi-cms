# Task 28 Step 5 tool `cms provision`, security review, round 1

Reviewer: cms-security-reviewer, 2026-11-03. Diff `96df3d9..1521293`. cli tests 82/82; eslint on `tools/cli` clean.

**Verdict: PASS** (Minors only).

Evidence: all called functions SECURITY INVOKER with `search_path = ''`, service_role only, grants unchanged; secret key read only in `tools/cli/src/provision.ts` (lint zone); every output passes `redactAll` (key added before first output, secret before any request); server errors show only status, code and message, redacted, control characters stripped, 200 characters; network errors only `cause.code`; non-Failure errors only `e.name`; URL built from fixed paths with origin re-check, key in headers only, `redirect: 'error'`; webhook secret only from stdin (TTY and empty refused, one `\n` stripped, 32–256 printable ASCII, no space or comma); env-file rules identical to section 7.2 (assigned regex, exactly one plain line, URL_RE, KEY_RE, `--expect-ref` before reading, URL equality, CRLF refused); tests' `afterEach` asserts no key or secret in any output and only the target origin with `redirect: 'error'`; echo and network tests would fail without redaction. `api.worker_sites` for the duplicate check judged acceptable (decrypts inside the database under service_role, the worker's own read; `select=id,base_url`; no other read path without a migration). Checklist 7, 10, 13, 14 pass; others n.a.

## Minors

1. `provision.ts:400`: the unexpected-error branch (prints `e.name`) has no test.
2. `provision.ts:168-170`: redaction matches exact substrings only (an escaped re-encoding would pass); no current exposure.
3. `provision.ts:282-296`: check-then-create not atomic; active sites only.
4. Runbook P-3: GoTrue re-sends an invitation to an existing unconfirmed user (200) rather than refusing; wording only.
