FAIL

Security review of Task 7, round 3 (fix commit 8883356, `git diff b8d2849..8883356 -- supabase/`). The fix only rewrites the body of `private.extract_refs` and adds tests, so I could judge it on its own and am not asking for a full re-review.

**Result.** The round 2 shape is fixed. The branching trunk with 1,000 deep chains used to write 1.1 GB of temp files; the new walk carries one parent position and one step per node and builds a path only for a reference, and I confirmed it is correct. But the cost bound the fix claims (paths of at most about 8.6 KB, about 8.5 MB of temp files, a 10 MB test bound) is wrong. Object keys made of characters that JSON escapes are still at most 64 characters, but each step of their path is up to about 388 characters. A 117 KB document inside every limit writes 48.8 MB of temp files and is accepted, both as an editor draft save and as a service_role revision insert. That is about 5.7 times the test bound and about 10 times the "few MB" in decision 28.

**How I checked.** Probes ran as `postgres`, impersonating `editor_labak` or service_role through `_helpers.sql`, inside transactions that were rolled back, with `statement_timeout` set to 10s. Probe scripts are in `$TMPDIR/probe3/` (`ctl.sql`, `ctl2.sql`, `gen.mjs`/`check.sql`, `cpu.sql`, `err.sql`), outside the repository. I did not run `db:reset`. `git status --porcelain` shows only the controller's files plus `?? docs/execution/reviews/task-07-r3-spec.md`, which came from the parallel spec reviewer, not from me.

## Checklist items the fix touches

1. **pass.**
   - No function in `api`, `cms`, `private` or `public` is SECURITY DEFINER (count 0).
   - `extract_refs` is invoker and stable, with `proconfig={search_path=""}`.
   - Every function the new body calls has its `pg_catalog.` prefix (`generate_subscripts`, `unnest`, `array_agg`, `jsonb_agg`, `bool_or`, `sum`, `pg_column_size`, `jsonb_path_query_array`, `jsonb_object_keys`, `generate_series`, `array_fill`, `array_to_string`, `to_jsonb`, and so on).

2. **pass.** Schema ACLs are unchanged:
   - `private`: `{postgres=UC, supabase_auth_admin=U, authenticated=U, service_role=U}`
   - `cms` and `api`: `{postgres=UC, authenticated=U, service_role=U}`
   - The helpers in `tests` are created inside the test transaction and rolled back.

3. **pass.** Grants are unchanged:
   - `extract_refs`: `{postgres=X, authenticated=X, service_role=X}`.
   - Every other function in `private` is `postgres=X` only; `passwordless_access_token` is also executable by `supabase_auth_admin`.
   - The table grants are not in the diff.

4.–9. **not applicable.** The fix does not touch RLS, foreign keys, worker or admin functions, the commit or withdrawal. The round 1 results stand.

10. **pass.** The diff contains no secrets.

11.–12. **not applicable.**

13. **fail (contradiction for Einar).** Decision 28 (plan line 262) assumes that its limits ("≤128 levels, keys ≤64 characters, ≤1,000 references") keep "the worst case … bounded at a few MB". They do not, whatever the implementation does:
   - With plain ASCII 64-character keys the stored paths alone are about 8.4 MB (1,000 × 127 steps × 66 characters).
   - Keys are measured in characters of the key itself (spec §4.3, decision 28), but paths store the escaped form. A control character becomes `\u0001`, 6 characters, so a path can reach about 49 KB and 1,000 of them about 49 MB.
   - Meeting "a few MB" needs a ruling, for example:
     - measure keys by their escaped length;
     - cap the total bytes of paths per document;
     - accept about 50 MB as the bound;
     - change how the function returns its rows, so the result does not spill.
   - I am not choosing among these.

14. **pass.** No `.claude/**` file is in the diff.

## Round 2 Major: resolved for its shape, but the bound is still not met (Major)

**What is resolved.** On my own shapes the walk writes no temp files of its own:
- 125-level chain with 2,700 empty siblings per level (1.35 MB): 0 B in 0.13 s
- 300,000 empty objects plus 1 reference: 0 B in 0.08 s
- 1,000 references each beside 300 empty arrays: 0 B in 0.10 s
- 127 references nested inside each other: 0 B in 0.007 s
- balanced binary tree of equal halves (512 references): 0 B in 0.02 s

The test suite's own branching, md5 and deep-blob shapes are also covered.

**[Major] `supabase/migrations/20261102000400_refs.sql:69-89` (cost claim), `:203-206` (result tuplestore), and `supabase/tests/database/040_refs.test.sql` at "A document at every limit at once" and "Adversarial shapes" (10 MB / 1 s bounds).** The stated worst case is not the real one.

- **Probe document** (`ctl.sql`):
  - 126 levels of objects, each with one key of 64 × `chr(1)`.
  - Then an array of 1,000 `{_ref,_kind}` objects.
  - Depth 128, 1,000 references, no key over 64 characters, 117,140 bytes as text.
- **As editor** (`update cms.drafts`, measured with the suite's `tests.cost`): state `00000`, temp_bytes **48,807,936**, elapsed 0.52 s. That gives 1,000 `draft_refs` rows with paths of 48,768 characters.
- **As service_role** (`insert into cms.revisions`, `ctl2.sql`): state `00000`, temp_bytes **48,807,936**, elapsed 0.53 s. Each such publish adds about 795 kB of compressed `revision_refs` paths, kept for good.
- **Index limit:** the btree primary-key limit does not refuse these paths, because the repeated keys compress.
- **Keys mixing `"` and `chr(31)`:** 32.7 MB.
- **Why:**
  - The only temp file is the plpgsql result tuplestore (RETURN NEXT), which spills once it passes `work_mem` (4 MB).
  - Its size is 1,000 × the path length, and the path length is up to 127 × (64 × 6 + 4) characters.
  - The "at limits" test uses plain `k` keys, so it cannot catch this.
- **Exposure:**
  - The run is bounded and linear, and well under the editor's 8 s timeout, so it can be repeated freely.
  - Parallel saves scale it: for example, 60 connections need about 3 GB of `pgsql_tmp`.
  - It is far smaller than round 2's 1.1 GB, but about 10 times decision 28's "few MB" and 5.7 times the test's own bound.
- **Rating:** I rated it Major, not Minor. If unsure, the higher rating applies, and here the decision's stated bound and its required "document at each limit" regression test both miss the real worst case.
- **Possible fixes** (most need the ruling in item 13):
  - limit keys by escaped length, or cap the total path bytes;
  - add a test using a key made of escaped characters;
  - set `work_mem` on the function (this moves the cost to memory, it does not remove it);
  - accept and document about 50 MB.

## Other checks I asked of the fix (all pass)

- **Same references as `strict $.**._ref`.** I generated 458 random documents (`gen.mjs` and `check.sql`). Their keys include `"`, `\`, `.`, `[0]`, `$`, `\u0001`, `é`, an emoji, `_ref2`, `_kind_` and 64-character keys. They contain references inside references, non-string `_ref` values, and children of near-equal size that probe the "child larger than half its parent" rule. Across 1,789 references there were 0 mismatches in:
  - the number of references and of distinct paths;
  - each path evaluating (as a jsonpath) to an object with that `_ref` and `_kind`;
  - the multiset of `_ref` values.
  The XX000 guard never fired.
- **Pre-walk checks.** Their order is unchanged: depth `:129`, then key length `:145-153`, then reference count `:159-163`, all before the walk at `:168`. The diff does not touch these lines.
- **Error codes and the order of `_ref` and `_kind`** (`err.sql`):
  - `{"_ref":null}` raises 22P02 "at $".
  - `{"_ref":5,"_kind":"bad"}` raises 22P02 ("at $."a""), so `_ref` is checked first.
  - A valid `_ref` with a bad `_kind` raises P0001 `invalid_reference`.
  - An uppercase UUID raises 22P02.
  - A non-string `_ref` inside a reference raises 22P02 at `$."a"[0]."b"`.
  - The key `"\u0001\""` gives the path `$."\u0001\""[0]`.
- **Memory.** `v_levels` holds each node's step once, so it is at most about the escaped size of the document. It is in memory, not in temp files.

## Further findings

- **[Minor] `20261102000400_refs.sql:272-274`:** the `XX000` guard is a safe, fail-closed internal error. I could not trigger it.
- **[Minor] carried over:** the btree primary-key limit on `path` (54000, fails closed). `cms.revisions.data` has no 1 MB check of its own: the worker copies drafts, so this has no current exposure. `draft_refs` is still writable by editors (deferred to Task 11).

## Files

- /Users/einarzoega/litljomi-cms/supabase/migrations/20261102000400_refs.sql
- /Users/einarzoega/litljomi-cms/supabase/tests/database/040_refs.test.sql
- /Users/einarzoega/litljomi-cms/docs/plans/2026-11-01-m0-m1.md (decision 28, line 262)
- /Users/einarzoega/litljomi-cms/docs/architecture.md (§4.3 "References inside JSON", line 215)
