# Context for agents working on DLD

Read this instead of exploring. For Hub-side work also read `docs/agents/CONTEXT.md`.

## The two repositories

| | Hub | DLD's site |
|---|---|---|
| Path | `/Users/einarzoega/litljomi-cms` | `/Users/einarzoega/Documents/Litljómi ehf/Projects/2026/LAW Takeover/DLD/dld-is` |
| Remote | `einar6969/litljomi-cms` | `einar6969/dld` |
| What lives there | `modules/dld`, the generic import command | The site, the converter that reads its content, the CMS integration |

## What is decided (don't reopen)

- **The content model:** `docs/clients/dld/content-model.md`, approved 2026-11-12. Type and field names are final.
- **The site leaves static export** (`output: "export"`), stays statically generated, and gets a revalidation route and a preview route.
- **Rulings and their wording:** `docs/clients/dld/STATUS.md`.

## Facts already established (cite, don't re-derive)

- **The site's code and content today:** `docs/clients/dld/recon/site-map.md`. §2 is every content type and field; §3 the text format; §4 relations, ordering and build-time checks; §5 media; §6 the data seam (about 100 imports of content in 54 files).
- **Leaving the export:** `docs/clients/dld/probes/site-without-export.md`: the exact config changes, the checks that proved all 64 pages unchanged, and four open risks.
- **The editor and publishing:** `docs/clients/dld/probes/editor.md`.

## Rules for work in `dld-is`

- **Never work in the main checkout and never push to `main`.** Every push to `main` shows in the client's review frame at once. Use the branch and worktree your brief names.
- Read its `AGENTS.md` first: this Next.js differs from older versions, so check `node_modules/next/dist/docs/` before relying on an API.
- Its `README.md` lists the invariants: 64 URLs, one `<h1>` per page, the noindex switches, all copy in `src/content/`.
- **The client's copy is reproduced verbatim.** Never reword, correct or translate it.
- The repository has no tests and no lint. The check is `npm run build`, plus the behavioural checks your brief names. **No screenshots, pixel diffs or capture scripts.**
- Atomic commits, one logical change each, each building on its own. Tag a rollback point before the first change if your brief says so.
- No client contact details, prices or correspondence in anything you write to the Hub repository: it is public.
