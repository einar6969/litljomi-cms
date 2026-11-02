# Task 25, spec review, round 1 (cms-spec-reviewer)

Diff `eeaf219..f84b096` in `.worktrees/lane-a-next`. Report as returned by the reviewer:

PASS. Meets the task text, decisions 35, 36 and 37.8, spec §6.3 and §7.4. No Critical or Major findings. Diff and files read; no commands run (relied on the controller's lint, typecheck, test, pgTAP and e2e).

Rulings: (a) `displayState(row, { fieldLabels }?)` acceptable (optional, backward-compatible; raw keys without it); ratify. (b) the demo site as a second Playwright `webServer` that waits for the first release, with `publish.spec.ts` making it through the UI: acceptable, loopback-only, checked by the e2e-loopback test. (c) a tenant with no active site stays "Í birtingu…" and keeps polling: fail-closed (`sites > 0` required for every success, not-confirmed and revalidated state); ratify and record. (d) `aria-live="polite"` + `data-testid="publish-state"` instead of `role="status"`: acceptable (the form's save status already has the one status region the specs select). (e) every status maps to exactly one label; "Birt á vef ✓" only when `release_status = 'delivered'`, `site_count > 0` and `sites_live_ok === site_count` (active sites, the request's own release only); pending/validating/committed (building, failed, not all notified) "Í birtingu…"; delivered and all notified "Bíður eftir vefnum"; omitted (publish) or `notify_attempts >= MAX_NOTIFY_ATTEMPTS` "Birting á vef mistókst"; all settled with one `not_confirmed` "Ekki staðfest á vef"; failed_validation "Ekki hægt að birta: …" naming the missing image for `asset_missing`; superseded, rejected ("Ekki heimilt að birta"), failed ("Birting mistókst. Reyndu aftur síðar.") each their own; unknown status fails closed as failed; "Tekið af vef" detail claims no cache removal. `MAX_NOTIFY_ATTEMPTS` in `src/lib/delivery.ts`, re-exported from `deliver.ts`. The migration is `security_invoker`, `authenticated` SELECT only, no function added.

Deferred row "24 quality r1": items 1–3 done (`assetIdShape`, `authOrError`, wording); items 4–7 and the `flush()` note left open; the controller must re-own them (e.g. to C3, the security-relevant ImageField item flagged) or have them done.

Minors:
- `status.ts:80-93`, `PublishPanel.tsx`: a tenant with no active site polls forever; record and decide the display.
- `deferred-minors.md` "24 quality r1": items 4–8 still owned by Task 25; re-own or send to an implementer.
- `status.ts:50`: optional `{ fieldLabels }` beyond the plan signature; update the plan with the ratification.
- `PublishPanel.tsx:138`: state markup (`aria-live` + `data-testid`) unspecified by the plan; note it.
