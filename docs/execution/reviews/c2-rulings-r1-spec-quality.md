# C2 rulings documentation change, combined spec-and-quality review, round 1 (Sonnet)

Verbatim report.

FAIL

I ran `node --test "tools/harness/__tests__/*.test.mjs"`: 32 of 32 pass. `node tools/harness/state.mjs show` names Task 30 as next, placed after 21 and before 22. I ran no database command, and the working tree is unchanged.

**Reading of the second "5." and "6."**
Reading them as report items 7 and 8 is the only sensible one.
- The first group "5, 6, 9" matches report items 5 (no declared checks), 6 (marker parser) and 9 (stricter live check). Those are exactly the "Limits" and §7.3 material, as Einar said.
- The second "5. Accepted for local tests only" matches item 7 (the local script that reads the secret key).
- The second "6. Task 28 verifies the role timeout…" matches item 8 (hosted `statement_timeout`).
- Read literally, the second 5 and 6 would collide with the first group.

**Findings**

[Major] spec: docs/plans/2026-11-01-m0-m1.md:1457 (Task 30, "Missing private files"). The wording "an entry that is already live keeps its previous projection" does not mean the same as Einar's "entries already live are never dropped". It adds a behaviour and contradicts the spec.
- Spec §7.1 (docs/architecture.md:443-447) allows reusing a previous projection only if the previous projection came from the same `revision_id` that is published now. Otherwise the entry is left out.
- The M1 milestone row (architecture.md:722) says the fallback rule comes in M3.
- Plan line 313 says that in M1 a regression can remove a previously live entry.
- A live entry whose newly committed revision needs the missing asset has a different `revision_id`. Keeping its previous projection there breaks "withdrawal always wins" and "a newer revision never falls back to older content".
- The sentence "left out of this build only if they are newly committed" is also ambiguous about an already-live entry with a new revision.
- Einar's ruling is only: the request fails with an error code and an alert, and live entries are not dropped as a side effect.
- Fix: reword Task 30 to state the outcome without a projection fallback. For example, the failing request is failed, and the entry stays as published at its currently published revision, because the commit does not take effect for it. Say what happens to the commit, which the text does not say.
- If the controller means a real fallback, that contradicts the spec (§7.1 and the M3 deferral). Report it to Einar rather than resolving it here.

[Minor] spec: docs/plans/2026-11-01-m0-m1.md:279 (decision 36, item 3). Einar wrote "against ready releases". The decision says "delivered releases".
- The spec's release statuses are `building`, `delivered` and `failed`, so there is no "ready" status. "Delivered" is the sensible mapping.
- The decision says it quotes Einar verbatim, so the paraphrase should be flagged, for example "(ready = delivered)".

[Minor] spec: docs/plans/2026-11-01-m0-m1.md:1528 (Task 25 amendment). Einar said a delivery that runs out of attempts shows as "delivery failed". Showing a request failed with `asset_missing` as "Birting á vef mistókst" is the controller's addition.
- It is plausible. But `asset_missing` is itself "e.g." in Task 30, and a failed request may suit the `failed_validation`-style error line better.
- Mark it as a consequence of 36.4, or leave it to Task 25's design.
- The Task 25 body (line 1545) still says `live_status = 'confirmed'`. The amendment overrides it, but the body is stale.

[Minor] quality: docs/architecture.md:507 versus architecture.md:552. §7.4 now says that in M1 the alert goes "through the audit log and the server log; by email from M3".
- §8.4 (line 552, "Monitoring and alerts") still says exhausted retries email the platform admin, with no milestone.
- The text added is more than Einar ruled. "Raise an alert" is all he said, and the audit-log wording describes what Task 21 already does.
- No hard contradiction, because line 552 describes the target state. Add "(from M3)" there, or drop the M1 channel detail from §7.4.
- §7.4 also now uses "delivery failed" for two things: an entry left out (§7.1) and exhausted attempts. That is slightly ambiguous but acceptable.

[Minor] quality: docs/architecture.md:476 and :506. The spec cites "plan decision 36" in two places. The spec is the higher authority, and it should not depend on the plan for its meaning. The text itself is self-contained, so this is only a cross-reference note.

[Minor] quality: docs/plans/2026-11-01-m0-m1.md:276. Decision 36 sits between 33 and 34, out of numeric order (the order is 33, 36, 34, 35).
- Its quote also appends the "Fast-forward main…" sentences, which are not in the task text given to me. They may come from the same message, but I could not confirm that.
- The same text is in state.json's `approval` field.

[Minor] spec: docs/plans/2026-11-01-m0-m1.md:410 (Task 0 text) still says "for Tasks 0–29". The plan-index now has 31 entries. Line 108 (the Lane B description) does not mention Task 30 either, though the Phase 4 diagram and Task 30's own header do. These two stale mentions are the only counts and lists I found not updated.

**Checked and fine**
- Items 1, 2 and 6 of decision 36 are faithful: 10 attempts, one retry per sweep, the alert and "delivery failed"; `building` older than the maximum duration plus a margin; finish only while `building`; Task 28 checks the role timeout first and stops and asks if it is refused.
- The Task 28 amendment sits in the G3 step before `db push`, as ruled.
- Item 4's "previous bundle unreadable still fails with an alert" is preserved.
- The §7.4 "Limits" additions match report items 5 and 9.
- The §7.3 addition matches item 6.
- The "absent needs 200 on another page" rule is a documented tightening of the "absent" rule, not a contradiction.
- Plan index: Task 30 is phase 4, lane B, high tier, sensitive, `dependsOn` [21], with gates G0 and G1; Task 25 `dependsOn` [24, 30].
- Harness: `state.schema.json` has 31 tasks and a maximum id of 30. `state.json` has Task 30 pending and in order. The C2 approval is recorded with the quote. The tests (`EXECUTION_ORDER`, sensitive, tier, lane, phase and dependency assertions, 31 tasks) are consistent.
- The High-tier and security-sensitive lists include 30. The "31 tasks (Task 0 to Task 30)" count is updated.
- Task 30 itself is a medium-risk addition: "a margin", `asset_missing` and the 300 s figure are the controller's design choices. The 300 s `maxDuration` is the existing worker value, and the code is marked "e.g.".

Files: /Users/einarzoega/litljomi-cms/docs/plans/2026-11-01-m0-m1.md, /Users/einarzoega/litljomi-cms/docs/architecture.md, /Users/einarzoega/litljomi-cms/tools/harness/plan-index.json, /Users/einarzoega/litljomi-cms/docs/execution/state.json
