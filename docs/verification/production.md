# Production on vefstjorn.is: verification record

Run of `docs/plans/production.md` (decision 76) on 2026-11-12, by a Claude Code session under decision 75, with Einar for DNS, the new key, the account list and the mailbox checks. Times are UTC. No secret appears here.

**Result: done.** The CMS runs as production at `https://vefstjorn.is` on the Supabase project `rwpgpfsmhhtimauvpoyt`, with a fresh secret key, the legacy JWT keys disabled, and one account. Two findings are open (S32, S33 in `docs/king/OPEN-ISSUES.md`).

## Step 0: state

| Check | Result |
|---|---|
| `main` | `815d078`; since `a772423` only docs, agent definitions, `CLAUDE.md`, `.claude/settings.json` and `gates.json` changed |
| `staging` | `a772423` |
| Migrations | 46, the last `20261112100000_sign_in_auth_hook` |
| Hook grants, runbook 7.1 step 2 (2a–2f) | All as expected: `proacl` owner and `supabase_auth_admin` only; not `SECURITY DEFINER`; `search_path` empty; `supabase_auth_admin` has `usage` on `private` only, executes only `private.sign_in_access_token(jsonb)`, no table, column or sequence privileges; the old hook is gone |
| Vercel | `vefumsjon-staging`, `demo-staging`, `demo-next15-staging`, `labak-hub` exist; `/login` 200 with the password form and `x-robots-tag: noindex` |
| Accounts | The four in the facts table |

Differences from the plan's facts table: `labak-hub` has no `CMS_PREVIEW_BASE_URL` (so step 2.3 changed nothing there); the console also lists a suspended `m4-probe` tenant (left as it is).

## Step 1: the domain

- Added to `vefumsjon-staging`: `vefstjorn.is`, and `www.vefstjorn.is` redirecting to it (308).
- Einar entered at ISNIC: `A vefstjorn.is 216.150.1.1`, `A vefstjorn.is 216.150.16.1`, `CNAME www.vefstjorn.is 69cdbc6710f9f9df.vercel-dns-017.com.` (the domain stays on ISNIC's `forwarding00/01.isnic.is` nameservers).
- `https://vefstjorn.is/login` 200, certificate `CN=vefstjorn.is`, Let's Encrypt, valid to 2027-02-10; `www` answers 308 to `https://vefstjorn.is/login`.

## Step 2: the host switch

- Supabase Auth: Site URL `https://vefstjorn.is`; redirect URL `https://vefstjorn.is/auth/confirm` added (dashboard, read back after reload).
- `CMS_PUBLIC_URL=https://vefstjorn.is` on `vefumsjon-staging`; `CMS_PREVIEW_BASE_URL=https://vefstjorn.is` on `demo-staging`; both redeployed (Ready). `labak-hub` has no such variable.
- Indexing: `x-robots-tag: noindex` comes from `apps/cms/vercel.json` for every path and host; present on `vefstjorn.is`.
- `https://vefstjorn.is/` answers 307 to `/login`.

## Step 3: the secret key (S17)

- Einar created `cms_prod_2026_11` and set it on `vefumsjon-staging` (production) and in `.env.staging.local`; the CMS was redeployed at 10:19.
- API logs: the sweep used the new key (prefix `sb_secret_qCu3Y`) from 10:21, every request 200; the old key (`sb_secret_igAre`) was last used at 10:20.
- Publish 1 (location "… (vefstjorn.is 1)", draft version 14): requested 10:26:35, `committed` on attempt 1, live on `https://demo-staging.litljomi.is/events/prufa` within about 10 s.
- The old secret key ("default") deleted in the dashboard after a log check showed no use since 10:20.
- Legacy JWT keys: the API logs held no `anon` or `service_role` use in 24 hours (only Supabase's management service, role `supabase_admin`); the code uses only the publishable and secret keys (`ANON_KEY` appears only as a fallback name in `tests/integration/src/env.ts`, for the local stack); the only authorized OAuth app is the Claude connector. Disabled ("Disable JWT-based API keys"). The dashboard notes they stay valid as JWTs (S33).
- Publish 2 after both changes (draft version 15): live in about 70 s; no 401 in the API logs.
- Both draft saves logged `set_slug` 400: the expected `slug_locked` refusal for an already published entry.

## Step 4: test accounts

Einar confirmed all three. Memberships removed (`einsi+a-labak` from `labak`, `einsi+a-demo` from `demo`; audited by the memberships trigger), then the Auth users `einsi+a-demo@litljomi.is`, `einsi+a-labak@litljomi.is` and `einarzkuli@gmail.com` deleted. No identities or sessions left. `einsi@litljomi.is` remains: editor of `demo` and `labak`, the one platform admin, TOTP verified. Tenants `demo`, `labak` kept.

## Step 6: verification

| # | Check | Result |
|---|---|---|
| 6.1 | Sign-in at `vefstjorn.is/login` with password; `/console` after TOTP | Pass (Einar signed in in the pane; console lists the tenants) |
| 6.2 | Reset for `einsi@litljomi.is` | Pass (Einar): the flow ended on `vefstjorn.is`, reset and TOTP completed. The link in the mail was SendGrid's click-tracking redirect (`u53709994.ct.sendgrid.net/ls/click…`), not `https://vefstjorn.is/auth/confirm…` directly (S32) |
| 6.3 | Invite to `einsi+prodcheck@litljomi.is` (sent from the dashboard at 10:41:50) | Pass (Einar): password set (`confirmed`, password present). Same SendGrid redirect (S32). The account was deleted afterwards; no sessions left |
| 6.4 | Publish on `demo`; preview through the new host | Pass (step 3's publishes; "Forskoða" showed the unpublished draft on `demo-staging.litljomi.is` via `vefstjorn.is`) |
| 6.5 | Retire the old host | Pass: `https://vefumsjon-staging.litljomi.is/auth/confirm` removed from Auth's redirect URLs (only `https://vefstjorn.is/auth/confirm` is left); `vefumsjon-staging.litljomi.is` now redirects 308 to `vefstjorn.is` (set with `vercel api` PATCH, since the connector has no domain-edit tool) |
| 6.6 | Runbook 7.2 S1–S4 | Pass. S1: Custom Access Token hook enabled, Postgres, `private.sign_in_access_token`. S2: 2a–2f as in step 0. S3: the six hosted templates are byte-identical to `supabase/templates/*.html` (SHA-256 of the dashboard editor's text), subjects as in `config.toml`, only `{{ .SiteURL }}` (and `{{ .TokenHash }}` in invite) as placeholders; Email OTP length 10, expiry 3600. S4: sign-up `signup_disabled` 422, anonymous `anonymous_provider_disabled` 422, `/auth/v1/settings` `disable_signup: true`, no other provider on; no anonymous or sign-up-test account exists |

## Follow-up 1: S32, Auth links off SendGrid's click tracking (2026-11-12)

- PR #67 (`fix/S32-clicktracking`, head `1f2f561`), merged as `7b3dc3a`: `clicktracking="off"` before `href` on the one link in `invite.html`, `recovery.html`, `email_change.html`; `confirmation.html`, `magic_link.html`, `reauthentication.html` have none. `tools/checks/__tests__/supabase-config.test.ts` requires every template anchor to start `<a clicktracking="off" href="` with the exact link. Boundary review: spec, security and quality PASS on `1f2f561` (Minors only); unit 3341, integration 152 and pgTAP 2622 passed (after `pnpm db:reset`, R9), browser suite 80 passed plus R9's flaky publish test on rerun; CI green. Local stack restarted after the template change.
- Hosted: the three templates set from `main` in the dashboard (11:44–11:50 UTC), each read back after reload byte-identical to its file (SHA-256 `2356dd07…` invite, `924b7ec4…` recovery, `aba9d77d…` email_change); subjects unchanged.
- Real mail (Einar): an invite to the throwaway `einsi+s32check@litljomi.is` (sent 11:54) and a reset for `einsi@litljomi.is` both link straight to `https://vefstjorn.is/auth/confirm?token_hash=…`, with no `ct.sendgrid.net` redirect. The throwaway account was deleted afterwards.
