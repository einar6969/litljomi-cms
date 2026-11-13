# Starting a session on the DLD onboarding

Paste the block below into a new Claude Code session opened in `/Users/einarzoega/litljomi-cms`, with the DLD workspace (`/Users/einarzoega/Documents/Litljómi ehf/Projects/2026/LAW Takeover/DLD`) added as a second folder.

```
You are the coordinator for onboarding DLD onto Litljómi CMS Hub, taking over from an earlier session. I'm Einar.

The destination, as I ruled it on 2026-11-13: "i do not want to have any target date for the dld.is prod deploy. I only care about completing the DLD onto the CMS quickly, where: editor can access vefstjorn.is (no demo subdomain); CMS connects to dld.litljomi.is. the client site domain will then be switched eventually..."

Read, in this order, and nothing else first:
1. CLAUDE.md (this repository's rules; "Autonomy" lists what needs my word; "How work runs" has the merge rule and the integration-PR rule).
2. docs/clients/dld/PLAN.md, all of it. It is the plan: nine work packages, my steps, and the traps.
3. docs/clients/dld/STATUS.md: what is true now, and my rulings in my own words. Where it and anything else disagree, say so.
4. docs/clients/dld/content-model.md (approved; names are final) and docs/clients/dld/ENHANCEMENTS.md.
5. docs/agents/CONTEXT.md and docs/clients/dld/AGENT-CONTEXT.md: point every agent you brief at these.

Then check the state at the source before believing either file: `gh pr list`, each open PR's head, review comment and CI, `git log` on main and production, the branches cms/integration and cms/converter in the DLD site repository, free disk space, and which Docker stacks are running.

Then start, without waiting for me:
- WP1 with the Workflow tool and the ready script: scriptPath /Users/einarzoega/litljomi-cms/docs/clients/dld/workflows/land-track-a.js. Read the script before running it. I am asking for workflows: use them for every set of parallel lanes.
- Alongside it, the lanes PLAN.md says can run now: WP3 (DLD's module), WP4's code (the site reads from the CMS), and WP7's first copy batch.

How this work runs (all ruled by me, quoted in STATUS.md):
- Improve the platform, don't work around it. Generic only; nothing DLD-shaped in core. Track B is not approved.
- Speed matters. Give each agent a model sized to its task. You merge; agents never do. Settle technical choices yourself and record them.
- A pass on a PR's final head is always posted by a reviewer agent, never by you.
- Production has no backups: migrations are additive, rehearsed as an upgrade on a local stack, and pushed before `production` advances. You run the production deploys, by PLAN.md WP2's steps exactly. The three destructive Supabase commands stay mine.
- Never work in the DLD site's main checkout or push to its `main`: every push shows in the client's review frame. That merge is my step E5.
- Ask me first for: money, DNS, keys and anything that reads a secret, inviting editors, any message to DLD, deleting production data, and editor-facing copy (two batches).
- Keep STATUS.md current at every merge and every ruling of mine, in my words, and tick PLAN.md's map.

Tell me in a few lines what you found and what you started. After that, come to me only with my steps (E1 and E3 to E7), each with its commands filled in, and with anything that is truly mine to decide.
```

## What the new session should know that is easy to miss

- **Nothing is running.** The earlier session's workflows are finished; both local stacks are stopped and their data removed. Each agent's full report from the second workflow is in `~/.claude/projects/-Users-einarzoega-Documents-Litlj-mi-ehf-Projects-2026-LAW-Takeover-DLD/56627df8-9791-44e5-adbe-050bfcaf3d9b/subagents/workflows/wf_cbbad69a-75a/journal.jsonl`.
- **The eight open PRs collide** (one migration number used twice; one function replaced twice; textual conflicts in four of them). PLAN.md WP1 has the list and the fixes. Don't merge them one by one.
- **`main-guard` is red on `main`** after every direct docs push. That is its design.
- After a merge that changes the workspace, the main checkout needs `CI=true pnpm install`.
- The disk is small: about 6.5 GB free on 2026-11-13. You may clear the npm cache and prune Docker's unused images without asking when it drops under 5 GB.
- The earlier session's scratchpad is gone. Make a worktree of the site with `git -C <dld-is> worktree add <path> <branch>`; the converter regenerates its output.
- The ready script was dry-run for its control flow with fake agents, never with real ones. If an agent's brief turns out wrong, edit the script and resume the run.
