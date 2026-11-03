# Decision 49.1: quality review r1 (cms-quality-reviewer, 2026-11-03)

Scope: the uncommitted decision 49.1 diff on `m1/phase-1` (HEAD `120dcca`), against spec §7.2 and §7.4.

**Verdict: PASS.** No Critical or Important findings. Reviewer ran `pnpm test` (73 files, 1381 pass) and `pnpm lint`.

Minors:

1. `deliver.ts` (`awaitPublicPointer`) and `pointer-fresh.ts`: documented as never throwing, but `supabaseUrl()` is called outside any try and throws when `NEXT_PUBLIC_SUPABASE_URL` is unset (unreachable today: `mediaPrefix()` throws first). Wrap it so the worker logs and notifies anyway, or narrow the comment.
2. `pointer-fresh.ts:14-19`: the bound comment is garbled. Rewrite as a short sum (300 = up to 110 before the write + 120 poll + 10 notify + 60 live check) and say `FINISH_MARGIN_MS` is the notify/records allowance.
3. `pointer-fresh.test.ts`, per-fetch timeout test: monkey-patches the global `AbortSignal.timeout`; use `vi.spyOn` or assert on behaviour.
4. `deliver.ts:208-218`: the resend log sits inside the `once` wrapper; a throwing `notifySite` would skip it (fine today, `notifySite` never throws).
5. `WORKER_MAX_DURATION_MS` is re-exported from `deliver.ts`, which no production code needs.

Holds: bound arithmetic (`min(writtenAt + 120 s, runDeadline − liveTimeout − 10 s)`, at most 230 s into a run); run deadline set once in `pipeline.ts`; only fresh deliveries poll, once per release; pointer URL via `deliveryPointerPath`; poll hardening (no-store, no redirects, bounded fetches, any failure is "not fresh yet"); test coverage (fresh at once, after a lag, never within the bound, clamp, past bound, order poll→notify, retry path, logs); logs carry no URLs or secrets; `live-check.ts` unchanged.
