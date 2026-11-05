# M5 independent review, 2026-11-05

Five fresh reviews of `main` at `4d078b5`: database boundary, worker and delivery, preview and SDK, editor app with auth, console and CLI, and known items with a history scan. Local only: no hosted system was touched. The KING confirmed findings 1 and 8 to 10 in the code. The rest are as reported, and the OTP and rate-limit items are reasoned, not measured.

**Result: no Critical. No breach of tenant isolation, confidentiality, integrity or audit under any probe. No real secret in the history** (587 commits on 80 refs, plus 58 unreachable commits; S18 can close, within the limits of a regex and entropy scan).

## Major findings

| # | Finding | Who is exposed | Evidence |
|---|---|---|---|
| 1 | A repeat unpublish cancels an unconfirmed withdrawal's checks and shows "Tekið af vef" with nothing checked (S22). Found by two reviewers | Editors, via a stale panel; needs a failing site | Rolled-back local run; `deliver.ts:174-176`, `20261104180000_withdrawal_confirmation.sql:231`, `api.request_unpublish` |
| 2 | A killed run during the pointer poll or live window loses the withdrawal check and its alert | Platform admin; low likelihood | Rolled-back local run; `deliver.ts:268,296-328` |
| 3 | One `entry_detail` request can use about 4 GB of shared Postgres memory | Every tenant, from a hostile editor | Measured locally: 4,160 MB; `max_rows` 1,000 |
| 4 | PostgREST `match` filters run editor-chosen regexes on `data`, up to the statement timeout | Every tenant's editors, from a hostile editor | Measured: 8.0 s per statement |
| 5 | Unbounded text columns, append-only audit growth, no per-tenant quota | Every tenant, from a hostile editor | Measured: 64 MB title stored |
| 6 | Email OTP guessing across IPs, with no per-account lockout | An editor's account | Reasoned. `config.toml` has length 6; hosted may differ |
| 7 | Auth limits may key on Vercel's egress, so an outsider could lock out sign-in, silently | Every tenant's sign-in | Reasoned. No `Sb-Forwarded-For`, no CAPTCHA |
| 8 | Session cookies aren't `httpOnly` or `secure`, last 400 days, and the app sets no security headers | Editors, if any script runs in the origin | `@supabase/ssr` defaults; no XSS sink found |
| 9 | `email_change.html` uses `{{ .ConfirmationURL }}`, consumed on GET, so a mail scanner can confirm the old address | Editors, with a stolen session and a scanning mailbox | `supabase/templates/email_change.html:18` |
| 10 | `.claude/settings.json`: `git` and `gh` run unprompted outside the sandbox, so an agent can read the secret key or push to `staging`. Sandboxed commands also hold the Docker socket | The whole platform, through a mistaken or injected agent | Decision 60 accepted the first part. The Docker socket predates it |

## Minor findings

Reported in full in the session's ledger and summarised here:

- **Worker:** a claimed incident loses its email on an SMTP failure; `worker_record_alert` 64 KB limit; raw database text in `releases.error.message` (S25); a suspended tenant gets no housekeeping (known, runbook covers it); overlapping retries; `isoOrNull` outside the per-entry `try`; no heartbeat for a dead sweep.
- **Database:** an archived entry can be published, with nothing going live; `assets.id` is global (decision 30); `admin_create_site` secret length; signed upload tokens outlive revocation for their lifetime; `platform_admins` isn't audited.
- **Preview and SDK:** sticky draft cookie, with no exit; a preview refusal fails the site for that browser; `next/image` can cache signed draft media for hours; the renderer trusts the bundle; published `entries` shape unchecked; token route reads the body before the session; Vault decrypt per unsigned token; SDK accepts a short webhook secret.
- **Auth and editor:** login CSRF; address enumeration through `/otp`; `token_hash` in request logs; no session timebox; `signOut` result ignored; first enrolment race; no pixel-dimension cap, and EXIF GPS published with originals; identifiers in the public repo; no Dependabot.
- **Known items:** S16 is closed by this review. S21, S23, S24, S26 and Minors 7, 8 to 14, 16, 17 and 18 are Minor. M4's deferred Minors stay Minor.

## Not tested

Hosted Auth, Storage and Vercel settings; real response headers; concurrent saturation or a real out-of-memory restart; a real killed run; SMTP failure; Next 15 at runtime; the LABAK repository.
