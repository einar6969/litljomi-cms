# Production on vefstjorn.is: plan

> **Status: DONE on 2026-11-12** (approved as decision 76). The record is `docs/verification/production.md`; findings S32 and S33 are in `docs/king/OPEN-ISSUES.md`.

**Goal:** the CMS runs as production at **`https://vefstjorn.is`**, on the existing Supabase project, with a fresh secret key and no test accounts, ready for the first new client (decision 74's next step).

**Decided (decision 74):**
- **Production project:** the existing Supabase project `rwpgpfsmhhtimauvpoyt` (organisation "Litljómi", Free plan, region `eu-west-1`), not a new Pro project.
- **Domain:** `vefstjorn.is`, registered at ISNIC with DNS at ISNIC.
- **Order:** M6 (LABAK) is parked; the next work is (1) production, (2) onboarding a new client.

**Accepted risks:**
- **No backups.** The Free plan has none, and none are made (Einar, 2026-11-12: "it shouldnt play any part in the production to start with").
- **No separate staging** until one is created later.
- The Free plan's limits; check Supabase's current pricing page before relying on them.

**How it runs:** under decision 75 (`CLAUDE.md`, "Autonomy"). The session acts on its own, except where a step says **Einar**: DNS records, entering the new secret key, confirming which accounts to delete. This is configuration only: no code changes, no PR.

## Facts as of 2026-11-12 (verify in step 0)

| What | Value |
|---|---|
| `main` | `373100a` or later |
| `staging` branch (the Vercel production switch for the CMS; the name is historical) | `a772423` |
| Supabase project | `rwpgpfsmhhtimauvpoyt`, 46 migrations, sign-in hook `private.sign_in_access_token`, six Icelandic templates, email codes 10 digits, custom SMTP via SendGrid sending from `litljomi.is` |
| Supabase Auth URLs | Site URL `https://vefumsjon-staging.litljomi.is`; redirect URL `https://vefumsjon-staging.litljomi.is/auth/confirm` |
| Vercel projects | `vefumsjon-staging` (the CMS, `apps/cms`), `demo-staging` (`apps/demo-site`), `demo-next15-staging` (inactive), `labak-hub` (LABAK's `hub-integration` branch, parked) |
| CMS host today | `https://vefumsjon-staging.litljomi.is` |
| Accounts | `einsi@litljomi.is` (platform admin, TOTP, editor of `demo` and `labak`); test editors `einsi+a-demo@litljomi.is` and `einsi+a-labak@litljomi.is`; `einarzkuli@gmail.com` (no membership) |
| Tenants | `demo` (fixture, demo site), `labak` (parked) |
| Where the domain lives in configuration | the CMS's Vercel domain; `CMS_PUBLIC_URL` on the CMS; Supabase Auth's Site URL and redirect URLs; `CMS_PREVIEW_BASE_URL` on each site. No code names the CMS host. |
| Where the secret key lives | `SUPABASE_SECRET_KEY` on the CMS's Vercel project (read only under `apps/cms/src/privileged/**`), and Einar's `.env.staging.local` for `tools/cli` |

## Things that bit us before

- **Dashboard hook update.** The dashboard's "Update hook" runs its own grant statements, including statements on functions that may no longer exist. Check grants with runbook section 7.1 step 2, never by the dashboard's list.
- **Hosted defaults differ from local.** The email code length was 8 on hosted before it was set to 10.
- **Rate-limit tests.** Supabase's rate limit refills about one attempt every 2 seconds after a burst of about 30, so single attempts tell you nothing; keep the allowance drained while testing it (runbook 7.3 step 9).
- **Supabase CLI.** Run it with `SUPABASE_TELEMETRY_DISABLED=1`.
- **Local stack.** Restart it after any change to `supabase/templates/` or `config.toml`, a branch switch included.

## Step 0: check the state

1. **Code:** `git fetch`; `main` and `staging` as in the facts table, or newer with only docs commits.
2. **Database:** Supabase connector `list_migrations` shows 46; `execute_sql` shows the hook grants as runbook 7.1 step 2 expects.
3. **Vercel:** the four projects exist, and `vefumsjon-staging` serves `/login` with the password form.
4. **Report:** any difference from the facts table goes to Einar before continuing.

## Step 1: the domain

1. **Add the domains.** Add `vefstjorn.is` and `www.vefstjorn.is` to the Vercel project `vefumsjon-staging` (Vercel connector or CLI), with `www.vefstjorn.is` redirecting to `vefstjorn.is`. Keep `vefumsjon-staging.litljomi.is` until step 6.
2. **Einar** enters at ISNIC the exact records Vercel shows: typically an `A` record for `vefstjorn.is` and a `CNAME` for `www`.
3. **Verify:** the Vercel domain check passes and `https://vefstjorn.is/login` answers 200 with a valid certificate. DNS can take minutes to hours.

**If it fails:** nothing has changed for anyone yet; the old host keeps working.

## Step 2: switch the CMS to the new host

Do this only after step 1 verifies.

1. **Supabase Auth URLs.** Site URL `https://vefstjorn.is`. Redirect URLs: add `https://vefstjorn.is/auth/confirm` and keep the old one until step 6. Every email link follows, because the templates use `{{ .SiteURL }}`.
2. **CMS variables.** On `vefumsjon-staging`, set `CMS_PUBLIC_URL=https://vefstjorn.is`, then redeploy production.
3. **Site variables.** On `demo-staging` and `labak-hub`, set `CMS_PREVIEW_BASE_URL=https://vefstjorn.is`, then redeploy `demo-staging`. Change `labak-hub` without deploying, since it is parked.
4. **Email sender:** unchanged (`litljomi.is` via SendGrid). No email DNS for `vefstjorn.is` is needed now.
5. **Indexing:** keep the CMS out of search engines. Check the response headers on `vefstjorn.is`, and keep whatever noindex the staging host had.
6. **Sign-ins:** session cookies are per host, so everyone signs in again on `vefstjorn.is`. Only Einar is affected.

**If it fails:** set the Site URL and `CMS_PUBLIC_URL` back to the old host and redeploy.

## Step 3: a fresh secret key (closes S17)

1. **Create the new key.** In the Supabase dashboard, API keys: create a new secret key. Don't display or copy it into chat or a file.
2. **Einar** sets `SUPABASE_SECRET_KEY` to the new key:
   - on the Vercel project `vefumsjon-staging`, production environment;
   - in his `.env.staging.local`.
   Then redeploy the CMS.
3. **Verify the worker** with the new key, and confirm the sweep still runs once a minute:
   - publish a test change on `demo`; it reaches Live;
   - the console opens;
   - the Vercel runtime logs show the worker's RPCs answering 200.
4. **Delete the old secret key** in the dashboard, then repeat a quick publish check.
5. **Legacy JWT keys.** Check whether the project's legacy keys (`anon`, `service_role`) are still enabled. If nothing uses them (the CMS, the sites and `tools/cli` use the publishable and secret keys; confirm with a search), disable them: the legacy `service_role` key is a second master key. **Ask Einar before disabling** if anything is unclear.

**If it fails:** the old key stays until step 3.3 passes, so the CMS keeps working.

## Step 4: remove the test accounts

1. **Einar confirms** the list of accounts to delete. Proposed: `einsi+a-demo@litljomi.is`, `einsi+a-labak@litljomi.is`, and `einarzkuli@gmail.com` (ask whether it's a test account; it has no membership).
2. **Delete** each confirmed account: remove its memberships, then the Auth user.
3. **Keep** the `demo` tenant (an isolated fixture for the demo site) and `labak` (M6 is parked; `labak-hub` points at it).
4. **Verify:** the deleted accounts are gone, with no sessions left, and `einsi@litljomi.is` still signs in with access to both tenants and the console.

**If it fails:** no rollback for a deleted account; that's why Einar confirms the list.

## Step 5: records

1. **Spec, `docs/architecture.md`:**
   - **§2.2:** one Free project as production (decision 74), the domain `vefstjorn.is`, and the accepted no-backup and no-staging risks.
   - **§10.3** (backups): replace "Supabase daily backups (Pro)" with the accepted risk.
   - Every `cms.litljomi.is`: change to `vefstjorn.is`.
2. **Runbooks:** the hosts and the new key in `docs/runbooks/staging.md` and `operations.md`. Rename them only if it's quick.
3. **`docs/king/OPEN-ISSUES.md`:** close S17, R2 and E4; add the accepted risks.
4. **`docs/king/BRIEF.md`:** update "Where things stand".
5. Push the docs to `main`.

## Step 6: verify on vefstjorn.is (done means all pass)

1. **Sign-in:** at `https://vefstjorn.is/login`, `einsi@litljomi.is` signs in with password; `/console` opens after the TOTP code.
2. **Reset:** "Gleymt lykilorð?" for `einsi@litljomi.is` sends a mail whose link starts with `https://vefstjorn.is/auth/confirm?token_hash=` and `type=recovery`; the reset and TOTP step complete.
3. **Invite:** an invite to a throwaway address (for example `einsi+prodcheck@litljomi.is`) links to `https://vefstjorn.is/auth/confirm…&type=invite`; setting a password works. Delete the account afterwards (it's a throwaway created by the session; no confirmation needed).
4. **Publishing:** a publish on `demo` reaches Live on `https://demo-staging.litljomi.is`; the preview button opens a draft through the new host.
5. **Retire the old host:**
   - remove `https://vefumsjon-staging.litljomi.is/auth/confirm` from Auth's redirect URLs;
   - remove the `vefumsjon-staging.litljomi.is` domain from the Vercel project, or keep it as a redirect to `vefstjorn.is` (prefer the redirect);
   - then `https://vefumsjon-staging.litljomi.is` either redirects or no longer serves the CMS.
6. **Hook check:** runbook section 7.2's S1 to S4 (hook, grants, templates, sign-up refused) once more, since the Auth URLs changed.

## After this plan

Next is the new client. The session asks Einar for:
- the client's name and site;
- where the site's code lives and how it's hosted;
- what content they edit;
- who their editors are.

Not in this plan: a new staging project, backups, and a rename of the Vercel projects and the `staging` branch.
