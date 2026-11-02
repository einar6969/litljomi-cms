# N1 investigation probes (evidence only)

Copied unchanged on 2026-11-02 from the throwaway local project used in the N1 investigation (`docs/verification/n1-passwordless-investigation.md`), so the evidence survives the session. They are not part of the build or the test suites, and they ran against a throwaway local Supabase stack, never against the repository's database or a hosted project. Keys were read from the environment (`supabase status -o env`) and are not in these files.

- `hook-as-tested.sql`: the hardened hook exactly as tested (it adds an evidence-only `probe_method` claim that the production hook must not have; decision 18).
- `probe.mjs` with `probe-run3.txt` (first hook) and `probe-run5.txt` (hardened hook, confirmations on): 25 HTTP checks.
- `hook_unit.test.sql` (30 assertions), `sessions.test.sql`, `sideeffects.test.sql`, `amr_shapes.test.sql`: database checks.
- `adversarial.mjs`, `adversarial2.mjs`, `emailchange.mjs` and their `*-run*.txt` outputs: the independent reviewer's attack scripts (`docs/execution/reviews/n1-investigation-security.md`); the `-final` runs are on the hardened hook.

Tasks 4 and 12 reproduce these as tests (plan decision 18).
