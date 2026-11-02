# Task 25, security review, round 1 (cms-security-reviewer)

Diff `eeaf219..f84b096` in `.worktrees/lane-a-next`. Report as returned by the reviewer:

PASS. No changes made (`git status --porcelain` empty); database queries were SELECTs or inside `begin … rollback`.

1. pass: no function added; 0 definer functions in api, cms, private; the view is schema-qualified.
2. pass: `api.publication_status` `security_invoker=true`; `anon` gets "permission denied for schema api"; no `cms`/`private` exposure.
3. pass: relacl `{postgres=arwdDxtm/postgres,authenticated=r/postgres}`; no new grant (migration 75–76); only columns authenticated already holds (for `cms.sites`: id, tenant_id, active; secret references neither granted nor used); nothing depends on the view, so drop-and-recreate is safe.
4. pass: the latest-request subquery keeps `m.user_id = (select auth.uid())` (50–55); releases, sites, site_deliveries and assets joined only on `r.tenant_id`, so console policies cannot widen it; editor_demo sees only a002 (rolled-back query); pgTAP 099:152–164 (outsider and platform_admin at aal2 see nothing; anon and service_role 42501).
5. n/a.
6. pass: tenant from the entry via `loadEntryContext` (`entry-context.ts:53–64`); RPCs receive only entry id and version; `missing_assets` joins assets on `a.tenant_id = r.tenant_id` (line 46), a foreign asset id gives no filename (099:21, 154).
7–8. n/a (`deliver.ts` only moves `MAX_NOTIFY_ATTEMPTS`).
9. pass: unpublish via the existing `request_unpublish`; the display decides nothing about release content.
10. pass: `publish-actions.ts` uses only `createEditorClient`; `triggerWorker` sends only `{requestId}` with `redirect: 'manual'`; a failed trigger logs the id and an HTTP/fetch message, never the secret (44–49); codes only to the browser (24–28); `CMS_INTERNAL_SECRET`/`CRON_SECRET` random per run; `DEMO_SITE_WEBHOOK_SECRET = 's3cr3t'` (`support/demo-site.ts:10`) is the seeded local test value of `tests/integration/src/fixtures.ts:35` and `090_api_worker.test.sql:743`, asserted equal by `e2e-loopback.test.ts`.
11. pass: "Birt á vef ✓" only when delivered, not omitted, `site_count > 0` and `sites_live_ok === site_count` (`status.ts:96–103`); active sites' deliveries of the request's own release (migration 61–74); a site without a delivery row blocks live (099:143–150); no active site never live; release marker not used; unknown status fails closed (84–86).
12. pass: `removedDetail` says older copies may remain in browser, search-engine and other caches; promises no removal.
13. pass: §7.4 mapping matches `architecture.md:486–507`.
14. pass: no `.claude` change; the exclusion unchanged.

e2e outside the sandbox: every URL through `requireLoopback`; the site on `-H 127.0.0.1`; `NO_CLI_NETWORK_ENV` on both webServers and the spawned `next build`/`start`; `.env*` refusal; `rmSync` only `<demoSiteDir>/.next` inside the repository; the demo site's sources make no external fetch; `e2e-loopback.test.ts` asserts the hosts, command line, `.env` and port refusals.

Minors:
- `apps/cms/e2e/demo-site-server.ts:78` (`siteEnv`, `...process.env`): the demo site gets the whole parent environment; no key there today (cms-next.sh reads keys in its own process; internal and cron secrets only on the cms webServer); pass an allowlisted environment as defence in depth.
- `20261102001500_publication_status.sql:65–68`: when a newer release supersedes the request's release before every site is confirmed, the status can stay "Í birtingu…"/"Bíður eftir vefnum"; fails closed, never overclaims; usability only.
