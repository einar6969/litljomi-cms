# Phase 4 follow-up (decision 39.3), spec review, round 1 (cms-spec-reviewer)

Diff `288bbe2..df055f4` in `.worktrees/lane-a-alt`. Report as returned by the reviewer:

PASS. No Critical or Major findings. Commands: `git diff`/stat, grep, `pnpm -C . lint` and `typecheck` clean; the unit run showed only certificate noise (relied on the controller's 1120 passed); no database or e2e (relied on the controller's results).

1. `20261102001600_asset_tenant_active.sql` replaces `register_asset` and `update_asset` with the same signatures, invoker, `search_path ''`; both raise `tenant_inactive` (P0001) before any write when the tenant is not active; an invisible tenant row fails closed; `register_asset` checks membership first (non-member still `not_found`); `update_asset` takes the tenant from the asset row. `101_asset_tenant_active.test.sql`: 17 assertions (catalog and grants, suspended tenant, fail-closed, no write, active path). Nothing else in the database changed.
2. `status.ts:94`: delivered release with `site_count` 0 → "Enginn vefur tengdur", tone `error`, final (polling stops); omitted checked first; before delivery still "Í birtingu…"; covered in `status.test.ts` and `publish-panel.test.tsx`.
3. `SlugField.tsx`: suggestion as placeholder; value `typed ?? saved ?? ''`; empty field saves the suggestion; unit and e2e tests.
4. `RichTextField.tsx:47`: `aria-labelledby` kept, `aria-label` added; unit test and e2e `toHaveAccessibleName`.
5. `editing.spec.ts` records the finding (headless Chromium day-month-year for both locales; "14112026" → 2026-11-14 in a plain input and ours); a second test saves and reloads; `DateField` unchanged.
No styling (no className or stylesheet).

Rulings: `tenant_inactive` mapped to the generic `'error'` code accepted (asserted in `asset-actions.test.ts`); the `'error'` tone for "Enginn vefur tengdur" accepted (final, never success).

- [Minor] `docs/architecture.md` §7.4 does not list "Enginn vefur tengdur"; an addition authorised by decision 39.3, no contradiction.
