# Task 21, security review, round 1 (Opus)

Verbatim report.

FAIL

Task 21 security review, round 1 (diff `5771348..49336e7`, worktree /Users/einarzoega/litljomi-cms/.worktrees/lane-a-next). There is one Major finding: the new marker parser stops seeing markers after a single "İ" character. That breaks the live-check proof rule (checklist item 11). Everything else holds.

**What I ran:**
- `pnpm db:reset`, then `pnpm db:test`: 16 files, 1342 tests, PASS.
- `pnpm lint`: exit 0.
- `pnpm test`: 42 files, 713 tests passed.
- `pnpm check:slugs`: OK.
- `pnpm test:integration`: 70/70 and 27/27 passed.
- `pnpm db:reset`, then `pnpm test:e2e-local`: 1/1 passed. The run reached `notify_status ok`, `live_status ok`, `last_error null`, and the site still served 200 with the same marker after the CMS was stopped.
- Afterwards: the local secret key's value is absent from `apps/cms/.next`, `apps/demo-site/.next` and every tracked file (checked with grep). Nothing listens on 3101. The final `pnpm db:reset` succeeded. `git status --porcelain` is empty.

**Checklist**

1. **pass.** Catalog query: `worker_tenants_to_release` and `worker_deliveries_to_retry` both have `prosecdef=f`, `proconfig={search_path=""}` and are STABLE. Every name is schema-qualified (`supabase/migrations/20261102001300_worker_sweep.sql:21-100`). Across `api`, `cms` and `private` there are 0 `SECURITY DEFINER` functions and 0 functions without `search_path=''`.

2. **pass.** Both new functions are invoker functions in `api`, and the migration grants nothing on `cms` or `private`. pgTAP 010 and 100 counts were updated to 18 worker/admin functions and 27 api functions; both pass.

3. **pass.** proacl for both functions is `postgres=X/postgres,service_role=X/postgres`. PUBLIC, anon and authenticated have no EXECUTE (revoked at `migration:102-105`). No table grants changed. `097_worker_sweep.test.sql:65-68` asserts 42501 for an editor and for anon.

4. **not applicable.** No table or policy changes. The functions use only `service_role`'s existing SELECT grants.

5. **not applicable.** No new tables.

6. **pass.**
   - `processAndDeliver` takes only `requestId`. The tenant comes from the claimed row (`process-request.ts:100` `read.request.tenant_id`).
   - The sweep takes tenants, releases and sites from the database.
   - `worker_deliveries_to_retry` joins sites, deliveries and requests on `tenant_id`, so nothing crosses tenants (`migration:88-92`). The bundle read in the sweep is checked against `tenant_slug` and the release number (`sweep.ts:102`).

7. **pass.** Catalog query: no `worker_*` or `admin_*` function is executable by anon or authenticated, and none is missing `service_role`. `p_max_attempts` null or below 1 raises 22023 (`migration:65-67`, tested at 097:94-96). These are read-only listings; there is no actor to authorize.

8. **not applicable.** The commit path is unchanged. `build-release.ts` only adds `requests` to delivered results. That extension only maps the snapshot's own requests (`build-release.ts:233`), which is acceptable.

9. **pass.** Release content is still decided by the build. `liveTargets` (`deliver.ts:105-131`) only reads the bundle. An omitted publish becomes `delivery_failed` and is never checked as present (`deliver.ts:119`). Every target failure makes the site `not_confirmed` (`deliver.ts:198-224`).

10. **pass**, with Minor (a) below.
    - `admin-client.ts` and `internal-auth.ts` import `server-only`, and so does `pipeline.ts`. Every worker file reaches the admin client through them.
    - `last_error` stores only `{code, status}` or `{entryId, path, reason}`. No secret is logged.
    - Lint rejects `process.env.SUPABASE_SECRET_KEY` in `apps/demo-site/src` (checked with eslint `--stdin`).

11. **fail.** Major finding below.
    - The rest of this item holds:
      - `present` requires 200 and `{id, hash === new contentHash}` (`live-check.ts:77-82`); a null hash fails.
      - The release meta is never read.
      - `absent` uses `parseEntryMarkerIds`, so a marker with only an id, an empty hash or another hash fails closed (tests at `live-check.test.ts:96-103`).
      - The own path requires 404, and a 404 page that still carries the marker fails.
      - Media URLs require 200. Redirects are not followed (`redirect: 'manual'`).
      - Pages are capped at 5 MB (`too_large` fails the check), and fetches time out after 10 s, never past the window.
      - Check paths must start with `/`; `//` and `\` are refused.
      - There is one resend per site and delivery, only after round 1 (`deliver.ts:194`, `live-check.ts:103`).
    - Requiring 200 for an `absent` check on any page other than the own path is stricter than §7.4's text. It fails closed (a 5xx page proves nothing about the page), so I judge it acceptable and not a security contradiction.
    - Parser cost is linear. My adversarial 5 MB inputs each took 1–227 ms.
    - The tests I was asked about would catch their bugs: an old hash with a newer release meta (`live-check.test.ts:36`), an id-only marker on `absent` (:96), a 200 own path after unpublish (:67), and a marker only in a comment or script (:56). A marker placed in the layout cannot be told apart by any parser; it remains the site's contract under §7.3.

12. **not applicable.** No editor text in this task.

13. **pass (contradiction reported, not resolved).** Spec §7.4 says retries use exponential backoff for up to 24 hours. The Task 21 text, which this change implements, says a fixed interval, one retry per sweep, up to 10 attempts in M1 (`deliver.ts:21`, `sweep.ts:87`). That is a plan-versus-spec difference for the controller to raise. I have not chosen between them.

14. **pass.** `git diff --name-only 5771348..0adf889` touches nothing under `.claude/**`.

**Webhook and revalidate route (outsider-reachable):**
- `notifySite` (`notify.ts:17-44`) signs `{tenant, release}` with `webhook_secrets[0]` through `signWebhook` and sends it in a header together with the timestamp.
- An empty secret list or an empty first secret is refused without calling the site and recorded as failed.
- It uses a 10 s timeout and `redirect: 'manual'`, and never throws.
- The revalidate handler (`revalidate-handler.ts:49-69`) checks the timestamp format and the 5-minute window, and the signature's format, before reading the body. It returns 413 for a declared `content-length` over 64 KiB and for a streamed body over 64 KiB, cancelling the read. HMAC runs over the raw bytes.

**Deferred rows owned by Task 21:** all hold.
- `server-only`: see item 10.
- Digest comparison: `internal-auth.ts:4-14` compares SHA-256 digests with `timingSafeEqual`.
- `triggerWorker`: uses `redirect: 'manual'`, with a test.
- Case-insensitive dynamic-import selectors: `import('@/Privileged/admin-client')` and `import('@litljomi/Cms-Schema')` are both flagged.
- Demo-site lint block: `@litljomi/rich-text/editor`, `@litljomi/cms-schema`, `@litljomi/RICH-TEXT/editor`, `../../cms/...` and `../../../../cms/...` are all flagged; `cms-sdk` and the `rich-text` main entry are allowed.
- SDK client: `pointer.release` must be a safe integer of at least 1, and `pointer.bundle` must equal `releases/${release}.json`.
- `ProjectionError`: builds the path with `String(p)`, so symbol segments no longer throw.

**Findings**

- **[Major] `packages/sdk/src/parse-markers.ts:86` with `:73-77`: positions found in a lower-cased copy of the page are used on the original page.**
  - `tags()` builds `const lower = html.toLowerCase()`. `closingTagEnd` searches `lower` for `</name` and then indexes `html` with that position.
  - `'İ'` (U+0130) lower-cases to two code units. It is the only character in Unicode where `toLowerCase` changes the length (I checked every code point). So each İ before a script, style, title, textarea or template shifts the position.
  - The closing tag is then missed, `closingTagEnd` returns -1, and `tags()` stops silently. Every marker after that point disappears.
  - Repro with `parseEntryMarkerIds`:
    - `<title>Heimsókn frá İzmir</title><script>x</script><span data-cms-entry="E" data-cms-hash="H">` returns `[]`.
    - `<p>İ</p><script>x</script><p>text</p><span …>` returns `[]`.
    - Without the İ, both return `["E"]`.
  - Effect: an `absent` check passes while the entry's marker is still on the page (`live-check.ts:84`). The site's delivery is then recorded `live_status = 'ok'` for an unpublish that has not happened, which breaks §7.4 ("Success is never shown before its proof exists") and checklist item 11.
  - Who can trigger it: ordinary editor text. React escapes `<` but not İ, so a Turkish name in a title or body is enough, as long as a skipped element follows it before the marker (`<title>`, an inline or JSON-LD `<script>`, a `<style>`, or the Suspense `<template>` placeholders in Next.js streaming).
  - Why Major and not Critical: it is a false proof of withdrawal, not a breach of a §8.1 boundary, and it depends on the page's structure.
  - Fix direction: find closing tags without a length-changing case fold. For example, lower-case only ASCII A–Z, or compare `html.slice(at, at + 2 + name.length).toLowerCase()` at each `<` in `html` itself. Add tests with U+0130 before each skipped element.

- **[Minor] `packages/sdk/src/parse-markers.ts:93-117`: the parser fails open when the HTML is malformed.**
  - An unterminated tag or quote, a raw-text element that is never closed, `<!-->` and `--!>` comments, and script double-escaping (`<!--<script>` inside a script) all end the scan or skip text that a browser treats differently. Each can hide a later marker from an `absent` check.
  - Only raw HTML the site author writes can produce these, and a compromised site can fake markers anyway, so there is no exposure today. Stopping early should still be treated as "inconclusive" (fail the check) rather than "no marker".

- **[Minor] `deliver.ts:121`, `deliver.ts:124`, `live-check.ts:189` test: some entries are confirmed with nothing checked.**
  - Zero checks and zero media give `live: true`. That happens for a type without site integration, and for an unpublish of an entry that the previous delivered release did not contain.
  - This matches §7.4's "every check the module declares", but those entries are confirmed without any proof. Example: an entry delivered in N-2, left out of N-1, then unpublished in N is confirmed with no check.

- **[Minor] `deliver.ts:196-214`, `live-check.ts:94`: no limit on simultaneous page fetches.**
  - Every check of every target is fetched in the same round, each up to 5 MB, and the body is roughly copied three times (chunks, concat, string). Pages shared by several targets (home, listing) are fetched once per target.
  - The sweep runs all tenants in one invocation.
  - The number of simultaneous fetches is driven by a trusted editor's request count. The page size only matters if a site is compromised.
  - Rough estimate, not measured: 15 MB of buffers per page at the cap; about 450 MB at 30 simultaneous capped pages. There is no database temp space; the time bound is 60 s per site.
  - Suggest limiting concurrency and deduplicating paths per site.

- **[Minor] `tests/integration/scripts/cms-next.sh:14,25`: the secret key is handled outside the lint-protected zones.**
  - The script reads the local stack's secret key and exports it to the `next` child process. It runs outside lint and outside `privileged/**` and `tools/cli`, so the literal wording of checklist item 10 is not met.
  - I judge it acceptable under §8.2 ("local CLI environment") and decision 35's opt-in end to end:
    - the key is read at run time;
    - the script refuses anything other than `http://127.0.0.1:` or `http://localhost:`;
    - nothing is written to a file, and the key is never echoed;
    - the TypeScript never names it;
    - `tests/integration/src/env.ts` already sets the same precedent.
  - The controller may want Einar to note the precedent.
