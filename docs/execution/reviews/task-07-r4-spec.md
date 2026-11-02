PASS

No findings. Decision 29 is met, nothing regressed, and nothing off-task was added.

Commands run (read-only): `git diff 8883356..72860c1 --stat`, `git diff … -- supabase/migrations`, `git diff … -- supabase/tests`, `git status --porcelain`, a Node script that scans every key in the fixtures against the pattern, and greps over `packages/schema`, `packages/rich-text`, `modules/*` and `supabase/tests/database`. I did not run `pnpm db:reset` or `pnpm db:test`. I relied on the controller's output (Tests=496, PASS).

**Decision 29 in `supabase/migrations/20261102000400_refs.sql`**
- The 64-character key check is replaced with `m.a[1] !~ '^[A-Za-z0-9_-]{1,64}$'` for every string followed by `:`. It sits in the same regexp pre-walk, with the same `regexp_matches` call in the select list and the same `exists` shape.
- The error is 54000 with the message `object key does not match ^[A-Za-z0-9_-]{1,64}$`.
- The order is unchanged: nesting, then key pattern, then reference count, then the walk.
- The empty key is refused, because `{1,64}` fails on an empty string.
- Testing the escaped text rather than the decoded key is exact. Any escape starts with `\`, which the pattern forbids, and the migration comment says so.
- No cap on total path size was added. The comments document the ~10 MB worst case (127 steps of at most 68 characters, 1,000 paths).

**Existing documents still pass**
- `packages/schema` field keys are `title`, `date`, `excerpt`, `image`, `body` and `source` in `news.ts`. The demo event module uses `title`, `startDate`, `endDate`, `location`, `description` and `registration`. The nested field value shapes use `_ref`, `_kind`, `alt`, `href` and `entry`.
- My scan of `modules/labak/fixtures/news.json` and `modules/demo/fixtures/event.json` covered 37 keys and found none outside the pattern.
- The rich-text v1 keys are `type`, `text`, `marks`, `attrs`, `content`, `href`, `entry`, `level`, `start`, `asset`, `alt`, `caption`, `_ref` and `_kind`. All match.
- Stored documents in `supabase/tests/database/*.sql`: the only quoted keys outside `040_refs.test.sql` are `title`, `breytt` and `x` in the content tests. The others in `012_auth_hook` are JWT event keys, not draft data. The full suite passes per the controller.

**Tests in `supabase/tests/database/040_refs.test.sql`**
- Flipped tests are consistent with decision 29:
  - The 64-multibyte-character key is now refused. It was allowed under decision 28.
  - The 64-character key with escaped characters is now refused. It was allowed under decision 28.
  - Both carry comments saying they were allowed under decision 28.
- The edge-case document renamed `we"ird key` to `we-ird_Key9` and `þýðing` to `thyding`. The old keys would now be refused, so this is required by decision 29. The expected paths and the test name were updated to match.
- The control-character regression test is present, with a 117,140-byte, 128-level document of 64×`chr(1)` keys and 1,000 references. A sanity test checks the shape. The probe is run as a draft save and as a revision and expects 54000 with `temp_bytes = 0` and under 1 s, so it fails if the check regresses.
- The other new tests also fail on regression:
  - 12 bad keys at 5 places, counted as 60 documents.
  - An `is_empty` test that lists any refused-key document that is accepted or fails another way.
  - Per-key `throws_ok` tests.
  - An accepted-key test.
  - Three ordering tests.
  - A string-values-are-not-keys test.
- The 10 MB test bound is kept. The plan count went from 163 to 187, which matches the 24 added tests.
- The adversarial-shape key check was updated to the new pattern.
- Draft and revision 54000 tests were updated to the new message. The earlier rounds' structure is untouched.

The diff outside `docs/` touches only the migration, the test file and `.claude/agents/cms-security-reviewer.md`. The `.claude` change is a separate approved commit, `6a253c3`.

`git status --porcelain` is unchanged: `docs/execution/progress.md` and `docs/execution/state.json` were already modified before I started.
