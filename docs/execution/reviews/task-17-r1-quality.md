# Task 17, quality review, round 1 (Sonnet)

Verbatim report.

PASS

I ran `pnpm lint`, `pnpm typecheck` and `pnpm test` in the worktree. All three exit 0. The test run shows 32 files and 518 tests passing. The only noise is the macOS "failed to copy trust settings" lines. I also read the diff for the files you named, plus routes.test.ts up to line 80. I did not read the rest of eslint-boundaries.test.ts, only its list of test names. The notes on that file below come from those names, not from a line-by-line read.

I found no Critical or Major findings. The Minors:

- [Minor] apps/cms/src/privileged/admin-client.ts:11-14: it repeats the "read env, throw if unset" logic that `supabasePublicEnv()` in apps/cms/src/lib/supabase/env.ts already has for `NEXT_PUBLIC_SUPABASE_URL`, with the same error text. A change to the URL handling would have to be made in two places. Suggestion: import `supabasePublicEnv().url` from lib/supabase/env (that zone is already imported for the type), and keep only the secret-key read here. This file is security-relevant (it reads the secret key), so send the change back through the security review.

- [Minor] apps/cms/src/lib/supabase/server.ts:13 and browser.ts:7: `createServerClient<any, 'api'>` and `createBrowserClient<any, 'api'>` both use `any` for the database type. The same `<any, 'api'>` appears in admin-client.ts and types.ts. Suggestion: add a one-line comment saying `any` stands in for generated database types until codegen exists, so nobody "fixes" it by accident.

- [Minor] eslint.config.mjs:25-28: the comment says the exception covers paths "written with `/` and as the last segments". The regex does that, but `\\\\` in the same alternation also forbids every backslash form after `privileged`. Suggestion: add "a backslash after `privileged` is always forbidden" to the comment so the intent is clear.

- [Minor] eslint.config.mjs:~170-178: the file-block list for apps/ is correct but order-dependent, because each block fully replaces the previous one's rules. The existing comment ("A later config block replaces a rule's options entirely…") explains this near `boundary`, but it is far from the blocks that rely on it. Suggestion: repeat a short pointer at the first `appZone` call. This is documentation only.

- [Minor] apps/cms/src/app/api/internal/worker/route.ts:19-23: a bad JSON body and a body that fails the schema both return 400 with no log, so a misconfigured caller is invisible in operations. This matches the design (trusting nothing), so it is optional. Suggestion: a `console.warn` without the body would help diagnose it. The route is security-adjacent, so it needs a security re-check if you take it.

Things that read well:
- The boundary building blocks (`boundary`, `rulesOf`, `appZone`, `dynamicSyntax`, `secondNameNode`) are clear and well commented.
- Both routes log failures with a `[cms-alert]` prefix and a request ID.
- `matchesSecret` handles the length mismatch before `timingSafeEqual`.
- `HeadersOnlyRequest` in routes.test.ts gives a real regression check that the cron route reads only headers.
- The `it.each` cases in the boundaries test cover the static form, the dynamic form and the allowed counter-cases, so a broken rule would be caught.
