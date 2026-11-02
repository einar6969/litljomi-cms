PASS

I reviewed Task 7 round 4, fix commit 72860c1 (`git diff 8883356..72860c1 -- supabase/`). The fix rewrites only the key check in `private.extract_refs` and adds tests, so I judged it on its own and am not asking for a full re-review.

**The round 3 Major is resolved.** The probe from round 3 used 64 × chr(1) keys and wrote 48.8 MB of temp files. Every key outside `^[A-Za-z0-9_-]{1,64}$` is now refused with 54000 in the pre-walk scan, so that probe never reaches the walk. The regression test covers it as a draft save and as a service_role revision insert: 54000, 0 temp bytes, under 1 s (040_refs.test.sql "control-character probe").

**The ~10 MB worst case holds.** I measured my own worst shape:
- **Shape:** 126 levels of 64-character keys over one object with 1,000 references, each under its own 64-character key. That gives 127 key steps per path. 144,820 bytes as text.
- **Paths:** the longest is 8,510 characters (1 + 127 × 67).
- **Temp files:** 8,552,448 bytes when extract_refs runs alone, and the same when run as editor_labak (`update cms.drafts`) and as service_role (`insert into cms.revisions`). Each run took 0.08–0.16 s.
- **Compression:** keys built from md5 do not compress, so their paths fail closed with 54000 "index row size 5232 exceeds btree … draft_refs_pkey". The temp bytes are written before that and are the same.
- **Array steps** like `[n]` are under 10 characters, so they cannot make a path longer.

How I checked: all probes ran as postgres, or as the personas from `_helpers.sql`, in transactions that were rolled back, with `statement_timeout = '10s'`. Scripts are in /private/tmp/claude-501/-Users-einarzoega-litljomi-cms/f7085da3-8638-45ff-a6aa-b6fad42d8bf7/scratchpad/r4/ (`bypass.sql`, `lin.sql`, `lin2.sql`, `worst.sql`, `cat.sql`). I did not run db:reset. `git status --porcelain` shows the controller's two `M` files plus `?? docs/execution/reviews/task-07-r4-spec.md`, which the parallel spec reviewer created, not me.

## Checklist items the fix touches

1. **pass.**
   - No SECURITY DEFINER function in api, cms, private or public (`count(*) where prosecdef` = 0).
   - `private.extract_refs(jsonb)` is invoker and stable, with `proconfig={search_path=""}`.
   - The new check calls `pg_catalog.regexp_matches` and uses the `!~` operator; the calls are schema-qualified.
2. **pass.** The schema ACLs did not change:
   - `private`: `{postgres=UC, supabase_auth_admin=U, authenticated=U, service_role=U}`
   - `cms` and `api`: `{postgres=UC, authenticated=U, service_role=U}`
3. **pass.** The grants did not change:
   - `extract_refs`: `{postgres=X, authenticated=X, service_role=X}`.
   - Every other function in `private` is `postgres=X` only; `passwordless_access_token` is also executable by `supabase_auth_admin`.
   - `draft_refs`: authenticated has SELECT, INSERT, DELETE; service_role has SELECT.
   - `revision_refs`: authenticated has SELECT; service_role has SELECT, INSERT.
   - anon has nothing. The diff contains no GRANT statements.
4.–9. **not applicable.** The fix does not touch RLS, foreign keys, worker or admin functions, the commit or withdrawal.
10. **pass.** No secret is in the diff.
11.–12. **not applicable.**
13. **pass.** The round 3 contradiction is resolved by decision 29 (plan line 264) and the revised spec §4.3 (architecture.md:215). The code follows both: the key pattern, 54000, the check in the same linear pass, about 10 MB, and the empty key refused. I found nothing new that contradicts the spec.
14. **pass.** Commit 72860c1 changes only the migration and 040_refs.test.sql. The `.claude/agents/cms-security-reviewer.md` change is a separate commit, 6a253c3, marked "(approved diff)", and is not part of this fix.

## Can the key check be bypassed? (`bypass.sql`)

**Refused with 54000:**
- Unicode that a looser match might accept: ſ (U+017F), the Kelvin sign (U+212A), dotless ı, fullwidth Ａ, an Arabic digit, a superscript 2.
- Invisible or control characters: DEL, a non-breaking space, a zero-width space, a combining accent, a newline, a tab, a trailing backslash.
- Punctuation: `:`, `` ` ``, `^`, `[`, `]`, `@`, `/`, `.`.
- Length: the empty key and a 65-character key.
- Placement: an extra bad key on a root reference object, and an empty key inside a reference inside an array.
- Desynchronisation attempts: a value ending in a backslash followed by a bad key, and a value containing `": {"` followed by a bad key.

The character ranges are case-sensitive and compare code points under en_US.UTF-8 (`chr(383) ~ pattern` is false).

**Accepted, correctly:**
- The key `A`, which jsonb stores as `A`.
- Values that look like bad keys.
- A root string and a root array.
- 64 × `a`, and `Zz09-_`.

**Why the scan finds every key:** jsonb text output escapes only `"`, `\` and control characters, and every escape starts with `\`. So every escaped key fails the pattern, and an unescaped key is tested exactly as stored. The order is depth, then key pattern, then reference count, then `_ref`, then `_kind`. I confirmed it with a 129-deep document with a bad key (depth error), a bad key plus 1,001 references (key error), 1,001 bad references (count error), then 22P02 and P0001.

**Linearity (`lin.sql`, `lin2.sql`).** Run times grow linearly with size, and the scan wrote 0 temp bytes:

| Input | Sizes (text) | Time |
|---|---|---|
| String values of backslashes | 0.5, 1, 2, 4 MB | 12, 18, 29, 55 ms |
| String values of `"` | same | 6–52 ms |
| String values of `\":` | same | 6–52 ms |
| Control characters | 0.3, 0.6, 1.2 MB | 4, 9, 18 ms |
| Keys `k<n>` | 50k, 100k, 200k keys | 114, 234, 484 ms |
| 64-character keys | 10k, 20k, 40k keys | 86, 172, 344 ms |
| Empty strings in an array | 0.4, 0.8, 1.6 MB | 136, 261, 541 ms |
| 1 MB and 2 MB keys of `a` or backslashes, a bad key after a 2 MB value | — | 9–26 ms (refused) |

A 2.7 MB document with 200,000 keys and one reference is accepted in 556 ms. In EXPLAIN, the only temp blocks come from `generate_series` building the input, none from extract_refs.

## Further findings

- **[Minor] `supabase/migrations/20261102000400_refs.sql:68-70, 89-90`:** the comment says a path step is "at most 68 characters". A step `."<64 chars>"` is 67, and the longest path I measured is 8,510 characters. The bound in the comment is slightly high, which errs on the safe side. Wording only.
- **[Minor] carried over:**
  - The btree primary-key limit on `path` makes uncompressible long paths fail closed with 54000. The temp files are already written by then; they stay inside the 10 MB bound.
  - `cms.revisions.data` has no 1 MB check of its own. The scan is linear, so there is no current exposure.
  - `draft_refs` is still writable by editors (deferred to Task 11).
  - A statement timeout for service_role is parked for Task 11.

## Files
- /Users/einarzoega/litljomi-cms/supabase/migrations/20261102000400_refs.sql
- /Users/einarzoega/litljomi-cms/supabase/tests/database/040_refs.test.sql
- /Users/einarzoega/litljomi-cms/docs/plans/2026-11-01-m0-m1.md (decision 29, line 264)
- /Users/einarzoega/litljomi-cms/docs/architecture.md (§4.3, line 215)
