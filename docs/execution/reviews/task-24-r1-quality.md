# Task 24, quality review, round 1 (cms-quality-reviewer)

Diff `31c6b0f..94566a2` in `.worktrees/lane-a-alt`. Report as returned by the reviewer:

PASS. lint clean, typecheck clean, `pnpm test` 57 files 1024 passed; diff, action/upload/field tests and e2e support read; no database, stack or e2e. No Critical or Major findings: database errors are thrown, not read as "not found"; every action maps to a code; the browser never supplies metadata; tests use real sharp images, exact RPC arguments, and cover the rejection paths.

Minors:
1. `asset-actions.ts:~44`: parameter `assetId` shadows the module zod schema `assetId`; rename.
2. `asset-actions.ts`: `failureOf(...) === 'auth' ? 'auth' : 'error'` written twice; a `rpcFailure(result)` helper (touches action error mapping: security review if done).
3. `upload.ts` comment and `upload.test.ts` describe: "review focus 4" is unresolvable for a later reader; name the behaviour.
4. `ImageField.tsx`: repeated code-to-notice ternaries (a `noticeFor(code, fallback)`); filename re-derived from `prepared.path`; have `prepareUpload` return it (touches upload path derivation: security review if done).
5. `ImageField.tsx` `<img onError>`: after three re-signs it stops silently; show `previewError`, name the constant.
6. `ImageField.tsx`: long positional `updateAsset(...)` calls; wrap or use an object.
7. `RichTextField.tsx` `onUpdate`: no test that the stored value is kept unchanged when the document does not validate.
Test robustness (no action): `fields.test.tsx` `flush()` with `setTimeout(0)`; prefer `vi.waitFor`.
