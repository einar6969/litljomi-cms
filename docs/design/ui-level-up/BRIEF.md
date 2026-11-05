# Brief: Hub frontend level-up

| | |
|---|---|
| From | Einar, 2026-11-05 |
| Status | **Proposal.** It authorises reading and planning only, until Einar rules on each phase |
| For | The KING (controller) of Litljómi CMS Hub |
| Lives at | `docs/design/ui-level-up/BRIEF.md`, with reference mockups in `references/` |

## 0. The short version

The CMS works. Now it should look and feel like a well-made tool: shadcn-like sharpness with Litljómi's warmth. This is **frontend work**: layouts, components, UX. It doesn't touch routing, server actions, the database, the worker or the SDK. So it shouldn't run through the process built for the security boundary.

There are four phases, each ending with a stop for Einar:

| Phase | What | Ends with |
|---|---|---|
| **0. Simplify the workflow** | A lean "UI fast lane" for frontend-only work | Einar approves the fast-lane rules |
| **1. Design** | You make **your own mockups** in a Design artifact | Einar approves the canvas |
| **2. Build** | Implement the approved design in the fast lane | Einar approves screenshots, then merge |
| **3. Data features** (optional) | Anything that needs new reads | Back on the normal process |

If this brief and `docs/architecture.md` disagree, the spec wins until Einar rules: list the conflict, don't choose.

## 1. Phase 0: simplify the workflow

The full process (fresh implementer per task, separate spec, security and quality reviewers, lanes and tiers, per-task state and checkpoints, a gate per step) exists for the security boundary. It's right for that. For frontend-only work it's too much. The goal: **a screen change should go from request to screenshots in one session**, as quickly as Einar and Claude can work together in chat.

Propose a **UI fast lane**: a short doc, at most a page, for example `docs/process/ui-fast-lane.md`. It must cover the points below. Improve on them if you see better.

1. **What qualifies.** A change is fast-lane only if every changed file is presentation-only. Allowed, roughly: `apps/cms/src/ui/**`, styles and `globals.css`, fonts, the markup and layout of pages and components, `src/i18n/is.ts` (approved copy only), the screenshot spec. Not allowed: server actions, data loading, route handlers, middleware, auth, migrations, `packages/**`, `modules/**`, worker, SDK, `.claude/**`, dependencies. Make it checkable: a small script that compares the diff against an allowlist. If any file falls outside, the change leaves the fast lane and goes through the normal process.
2. **Who does the work.** One session implements directly, without a fresh subagent per task.
3. **Review.** One review per batch, not per task: one reviewer (or a self-review against a short checklist). **Einar's look at the screenshots is the real review.** No security review while the allowlist check passes.
4. **Approvals.** One approval from Einar per phase covers all local work in it. Pushing and merging still need Einar's words, as CLAUDE.md requires, but once per batch, not per task.
5. **Bookkeeping.** At most one short entry per batch, wherever you think is lightest. No task numbers, checkpoints or per-task state for fast-lane work.
6. **Tests.** Existing suites must still pass (CI). Locally, run the CMS unit tests and the screenshot spec.
7. **Changes to `CLAUDE.md` and `.claude/**`.** If the fast lane needs them, propose each as an exact diff. CLAUDE.md requires Einar's approval of the diff.

Keep what protects real things: the gates for pushing, deploying and anything hosted; the boundary lint rules; existing tests and selectors; accessibility.

**Stop:** show Einar the fast-lane doc and any diffs, in plain words, and wait.

## 2. Phase 1: your own mockups

Design the level-up yourself, **in a Design artifact** (Claude's design canvas, the "Design" artifact type). Use the five mockups in `references/` as inspiration, not as the spec. Einar wants to see your take.

- **Cover every screen in scope** (section 4): sign-in and confirm; the app shell; the tenant home; the entry list; the entry form with publish panel and history; the states and notices; the console. Show 1440 px and a phone view (375 px) for each key screen, and the main states (empty, saving, error, conflict, each publish status).
- **Use real content:** the copy from `apps/cms/src/i18n/is.ts`, LABAK's real structure and fields (`modules/labak`, `packages/schema` news type), and the console's real sections. Where data is unknown, use `[placeholders]`, never invented facts. New copy is a draft and must say so.
- **Start from the Hub kit** (section 3), and from Einar's "Litljómi" design system in his account if the Design tool offers it. Refine the kit if you find something better, and say what you changed and why.
- Add a small "kit" artboard (tokens and components) so the build has one source.
- **If no Design artifact tool is available in your session, stop and tell Einar.** Don't silently swap in another format.

**Stop:** send Einar the canvas link with a few lines on the choices you made. Iterate until he approves it.

## 3. Starting point: the Hub kit

Taken from `references/03-hub-kit`. It replaces Task 31's design basis (decision 40) where they differ, once Einar approves.

- **Colours:** canvas `#fbfaf7`; surface `#ffffff`; sidebar `#f6f5f0`; muted `#f1f0eb`; border `#e7e5de`; input border `#a9a79f`; ink `#171714`; ink-muted `#64635b`; accent `#8ed462`; accent-subtle `#eef7e6` with border `#cfe8bb`; accent-text `#4d6c37` (the existing `color-mix(in srgb, #8ed462 45%, #171714)`); warning `#85520a` on `#fcf3e2`; danger `#c8352a`, text `#a82a20` on `#fcefed`.
- **Dark (console only):** canvas `#121210`, surface `#1b1b18`, border `#2a2a26`, ink `#f3f2ee`, muted `#a3a199`. There, green may be text.
- **Accent rule stays:** on light backgrounds, accent is a fill with ink on it, never text or a line. Focus ring in accent-text.
- **Type:** Bricolage 600 for headings, small and tight. Albert Sans 15 px in the editor, 14 px in the console. A monospace face (JetBrains Mono, self-hosted) only for slugs, times, IDs and key hints. Sentence case, no uppercase labels.
- **Shape:** radii 4, 6, 8 and 10–12; 1 px borders; very soft warm shadows. A Hub-only change: the website stays flat.
- **Kept from Task 31:** 44 px tap targets in the editor, fixed px, AA contrast, visible focus, reduced motion, self-hosted fonts only, no UI library (shadcn is a visual reference).

## 4. Scope

**Frontend, fast lane:**
- New design basis (tokens, fonts, components in `src/ui`).
- An **app shell with a sidebar**: wordmark, tenant switcher (the user's tenants), the tenant's content types, help, "Skrá út", breadcrumbs. A drawer on phones.
- **Sign-in** in the split layout of `01-login-a`.
- **Restyle** the entry list, form, publish panel, history and every state and notice.
- **The console** in the dark operator layout of `05`, presentation only and after M4's hosted acceptance (the M4 plan freezes the console until then).
- **UX:** breadcrumbs; the list heading uses the structure's label ("Fréttir", not "Frétt"); consistent "Vistar… / Vistað"; empty states with one clear action; keyboard shortcuts (`Esc`, `/`). No shortcut for publishing unless Einar asks.

**Needs data, so Phase 3 on the normal process, only if Einar wants them:**
- **Tenant overview ("Yfirlit")** from `02`: site status, last published, recent changes.
- **⌘K command palette** from `04`: go to types and pages, and find entries by title across types. Title only, since full-text search is excluded (§10.2). A palette that only navigates (types, shell pages, actions) needs no new reads and can go in the fast lane.
- **Console overview** from `05`: stat tiles, "needs attention", activity.

**Not to be built, even though the mockups show them:** scheduled publishing, user management, plans or subscriptions, a media library, settings pages, "Nýr vefur" in the console, per-client theming, editor dark mode. Most are excluded in §10.2 or contradict decision 40.

**References are inspiration:** their client names (Önnu Konditorí), content types, numbers and copy are invented.

## 5. Decisions for Einar

Give a one-line recommendation for each.

1. The fast-lane rules (Phase 0).
2. Your canvas (Phase 1), and with it the design basis replacing decision 40's where they differ.
3. Name editors see: "Litljómi vefumsjón" (today) or "Litljómi Hub"?
4. The monospace font: yes (Einar supplies the woff2) or no.
5. Which Phase 3 features, if any, and when.
6. New Icelandic copy, verbatim, once drafted.

## 6. Done when

- Every screen in `apps/cms` matches the approved canvas, at 375, 768 and 1440 px.
- Existing suites pass; the screenshot spec covers every screen and state; no change left the allowlist without going through the normal process.
- The fast lane is written down, and it was actually fast: report how long a typical change took, request to screenshots.
