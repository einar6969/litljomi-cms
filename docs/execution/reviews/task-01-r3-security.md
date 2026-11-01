# Task 1 (Monorepo skeleton, boundary checks and CI): security review, round 3 (scoped to fix round 3)

- Reviewer: fresh `cms-security-reviewer` (Opus), 2026-11-01
- Change: fix-only `f05e33b..6a48046` (6a48046); ESLint 9.39.5, esquery 1.7.0
- Result: **PASS**. M1, M3 and the double-report item ADDRESSED; `esqueryRegex` change loosens nothing; 1 new Minor (N1, pre-existing) and 1 quality note.
- Method: round 2 probes plus new probes against copies of the config at f05e33b and 6a48046 (`scratchpad/task1/secrev3/`); every generated selector parsed with esquery and compared; nested-config, Node and tsc experiments in throwaway `$TMPDIR` directories.

## Checklist (verbatim in substance)
1–9, 11, 12: not applicable. 10: pass (no secret values committed; the name appears only in `.env.example`, `eslint.config.mjs` and the boundary tests; no secret logging; every name form caught before is still caught; `eslint -c eslint.config.mjs .` exits 0 on the repo with and without `ESLINT_FLAGS=v10_config_lookup_from_file`). 13: pass (the fix narrows the registry exemption toward §3.1 line 135). 14: pass (`git diff --stat f05e33b 6a48046 -- .claude .github` empty; only eslint.config.mjs, package.json lint script per C-M3, two test files).

## Verdicts
- M1 ADDRESSED: `eslint.config.mjs:18` `modules/(?!registry(\.[^/]*)?$)`. All 6 reg.json bypasses missed before, caught now by the correct rule; further `/`-separated escapes caught (`registry.ts/`, `registry/..`, `x/../registry`, `registry?../labak`, `modules//registry/../labak`, `modules/./registry/../labak`, `./modules/registry.ts/../../modules/labak`, `modules/labak/modules/registry`, template `import()` from packages, static and dynamic inside privileged/). Any `modules/` occurrence not followed by registry-at-end forbids the specifier. 13 legitimate registry import forms stay clean.
- M3 ADDRESSED: `package.json:8` `eslint -c eslint.config.mjs .`. With nested configs turning the rules off (one setting `noInlineConfig: false`): without `-c` under `v10_config_lookup_from_file` ESLint exits 0; with `-c` both violations reported in every mode (no flag, env var, `--flag v10_config_lookup_from_file`, `--flag unstable_config_lookup_from_file`, explicit file args). Mechanism: `lib/config/config-loader.js:536-538`. CI runs `pnpm lint` from the root; no package defines its own lint script.
- Double report / comment ADDRESSED: comments at `:49-57` hold; 62-case corpus: everything caught before still caught, only same-column duplicates removed; round 2 secret.json 73/85 under both configs; each `secondNameNode` exclusion (`:58-63`) removes only the second node of a pair whose first node is reported; `import { k as KEY }` and `export { k as KEY }` still reported.
- `esqueryRegex`: all 122 rule entries parsed; only `[/]` → `\x2f` (same character); static patterns unchanged; round 2 imports.json 49/70 under both configs, identical output.
- Residual ``import(`@/modules/registry${p}`)``: exempt before and after; accepted S8 class; not worse.

## New findings
- N1 (Minor; predates the fix, not worse): `eslint.config.mjs:12`, `:18`, `:20` do not treat backslash as a separator. Unmatched or exempt: `@/modules/registry.x\..\labak`, `../modules/registry.x\..\labak`, `import('./modules/registry.x\..\labak')`, `@/modules\labak`, `../privileged\admin-client` from editor code, `../../../apps\cms/src/x` from packages. Node 22 ESM and `tsc --traceResolution` (bundler, `paths @/*`) resolve such specifiers; Next.js bundler not checked. Same class as M1: deliberate obfuscation visible in review. Possible remedy: `[/\\]` as the separator in the three path regexes.
- Note (quality): the comment at `eslint.config.mjs:57` says a name written twice is reported twice (`{ KEY: KEY }`, true), but `import { KEY as KEY }` / `export { KEY as KEY }` are now reported once. Coverage unaffected.

No permission denials or sandbox refusals; nothing written in the repository.

## Controller ruling
- N1 parked: deliberate backslash obfuscation in an import specifier is visible in code review and is the same class as the accepted S8 limits; Task 17 relaxes these same rules for the worker routes under a security review and takes N1 (`[/\\]` separators) then. Cost if wrong: an obfuscated import could pass lint until Task 17; reviewers still see it.
- Comment note: carried to the round 3 quality review.
