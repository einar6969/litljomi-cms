# Task 16: combined spec-and-quality review, round 1

- Reviewer: fresh `cms-quality-reviewer` (Sonnet) in combined mode, 2026-11-02 (a security review ran in parallel)
- Change: 11b7c93 on `m1/lane-b`
- The reviewer's report, verbatim:

---

PASS

Commands run (all in the worktree): `git show 11b7c93`; `pnpm lint`, `pnpm typecheck`, `pnpm check:slugs` and `pnpm test`; `git status --porcelain` (empty before and after). Lint and typecheck are clean. check:slugs reports ok (2 slugs). Tests: 21 files, 301 passed. I did not re-run the failing-first state.

**Spec**
- spec: Everything the task lists is present with the exact names and signatures. That covers `newsType`, `defineModule`, `ModuleManifest`, `SiteIntegration`, `LiveCheck`, `SiteEntry` and `ReleaseView`, plus both module packages (depending only on `@litljomi/cms-schema`) and both fixtures. The workspace and tsconfig entries are needed for the new tests to run.
- spec: The labak overrides and `secondaryImage` match the task text. `HOME_LATEST_COUNT` is 6. The `/` check uses the release while the entry is published and the previous release once it is gone. Tests cover the 7th entry having no `/` check, an unpublish at position 2 giving three `absent` checks, an absent entry that was not in the previous release's first six, and no previous release.
- spec: Demo's `event` type has no library type and no required image, and a test asserts exactly `title` and `startDate` are required. The registry belongs to Task 17, as the task text says.
- spec: Deferred Minors, each cleared with a test:
  - `canonicalJson` rejects non-plain objects and treats sparse holes as null.
  - Codegen rejects duplicate type names.
  - The image alt comment is fixed.
  - `defineType` validates field keys, and `extendType` goes through it.
  - The ESLint rule for the rich-text editor entry is added.
  - The ESLint rule for module-to-module imports (Task 1's S6) is added.
  - The `{ entry: null }` interface note is a documentation point and needs no code here.
- spec: Decision 25 is implemented once, as `canonicalUuid` in rich-text, reused by `refSchema` and the image field. It is lowercase 8-4-4-4-12 only, strings only.
- Judged against the old `z.guid()`: `z.guid()` accepts any-case hex, so the "upper case" tests in `ref.test.ts` and `doc-schema.test.ts` would fail against it. The braces, unhyphenated, null, trailing-newline and urn cases were already rejected by `z.guid()`. They guard the new regex but could not have failed first. That is acceptable, because the tests cover the decision's whole set and the upper-case case is the discriminating one.
- Test-first deviation: acceptable. The 40 failing-first run covered the module work, and the one discriminating decision-25 case demonstrably fails on the old code.
- Task 17 note: the registry's `getType('labak', 'news')` and `getType('demo', 'news')` checks are still to come there.

**Quality findings**
- [Minor] quality: eslint.config.mjs (the `otherModulePaths` comment and regex): the stated limit is real but not written down. A module-to-module import by a relative path with no `modules/` segment (for example `../../demo/src/index` from `modules/labak/src`) is not caught. The `(^|/)modules/` regex also forbids a legitimate `./modules/x` folder inside a module. Suggested change: add a one-line comment naming both limits, and add a test case documenting the uncaught form.
- [Minor] quality: pnpm-lock.yaml: it also drops the `happy-dom`, `ws` and `buffer-image-size` packages, which this task does not touch. Nothing references `happy-dom` in any package.json, so this looks like stale-lock cleanup. Suggested change: say so in the progress note.
- [Minor] quality: modules/labak/src/index.ts and modules/demo/src/index.ts: `path()` throws on a null slug, where the task text writes `'/frettir/' + e.slug`. That is the safer behaviour and is tested for labak. Demo's throw has no test; add one.
- [Minor] quality: packages/schema/src/define-type.ts: `FIELD_KEY` forbids a leading underscore, while codegen's `IDENTIFIER` handling still allows non-identifier keys. This is harmless dead tolerance, but the two rules now disagree. Consider a pointer comment in codegen.

**Security-relevant**
No change suggested above touches security code, except that any edit to `canonicalUuid` or the `defineType` key check would need to go back through the security review.

---

## Controller ruling

PASS accepted. The Task 16 rows in `deferred-minors.md`, and Task 1's S6, are marked cleared by 11b7c93, subject to the parallel security review.

The new Minors are deferred:
- to Task 17, which creates the registry and touches lint again: the ESLint limits comment and test case, the demo null-slug test, and the codegen pointer comment;
- to the progress note, written at the merge: the lockfile pruning, which the controller verified (no `package.json` references `happy-dom`; frozen install succeeds), with security confirmation pending.

The `/frettir` check stays `absent` for an unpublished entry, as the task text says.
