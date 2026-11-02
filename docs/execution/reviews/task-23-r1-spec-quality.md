# Task 23, combined spec-and-quality review, round 1 (cms-quality-reviewer)

Diff `6c368c2..31c6b0f` in `.worktrees/lane-a-next`. Report as returned by the reviewer:

PASS

Commands: `pnpm lint` 0, `pnpm typecheck` 0, `pnpm test` 51 files, 938 passed; full diff and decision 37.6 read. No e2e, database or stack; relied on the controller's e2e result (editing 5 passed, auth 4 passed).

No Critical or Major findings.

Spec: every Create and Test file exists, plus design extras (`SlugField.tsx`, `NewEntryButton.tsx`, `descriptors.ts`, `server/entry-context.ts`, `[tenant]/page.tsx` links, `is.ts` strings), small and in scope. Consumed interfaces used as written; e2e strings exact ("Brauð ársins 2025" → `braud-arsins-2025`; "Vistað"; "Annar notandi breytti færslunni"; "Slóðin er þegar í notkun"). Task 23 interfaces match; extras additive (`code: 'error'`; `setSlugAction` returns `{ ok, slug }`; `useAutosave` also returns `schedule`/`retry`, optional `sessionIsValid`); debounce 1500 ms. Decision 37.6: tenant only via `api.my_tenants` (`resolveTenant`, `loadEntryContext`); unknown type and inactive tenant rejected; zod argument validation; component-less field kinds show `role="note"` and are sent back unchanged (unit and e2e); demo labels untouched. Review focus 1 (`signed_out` keeps and resends pending data; e2e session-expiry) and 5 (slug-taken e2e) covered. No contradiction with the spec.

Quality, Minor:
- `apps/cms/src/i18n/is.ts` (`entries.open`, `editor.unsaved`): unused keys.
- `apps/cms/src/editor/autosave.ts` (`useAutosave`): `schedule`/`retry` are new closures each render, defeating `useCallback([schedule])` in `EntryForm.tsx`; memoize.
- `SlugField.tsx`, `fields/{LinkField,TextField,DateField}.tsx`: no unit tests (LinkField "invalid text not saved", slug notice mapping); add jsdom tests.
- `autosave.ts` (`flush`): `saveDraftAction` costs three reads plus the RPC; acceptable for the security design; a comment to prevent "optimizing" it away.

Tests can fail on regressions (1499/1 ms boundary, `toHaveBeenNthCalledWith(2, ENTRY, 4, …)`, conflict stops further saves; actions make no database call on rejected input, do not echo raw messages, strip unknown keys). Unit tests written after the code; assertions behavioural and specific. No quality suggestion touches security-relevant code.
