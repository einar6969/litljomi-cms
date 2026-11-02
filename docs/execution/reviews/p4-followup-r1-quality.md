# Phase 4 follow-up (decision 39.3), quality review, round 1 (cms-quality-reviewer)

Diff `288bbe2..df055f4` in `.worktrees/lane-a-alt`. Report as returned by the reviewer:

PASS. `git diff`; `pnpm lint` and `typecheck` printed no error (tails read, not exit codes); `pnpm test` 61 files 1120 passed; migration, pgTAP and e2e not run.

Minors:
- `editing.spec.ts` date block: `context.newPage()` "plain" pages never closed; `await plain.close()`.
- `editing.spec.ts`: the finding string emitted twice (`console.log` and annotation); keep one or a helper.
- `editing.spec.ts` "a date typed in the browser's segment order is saved": the `SEGMENT_ORDERS` search is more machinery than needed but adds save-and-reload coverage; keep; scope `page.getByRole('status')`.
- `SlugField.tsx`: comment that `value` is what gets saved.
- `status.ts`: `sites === 0` precedes the `notify_attempts` check, so a site-less tenant never shows "Birting á vef mistókst" once delivered; covered by tests; any change goes back through security review; none proposed.
- `status.test.ts`: the weakened `not.toBe('ok')` assertion is redundant next to the new exact test.

Tests check behaviour (SlugField typing, empty-field suggestion save, no-suggestion disabled; RichTextField name; PublishPanel no-site final, polling stops, button re-enabled; asset-actions `tenant_inactive` mapping; status ordering).
