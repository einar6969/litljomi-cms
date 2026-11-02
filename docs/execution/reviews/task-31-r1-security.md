# Task 31, security review, round 1 (cms-security-reviewer)

Step 1. Diff `ea76aa9..3a3eada` in `.worktrees/lane-a-next`. Added by the controller's boundary check (new unsandboxed e2e spec; a new tenant read in the editor layout). Report as returned by the reviewer:

PASS

Security review of Task 31 (editor design), step 1, round 1. Diff `ea76aa9..3a3eada` in `/Users/einarzoega/litljomi-cms/.worktrees/lane-a-next`. No Critical or Major findings, one Minor. I changed nothing: `git status --porcelain` was empty at the end, and I did not touch the stack, `pnpm db:*` or e2e.

1. not applicable: no migration or SQL in the diff (`git diff --stat`: no `supabase/` paths).
2. not applicable: no schema or API changes. The layout reads `api.my_tenants`, which is `security_invoker = true` (supabase/migrations/20261102000800_api_editor.sql:335).
3. not applicable: no grants changed.
4. not applicable: no RLS changes. `api.my_tenants` filters by the caller's own row in `cms.memberships` (`m.user_id = (select auth.uid())`, migration lines 335–340), so the new header list is decided per request under RLS.
5. not applicable: no tables.
6. pass: the header cannot show another tenant's name because of a URL slug. `apps/cms/src/app/(editor)/layout.tsx:12-16` calls `requireUserId(client)` first, then `listMyTenants(client)` with the editor's own session (apps/cms/src/lib/tenant.ts:35-39, `from('my_tenants')`). It sends the client component only `{ slug, name }`; `id` and `status` are removed. `apps/cms/src/ui/HeaderTenant.tsx:7-9` only looks up the URL's `tenant` param in that list and renders nothing if it is missing. So a URL slug can only pick from the editor's own tenants, and nothing reaches the client beyond the editor's own memberships, which they can already see. Content pages still resolve the tenant themselves (`currentTenant`/`resolveTenant`, unchanged), and the header does not authorize anything.
7. not applicable: no `worker_*` or `admin_*` changes.
8. not applicable: commit path unchanged.
9. not applicable: release content logic unchanged. `PublishPanel.tsx` only has markup and class changes; the status logic in `./status` is untouched.
10. pass: `grep` over the added source lines for `SECRET|service_role|secret` finds nothing. The only secrets in the e2e path are the existing per-run random `CMS_INTERNAL_SECRET` and `CRON_SECRET` in `playwright.config.ts`, which this diff does not change. `design.spec.ts` writes only PNGs to `apps/cms/e2e-screenshots/` (design.spec.ts:15, 22-34), which is now gitignored (.gitignore:16). The screenshots show the login page and test-data editor pages, with no keys or tokens visible. Session state comes from the existing gitignored `apps/cms/e2e/.auth/`.
11. not applicable: live confirmation logic unchanged.
12. pass: `apps/cms/src/i18n/is.ts` is not in the diff, so the editor text is unchanged. The grep for `cache` in the added source lines finds nothing.
13. not applicable: no contradiction with the spec found.
14. pass: `git diff --name-only ea76aa9..3a3eada | grep -E '^\.claude|plan-index'` gives no output, so neither `.claude/**` nor `plan-index.json` changed.

Focus points:
- **`apps/cms/e2e/design.spec.ts`:**
  - It imports `test` from `./support/test`, which adds `context.route(url => !isLoopbackUrl(url), abort)` (support/test.ts:7-13).
  - All its addresses come from `baseURL` (`CMS_URL`) and the existing helpers. It makes no other network calls; the only filesystem calls are `mkdirSync` and `page.screenshot` into the gitignored folder.
- **Dependencies:** `apps/cms/package.json` adds exact versions `tailwindcss` 4.3.3 and `@tailwindcss/postcss` 4.3.3.
  - The new lockfile entries are only their dependency tree:
    - `@tailwindcss/node` and `@tailwindcss/oxide`, with the per-platform `oxide-*` packages as optional dependencies.
    - `lightningcss` 1.32.0, with its `lightningcss-*` platform packages and `detect-libc`.
    - `jiti` 2.7.0, `enhanced-resolve`, `graceful-fs`, `tapable`, `@alloc/quick-lru` and the `@jridgewell/*` packages.
  - The rest is pnpm re-keying peer suffixes: `eslint(jiti)` and `vite`/`vitest(jiti, lightningcss)`.
  - No tarball URLs and no `requiresBuild` in the lockfile diff.
  - Installed manifests have no install, postinstall or prepare scripts for any `@tailwindcss/*` package or `tailwindcss`. `lightningcss` has `prepare`, which does not run for registry installs.
  - `pnpm-workspace.yaml` still has only `allowBuilds: { esbuild: false }`, so dependency build scripts stay blocked.
- **Fonts and CSS:** `globals.css` loads only `@import 'tailwindcss'` (the local package, line 8) and `url('/fonts/...woff2')` from the app's own origin (lines 12 and 20). No `http(s)://` appears in the CSS or the added source. Both font files start with the `wOF2` magic bytes. `postcss.config.mjs` has only the Tailwind plugin, and `layout.tsx` only imports `./globals.css`; no `next/font/google` or other external loader.

Further finding:

[Minor] apps/cms/e2e/design.spec.ts:67-70: the interception of `publication_status` ends with `route.continue()`. Playwright gives `page.route` handlers priority over `context.route` handlers, and `continue()` sends the request to the network without passing through the earlier context-level abort. So for requests matching `**/rest/v1/publication_status*`, this route bypasses the loopback guard in support/test.ts. Today nothing is exposed: the browser's Supabase URL comes from `cms-next.sh`, which refuses a non-loopback stack (playwright.config.ts comment), so the matched requests go to 127.0.0.1:54321. As defence in depth, a fix would use `route.fallback()` (which lets the context-level guard still apply) or check `isLoopbackUrl(route.request().url())` before continuing, since e2e runs unsandboxed (decisions 37–39). Rated Minor because there is no current exposure.
