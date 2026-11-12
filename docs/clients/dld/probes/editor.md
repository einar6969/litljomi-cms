# Probe: a portfolio-shaped tenant in the Hub editor

Run on 2026-11-12, on the **local** Supabase stack only (loopback). A throwaway probe: nothing built
here is kept. The probe code is on the local branch `probe/dld-shape` (never pushed); this report is
the one file added to `main`. It answers one question: what is the Hub's editor like, by real use,
for a tenant shaped like a portfolio site, and where does it get in an editor's way?

**Short answer.** The editor holds the shape: every field kind rendered, autosaved, validated and
published, at 1440 px and at 375 px, and the publish status told the truth for entries with a page
of their own. Seven things would stop or seriously slow a real portfolio client:

1. **Nothing can be thrown away.** The editor has no control that deletes or archives a draft
   entry, and none that removes an uploaded image. The database API has both (`api.archive_entry`,
   `api.archive_asset`); no button calls them (section 9).
2. **A gallery is one file at a time.** 12 images are 36 presses plus the typing, in a list that is
   5,200 px tall at 1440 px and 8,100 px at 375 px (11,000 px with caption and credit). There is no
   multi-select, no drop, no image library and no reuse of an uploaded image (section 3).
3. **A singleton with a page cannot be published as declared.** A type with site checks needs a
   slug, a slug comes only from a text title, and a home-page singleton has none. The editor is
   told to fix a field that is not in the form (section 7).
4. **A type without a page of its own has no honest "live".** Declared with a shared page, its
   unpublish is never confirmed. Declared with nothing, it says "Birt á vef ✓" with nothing
   checked (section 7).
5. **The conflict screen cannot be read for a gallery**, appears out of view, and offers only
   all-mine or all-theirs (section 10).
6. **Paste loses more than it says.** Word lists arrive as paragraphs with a bullet character
   typed in front, tables lose their shape, images vanish, and nothing is said (section 4).
7. **The sweep takes three requests per tenant per run, not ten.** An import that queues 60
   publish requests drains in 20 sweeps (section 11).

## 1. What was probed, and how

| | |
|---|---|
| Hub | this repository at `5f3fa74` plus the probe commit, Next.js 16.4.3, local Supabase stack (CLI 2.121.0, OrbStack), database reset from migrations before the run |
| Browser | headless Chromium through the repository's Playwright setup (`@playwright/test` 1.64.1), viewports 1440×900 and 375×812, as `editor_demo` |
| Tenant | `demo`, its module reshaped on the branch (section 2). The demo's own `event` type stays, so the e2e setup still works |
| Site | the repository's demo site on `localhost:3101`, with six bare pages added that render entry markers: `/`, `/projects`, `/projects/[slug]`, `/news`, `/news/[slug]`, `/people` |
| Test images | a read-only folder of 209 photo-sized JPEGs, 57 KB to 2.3 MB, long edge up to 2,400 px, uploaded under neutral names. One project's 23 images are 10.8 MB in all |
| Instrumentation | two log lines added to the worker on the branch (step durations of each release build, and of the pre-commit check of originals); timestamps read from the local database |

Limits of the method, to read every number against:

- **A script pressed the buttons.** Presses are counted; a person's time is not measured. "Seconds"
  below are the system's: from choosing a file to its preview, from "Birta" to a status.
- **Local Storage and a local site.** Every timing is far faster than hosted (section 11 says by
  how much). Local figures show the shape of the cost, not its size.
- **No real phone.** 375 px is a narrow desktop Chromium with a mouse. Touch dragging was only
  emulated.
- **The Word paste fixture is hand-written** from the format Word puts on the clipboard; it is not
  a capture of a real Word clipboard.

Screenshots are not in the repository. They are on the machine that ran the probe, in
`/private/tmp/claude-501/-Users-einarzoega--claude-spares-spare-9XMWmj/56627df8-9791-44e5-adbe-050bfcaf3d9b/scratchpad/editor-probe/`,
named `<step>-<width>.png`; the names below are given without the width where both exist. The
same folder holds `findings.jsonl` (every observation as it was logged) and three bundle files.

## 2. The shape, and what was declared for the site

| Type | Fields |
|---|---|
| `project` | title (text, required); categories `list(select)` over seven options; body (richText); cover (image); gallery A `list(image)`; gallery B `list(group({ image, caption, credit }))`; facts, a `group` of six optional texts; featured (boolean); video `group({ url: link, title: text, poster: image })` |
| `news` | title, date, kind (`select`: news, update, card), body, images `list(image)`, relatedProject (`reference` to project) |
| `person` | name, job title, role, email (all text), portrait (image), bio `list(group({ heading, items: list(text) }))` |
| `settings` (singleton) | email, phone, address `group`, socials `list(group({ label, url: link }))` |
| `home` (singleton) | slides `list(group({ image, project: reference }))`, featured `list(reference(project))` with max 6, slogans `list(text)` |

What each type declared in the module's `site` map, which decides what the live check looks at:

| Type | `path` | `checks` |
|---|---|---|
| `project` | `/projects/<slug>` | its own page and `/projects` |
| `news` | `/news/<slug>` | its own page and `/news` |
| `person` | `/people`, a shared page, since a person has no page of its own | `/people` |
| `home` | `/` | `/` |
| `settings` | nothing declared | none. The demo site renders the settings entry nowhere, on purpose |

## 3. Galleries of 12 images, two ways

Screens: the project form. Screenshots `1a-project-form-empty`, `1d-gallery-plain-12`,
`1e-gallery-captioned-12`, `1e-gallery-captioned-one-item`, `1d-gallery-plain-viewport`.

| | A: `list(image)` | B: `list(group({ image, caption, credit }))` |
|---|---|---|
| Presses per image | 3: "Bæta við", "Velja mynd", the file in the system dialog | the same 3 |
| Typing per image | alt text, optional | alt text, caption, credit |
| 12 images | 36 presses, up to 12 texts | 36 presses, up to 36 texts |
| System time, file chosen to preview shown | 0.20 to 0.28 s (57 KB to 1.1 MB files) | 0.10 to 0.30 s |
| System time, file chosen to "Vistað" | 2.1 s (the autosave waits 1.5 s) | 2.1 s |
| One item's height, 1440 / 375 px | 389 / 650 px | 597 / 902 px |
| The 12-item list, 1440 / 375 px | 5,174 / 8,119 px | 7,385 / 11,018 px |
| The whole form with both galleries | 15,188 px at 1440, 22,265 px at 375 | |

What the editor asks for each image: nothing. An alt-text input is offered beside every image and
is never required; half the images were published with it empty and nothing objected. The file
dialog takes one file (`multiple` is not set). About two images fit in a 900 px window. Each item
repeats a five-line help text about the focal point, which is much of its height.

**Reorder.** All three ways work at both widths and survive a reload.

- Up and down buttons (44×44 px): one place per press. The last of 12 to the front took 11 presses.
  Each move is announced ("Image 2 er nú í sæti 1 af 12.").
- The handle with the arrow keys: three places in 26 ms, focus follows the item.
- Dragging the handle with a mouse: works. Dragging the last item to the top of the list meant
  holding the pointer at the window's top edge while the browser scrolled: 5.4 s for 4,368 px at
  1440, 8.6 s for 7,084 px at 375. A drag started on the item's body, not the handle, does nothing
  (by design). One drag at 375 px, whose drop point was near the sticky publish bar, fired no drop
  and moved nothing; why was not settled. An emulated touch long-press and move did not reorder; a
  real phone was not tried.

**Replace** ("Skipta um mynd"): a new upload takes the old one's place in about 2 s. **The alt text
is emptied** in both variants; caption and credit in B stay. The old image stays in the tenant's
storage (section 9). Screenshot `1g-captioned-item-after-replace`.

**Remove.** Each item has two controls that read as "remove", and they do different things.

- The item's own ×: the item is gone at once. No confirmation, no undo.
- "Fjarlægja mynd" inside the item: the image is gone and **the item stays** (screenshots
  `1h-plain-item-emptied-not-removed`, `1h-captioned-item-emptied-not-removed`). In A, publishing is
  then refused with "Ekki hægt að birta: Gallery (images)" and "Lagaðu reitina og birtu aftur."
  The stored error names item 7 of 10; the editor is shown only the field's name, nothing in the
  form is marked, and the item is thousands of pixels down (screenshot `4b-form-after-refusal`).
  In B the item still has its caption and credit, so **it publishes**: the release carried a
  gallery item with a caption, a credit and no image.

**Upload errors** (screenshots `1i-upload-…`). All are immediate and clear.

| File | What happened |
|---|---|
| a 21 MB JPEG | refused before upload: "Myndin má ekki vera stærri en 20 MB." |
| a PDF, a HEIC photo, a GIF | refused before upload: "Aðeins er hægt að nota JPEG-, PNG- eða WebP-myndir." |
| a text file renamed `.jpg` | uploaded, then refused by the server with the same sentence (84 ms); by the code the object stays in private storage until the sweep's orphan step, a day later |
| a valid 19 MB JPEG | accepted, preview after 0.44 s locally |

The empty image field is a dashed box with an image icon and a "Velja mynd" button. It looks like a
drop zone and has no drop handler (a `dragover` on it is not handled), so a file dropped there
gets the browser's own behaviour. A real drop from the desktop was not tried.

**Opening the project again** (23 images): every preview is the full original, 10.8 MB in all,
fetched through 23 server actions that run one after another: 0.68 s locally until the last
preview. A stress entry with 230 images in one gallery showed its form in 0.16 s and its last
preview after 5.2 s, on a page 95,513 px tall.

## 4. Pasting formatted text

Screen: the project's Body field. Screenshots `2b-rich-text-after-clean-paste`,
`2c-rich-text-after-word-paste`, `2e-rich-text-relative-link-refused`. Identical at both widths.
The toolbar offers bold, italic, H2, H3, bullet list, numbered list, quote, line break and link.
**The editor said nothing about any of the losses below**: no notice, at paste or at save.

| Pasted | Clean HTML (web page, Google Docs, Word for the web) | Word-desktop style HTML |
|---|---|---|
| H1 | becomes a plain paragraph | same |
| H2, H3 | kept | kept |
| H4 | plain paragraph | not in the fixture |
| bold, italic, both | kept | kept |
| underline, strike-through, colour, superscript, code | formatting dropped, text kept | same |
| bullet list, nested bullet, numbered list | kept as lists | **plain paragraphs** that start with a typed "·" or "1." and a run of spaces |
| block quote | kept | not in the fixture |
| external link, `mailto:` link | kept | kept |
| relative link (`/verk/…`), `#anchor` link | link dropped, text kept | same |
| table | every cell's text **run together in one paragraph** ("CellA1CellB1CellA2CellB2") | one paragraph per cell, table shape lost |
| image | dropped, alt text not kept | dropped, an empty paragraph left behind |
| horizontal rule | dropped | not in the fixture |
| line break | kept | not in the fixture |

Plain text pasted with a blank line between paragraphs became one paragraph each; a single line
break also started a new paragraph.

A link set through the toolbar: `/verk/sample-project` and `www.example.org/page` are both refused
with "Ógild vefslóð (https://, http:// eða mailto:). Ekki vistað."; only a full address is taken.
The toolbar has no image button. The document schema allows an image node and a link to another
entry, and the editor can make neither.

## 5. Nested lists, categories, references

- **Person bio** (three sections, eight lines; screenshot `3b-person-bio-nested-lists`): 11 presses
  of "Bæta við" and 11 inputs. It works at both widths and reorders at both levels. The eight
  short lines take 2,088 px (2,120 px at 375); each one-line text is a 140 px card. Enter in a
  line does not start the next line. The innermost input is 564 px wide at 1440 and 227 px at 375.
- **Categories** as `list(select)` (screenshot `1b-categories`): one press and one select per
  category. **The same value can be picked twice** ("Gardens", "Gardens", "Art" was stored and
  published) and nothing says so.
- **Email** is a text field: "this is not an email address" was stored without comment. There is
  no email kind.
- **The reference picker** (screenshot `3c-reference-picker`) is a native select of every entry of
  the target type, sorted by title, each with its status: "Sample project 1440 (Uppkast)". No
  search; by the code, the first 200 entries. Choosing a draft shows "Þessi færsla er ekki birt.
  Birta þarf hana áður en hægt er að birta færsluna sem vísar í hana." under the picker, before
  anything is published. Each picker fetches the whole list with its own server action: six
  pickers, six identical fetches.
- **The list of references, max 6** (screenshot `3e-home-featured-at-max`): the help reads "Mest 6
  atriði." from the start. At six the "Bæta við" button is disabled; pressing it does nothing and
  no message appears. The same project can be chosen twice.
- **Link fields** (video address, social links; screenshots `1j-video-link-without-scheme`,
  `3d-settings-links-without-scheme`): `youtube.com/watch?v=…`, `instagram.com/…` and
  `www.facebook.com/…` each show "Ógild vefslóð (https://, http:// eða mailto:). Ekki vistað." The
  rest of the item is saved without its address. Nothing in the schema requires the address, so
  such an item would publish without it; the probe corrected them before publishing.
- **Slogans** as `list(text)`: ten slogans are ten presses and ten inputs, 1,600 px of form.

## 6. Singletons

`settings` and `home` each open in one press from the tenant home (0.23 to 0.30 s) and are created
on first open. Their page has no list to go back to. The home page's title in the bundle is null,
because the type has no text field to take one from. Screenshots `3d-settings-form`,
`3e-home-form`, `3a-tenant-home`.

## 7. Publishing and what "live" meant

Screen: the publish panel ("Birting"). Screenshots `4a-…` to `4l-…`.

| What was published | What the panel showed, in order | End state |
|---|---|---|
| news whose related project is a draft | Í birtingu… → "Ekki hægt að birta: Related project", "Lagaðu reitina og birtu aftur." | refused, field named |
| project with an emptied item in gallery A | Í birtingu… → "Ekki hægt að birta: Gallery (images)" | refused, field named, item not named |
| new project, title empty | → "Ekki hægt að birta: Title" | refused |
| project, 23 new images | Í birtingu… → "Birt á vef ✓" | live, on its page and on `/projects` |
| news, person | Í birtingu… → "Birt á vef ✓" | live, checked on the declared pages |
| `settings` (no checks declared) | Í birtingu… → "Birt á vef ✓" | **"live" with nothing looked at** |
| `home` (declared with `/`) | Í birtingu… → **"Ekki hægt að birta: Slóð"**, "Lagaðu reitina og birtu aftur." | refused |
| `home`, after a slug was set through the API | → "Ekki hægt að birta: Slides" (one slide referred to a draft) | refused, field named |
| `home`, after that project was published | → "Birt á vef ✓" | live, checked on `/` |

**Types with no page of their own.**

- **`settings`, nothing declared.** The panel said "Birt á vef ✓"; the delivery was recorded `ok`
  5 to 6 ms after the site answered the webhook, 0.13 to 0.15 s after the request. None of the site's five
  pages carries the entry. For a type without checks, "live" means the site accepted the
  notification. (By the code the check would also fetch the entry's image URLs on hosted; locally
  there are none, section 12.)
- **`person`, declared with the shared page.** Publishing was confirmed correctly: the marker was
  on `/people`. **Unpublishing was never confirmed.** The page stopped showing the person, and the
  panel went "Í birtingu…" → "Bíður eftir vefnum" for 60 s → "Ekki enn staðfest á vef, reynt
  aftur…" with "Beiðnin var send á vefinn en færslan hefur ekki enn horfið þaðan. Kerfið reynir
  aftur sjálfkrafa." That sentence is untrue here. The recorded reason is `status 200` on
  `/people`: an absent check of the entry's own path passes only on 404, and a shared page always
  answers 200. A sweep a minute later spent its full 60 s window and left the same state. By the
  code this repeats on the retry schedule for 24 hours and alerts the platform admin after an hour;
  neither was waited for. Screenshots `4l-person-unpublished`, `4l-person-unpublished-after-a-sweep`.
- **`home`, declared with `/`.** Refused with `slug_required`. A type with site checks needs a
  slug; the slug is made from the title; this type's title is never text. No control sets a slug,
  so the editor is told to fix a field ("Slóð") that is not in the form (screenshot
  `4h-home-first-attempt`). To go on, the probe called `api.set_slug` with the editor's own session,
  which an editor cannot do. After that it published and was confirmed on `/`.

**An entry with a page of its own** behaved as the spec says. Unpublishing the news item: "Í
birtingu…" → "Tekið af vef" with the cache caveat; its page answered 404 and `/news` no longer
carried it. No confirmation was asked before the unpublish.

**Restore** (screenshots `4k-restore-asks-first`, `4k-after-restore`): "Fyrri birtingar" lists
published versions only, each with a time and "af þér"; it does not say what changed, and draft
saves are not in it. "Endurheimta" asks first, then the page reloads with "Eldri birting var
endurheimt í uppkastið. Birtu til að setja hana á vefinn." (1.0 s). The first version's title, facts
and ten gallery images were back. No undo is offered; the replaced draft is gone unless it had been
published.

Three smaller things on this screen:

- After an edit to a published entry, and after a restore, the panel still reads "Birt á vef ✓".
  Only the list page says "Breytt eftir birtingu".
- At 1440 px the panel is at the top right and does not follow the scroll. After filling a gallery
  the "Birta" button is up to 14,000 px above. At 375 px it is a bar fixed to the bottom, about
  165 px of an 812 px window.
- The save status ("Vistað", "Ekki vistað") is in the top bar, which scrolls away too.

## 8. Lists and order

The project list (screenshots `3a-project-list`, `4m-project-list-no-delete`) has three columns:
title, status, last changed. It is sorted by last change, has a title search and a status filter,
no thumbnail and no category. An entry's only control is its link.

Nothing sets the order of projects. The type has no date, so `sortAt` is null, and the bundle
listed the eight projects in an order no editor chose (D, G, E, B, the sample project, C, F, A).
The one editor-controlled order in this shape is the home page's list of references.

## 9. Getting rid of things

**A draft entry.** No control deletes or archives an entry: not on its page (27 controls, none of
them), not in the list, not on hover. The status filter does offer "Í skjalasafni". Called with the
editor's own session, `api.archive_entry` answered 204: the entry left the default list and
appeared under that filter. It still opens as a normal form with a "Birta" button, and nothing
takes it out of the archive again. The same call on a published entry is refused (`forbidden`).
Screenshots `4m-draft-entry-no-delete`, `4m-archived-filter`, `4m-archived-entry-opened`.

**An uploaded image.** No control removes one. There is no page that lists a tenant's images
(`/t/demo/assets` is "Síðan fannst ekki"). An image's own page is reached only from a field that
still uses it, and offers the focal point and the default alt text (screenshot
`4n-asset-detail-page`). After one project's editing the tenant held 37 images, 6 of them used by
nothing (a replaced image, removed images, and a 19 MB test file: 21.9 MB); after both runs, 86 and
12 (43.7 MB). `api.archive_asset` as the editor answered 204 for an unused image, and the original
was still in storage afterwards; for an image a published entry uses it is refused
(`published_reference`). An image cannot be picked a second time either: every use is a new upload.

## 10. Two browsers on one entry

Screens: the project form in two browser contexts. Screenshots `5a-conflict-notice`,
`5a-conflict-top-of-page`.

The second browser changed the title, one fact and one caption and saved. The first, still on the
older version, changed another fact, an alt text, the order of gallery A, a category and the body.
Its next save, 2.1 s later, was refused and the conflict notice appeared.

- **It appeared out of view.** The notice is at the top of the page; the editor was 2,502 px down
  (4,279 px at 375). The save line, also at the top, read "Ekki vistað". "Birta" was disabled,
  which at 375 px is the one sign in view.
- **Six fields were listed**, with "Nýja útgáfan" and "Þín útgáfa" side by side: Title, Categories,
  Body, both galleries, Facts. The notice is 1,460 px tall at 1440 and 3,190 px at 375.
- **Lists and groups are not readable.** A gallery is one line of item keys and image ids:
  "654eaca3-ccf2-46e1-920a-bd91ddd38386; Mynd 9c37118b: Alt text of photo 11; 232669d6-…". Each
  side is cut at 300 characters, so at 1440 px the Body looked identical on both sides (the change
  was past the cut), and a reordered gallery reads as two near-equal strings. Facts are six values
  with no labels, in storage order, not the form's.
- **Two choices, for the whole entry**: "Halda minni útgáfu" or "Hlaða nýju útgáfunni". Nothing can
  be chosen per field. "Halda minni útgáfu" did what its hint says and overwrote the other
  browser's title, fact and caption, none of which the first browser had touched. In Facts the two
  browsers had changed different texts of the same group; the whole group went to one side.

## 11. Publish timings, and what bounds a large release

All local. Milliseconds from the publish request, from database timestamps.

| Case | New images | Committed | Release built | Site notified | Confirmed |
|---|---|---|---|---|---|
| project, 23 images, 10.8 MB (two runs) | 23 | 184 / 214 | 463 / 586 | 507 / 608 | 578 / 642 |
| project, 12 images, 5.9 MB (three runs) | 12 | 121 / 121 / 161 | 346 / 298 / 394 | 370 / 311 / 426 | 401 / 336 / 507 |
| the same projects again after a text edit | 0 | 27 to 42 | 87 to 144 | 103 to 163 | 130 to 195 |
| 14 title-only projects | 0 | 26 to 37 | 93 to 140 | 110 to 168 | 136 to 218 |
| news item, 3 images (two runs) | 3 | 62 / 58 | 159 / 147 | 176 / 165 | 203 / 189 |
| one entry with 230 images, 105 MB, through the API and one sweep | 230 | | build 2,146 | | sweep 3,093 in all |

So for the project with 12 new images: **0.30 to 0.39 s from "Birta" to the release being built,
and 0.04 to 0.11 s more to confirmation.** The editor saw "Birt á vef ✓" 2.1 s after pressing in
every case, because the panel reads the status every 2 s; locally the poll is the wait.

**Per image, locally.** Copying to public storage: 8.9 ms (230 copies in 2,047 ms; 23 in 207 and
247 ms; 12 in 83 to 154 ms). The pre-commit check: 0.6 to 2 ms to see that the original exists,
2.9 to 3.9 ms to read it and derive its metadata again. About 13 to 16 ms per new image in all. A
release that copies nothing builds in 54 to 97 ms.

**What bounds one release with about 230 new images** (from `process-request.ts`,
`build-release.ts`, `live-check.ts`, `deliver.ts`, `pointer-fresh.ts` and the claim function):

- Before commit, per request: every original not yet public is checked (8 at a time), then
  downloaded and inspected (4 at a time, each up to 20 MB in memory).
- In the build: **copies run one after another**, in the one worker run. No pointer is written once
  270 s have passed since the build began; the run itself has 300 s; a build still open at 420 s is
  failed by the sweep. A failed build is retried after 1, 2, 4 … minutes and raises an alert.
  Copies a failed build made are not recorded, so the next build asks for them again and is
  answered "exists".
- After the build: up to 120 s waiting for the public pointer, then a 60 s live-check window with
  at most 6 fetches at a time.
- A draft may be 1 MiB and hold 1,000 references. The 230-image draft was 31.7 KB.
- When does one release get that many? Not through the sweep (next point). By the code, through
  the editor's path: each "Birta" starts its own worker run with no claim limit, and a build takes
  everything committed at its start, so requests fired together land mostly in one later build.
  That path was not load-tested here.

**The sweep's claim size, measured.** The probe wrote 60 projects (230 images, 80,640 characters of
body) through the editor's own database API, requested all 60 at once, and called the sweep route
until nothing was left. Each sweep claimed **3** requests, built one release of 9 to 12 images and
confirmed it, in 0.28 to 0.45 s. It took **20 sweeps**. The sweep passes a limit of 10, and
`api.worker_claim_requests` takes at most 10 in all and 3 per tenant. By the same function, a
request older than an hour when claimed is failed (`deadline_exceeded`), as is one claimed five
times.

**How an import of about 60 entries and 230 images should be batched.**

1. Upload the images and save the drafts first. Neither costs a release.
2. Publish what is referred to before what refers to it (projects before news and the home page).
   A reference to an unpublished entry is refused.
3. The safe way: request the publishes through the API without triggering the worker and let the
   per-minute sweep drain them, 3 entries and about 12 images per release. That is 20 sweeps, so at
   least 20 minutes on hosted. Queue well under 150 at a time: at 3 a minute the tail of a longer
   queue passes the one-hour deadline.
4. If the worker is triggered per request for speed, send no more than about 10 entries (about 40
   images) at a time and wait for that release to be delivered before the next.
5. Measure one hosted batch before any of this is relied on.

**How far off the local numbers are.** Local Storage is a container on the same machine writing to
local disk. Hosted Storage is an object store reached over HTTPS from a function in another region.

- A copy took 9 ms here. Hosted was **not measured**. A guess, not a measurement: 100 to 500 ms
  per copy, 10 to 50 times the local figure. On that guess 230 copies take 23 to 115 s against the
  270 s limit: it fits on paper with a margin somewhere between 2 and 12 times, which is not known
  well enough to rely on.
- The public pointer was fresh after 14 to 27 ms here. On hosted it lags 35 to 54 s
  (`docs/king/BRIEF.md` §10), so every release waits about that long before the site is told, and
  an editor waits about a minute for "Birt á vef ✓" whatever the images.
- Uploading in the editor (0.2 s here) includes the server reading the original back; on hosted
  that is a second transfer of each file.

## 12. Bundle size

| Bundle | Entries | Bytes | gzip |
|---|---|---|---|
| after the 1440 run: 8 projects, 1 news, 1 person, home, settings, 1 event | 13 | 19,230 | 4,950 |
| after both runs | 22 | 33,198 | 7,750 |
| after the import load | 81 | 213,108 | 23,943 |

- The sample project (23 image slots, 1,876 characters of body, facts, video) is 7,826 bytes.
- The 60 imported projects are 181,131 bytes: 3,019 each, of which 2,086 are the body (1,344
  characters of text, so **1.55 bytes of JSON per character**) and 933 are everything else.
- **On the local stack every image is delivered as `null`.** The projection accepts only `https`
  image URLs and local Storage is `http`, so the bundles above hold no image objects at all. From
  the delivered type, each would be an object of about 270 to 310 bytes on hosted (id, a URL of
  about 150 characters, width, height, type, alt, focal point). That figure is computed, not seen.

**Projection for 60 entries, 90,000 characters of body and 230 images:** 60 × 0.93 KB + 90,000 ×
1.55 B + 230 × 0.29 KB = 56 + 140 + 67 = **about 263 KB** uncompressed; about 275 KB for Icelandic
text, whose accented letters are two bytes. The local gzip figure flatters, because the import's
body text repeats one sentence.

## 13. Frictions, ranked

BLOCKER: an editor could not do the task. PAINFUL: possible, but slow or confusing. FINE: worked.

| Rank | Screen | Step | What happened | Screenshot |
|---|---|---|---|---|
| BLOCKER | entry page, list | remove a draft entry | no control deletes or archives; the API call exists and no button uses it; nothing un-archives | `4m-draft-entry-no-delete` |
| BLOCKER | image field, image page | remove an unused image | no control; no page lists images; 6 of 37 uploads were used by nothing after one project | `4n-asset-detail-page`, `4n-no-image-library` |
| BLOCKER | publish panel, `home` | publish a singleton declared with a page | "Ekki hægt að birta: Slóð", "Lagaðu reitina og birtu aftur."; no such field | `4h-home-first-attempt` |
| BLOCKER | rich text | an image in the body | no toolbar button; a pasted image is dropped silently | `2b-rich-text-after-clean-paste` |
| BLOCKER | rich text | a table in the body | cells run together or become paragraphs, silently | `2b-…`, `2c-rich-text-after-word-paste` |
| BLOCKER | project list | put projects in an order | nothing sets it; the bundle's order is arbitrary | `3a-project-list` |
| PAINFUL | gallery | 12 images | one file per dialog, 36 presses, no multi-select, no drop, no reuse; 5,174 to 11,018 px of list | `1d-gallery-plain-12`, `1e-gallery-captioned-12` |
| PAINFUL | gallery | move an image far | 11 presses, or a drag held at the window edge for 5 to 9 s; touch drag not shown to work | `1d-gallery-plain-viewport` |
| PAINFUL | gallery item | replace an image | the alt text is emptied without a word | `1g-captioned-item-after-replace` |
| PAINFUL | gallery item | "Fjarlægja mynd" | leaves an empty item: publish is refused naming only the field (A), or a caption with no image is published (B) | `1h-…`, `4b-form-after-refusal` |
| PAINFUL | publish panel | a refusal | names the top-level field, never the item; nothing is marked in the form; the panel is at the top of a 15,000 px page at 1440 | `4b-project-refused-emptied-item` |
| PAINFUL | publish panel, `person` | unpublish with a shared page | never confirmed; the panel says the entry has not left the site when it has | `4l-person-unpublished` |
| PAINFUL | publish panel, `settings` | "live" with no checks | "Birt á vef ✓" with nothing looked at | `4g-settings-published` |
| PAINFUL | conflict notice | a save refused | out of view; lists shown as keys and cut at 300 characters; all mine or all theirs | `5a-conflict-notice` |
| PAINFUL | rich text | paste from Word | lists become paragraphs with typed bullets; H1 becomes a paragraph; relative links dropped; no notice | `2c-rich-text-after-word-paste` |
| PAINFUL | link fields, link dialog | an address without `https://`, or to the site's own page | refused; the item is saved without its address; no way to link to another entry | `3d-settings-links-without-scheme`, `2e-…` |
| PAINFUL | form | which fields are required | no marker on the required title; found out at publish | `1a-project-form-empty` |
| PAINFUL | publish panel | unpublished changes | still "Birt á vef ✓" after an edit or a restore | `4j-panel-after-edit-before-republish`, `4k-after-restore` |
| PAINFUL | form at 1440 | long forms | save status and "Birta" scroll out of view | `1d-gallery-plain-viewport` |
| PAINFUL | categories, featured | the same value twice | accepted and published, nothing said | `1b-categories`, `3e-home-featured-at-max` |
| PAINFUL | nested lists, slogans | short lines | 140 px per one-line text; Enter does not add the next | `3b-person-bio-nested-lists`, `3e-home-slogans` |
| PAINFUL | reference picker | many entries | a plain select, no search | `3c-reference-picker` |
| PAINFUL | project form | opening it | every preview is the full original (10.8 MB for 23), one server action after another | `1k-project-form-filled` |
| PAINFUL | history | restore | no view of what a version held; no undo; published versions only | `4k-restore-asks-first` |
| FINE | image field | a file too big or of the wrong kind | refused at once, in plain words | `1i-upload-…` |
| FINE | lists | add, reorder by button or keyboard, remove | worked, announced, kept after reload, at both widths | `1d-…`, `3b-…` |
| FINE | list with a maximum | the seventh item | button disabled, "Mest 6 atriði." shown throughout | `3e-home-featured-at-max` |
| FINE | reference picker | a draft target | status in the option, and a hint before publishing | `3c-reference-picker` |
| FINE | publish panel | entries with their own page | publish, republish and unpublish each ended in a true state | `4c-project-published`, `4l-news-unpublished` |
| FINE | singletons | open and edit | one press from the home page | `3d-settings-form` |
| FINE | whole editor at 375 px | every step above | usable; publish bar fixed at the bottom; nested inputs 227 px wide | `1a-project-form-empty`, `3b-person-form` |

## 14. Bugs in the Hub itself

Each with the least needed to see it again. All on the local stack at the commit above. Several are
the code doing what it was written to do; they are listed because an editor meets them as faults.

1. **Required text and date fields show no marker.** Open a new entry of a type with a required
   text field. The input has the `required` attribute and no `*`; list items and groups show one.
   Press "Birta": "Ekki hægt að birta: Title". (Seen for the text title. That date, image, rich
   text, reference and link fields are the same is read from their components, not tried.)
2. **A type with site checks and no text title can never be published from the editor.** Declare
   `site` for a type whose `preview.title` field is not text. Open an entry, press "Birta": "Ekki
   hægt að birta: Slóð", "Lagaðu reitina og birtu aftur." Nothing in the editor sets a slug.
3. **Unpublish is never confirmed when the declared path is a shared page.** Declare `path: () =>
   '/people'` with a check of `/people`. Publish an entry (confirmed), then unpublish it. After the
   60 s window: "Ekki enn staðfest á vef, reynt aftur…", reason `status 200`, though the page no
   longer carries the entry. The retry a minute later spent another full window.
4. **A type with no site checks is shown as live with nothing checked.** Declare nothing for a
   type, render it on no page, publish: "Birt á vef ✓".
5. **Replacing an image empties its alt text.** Give a list image an alt text, press "Skipta um
   mynd", choose a file: the alt input is empty.
6. **"Fjarlægja mynd" in a list item leaves an empty item.** In `list(image)` it then blocks
   publishing with a message that names the list, not the item. In `list(group({ image, … }))` it
   publishes an item without an image.
7. **The conflict notice appears out of view.** Open one entry in two browsers, save in one, scroll
   down and edit in the other. The notice is at the top of the page and the page does not move.
8. **The conflict comparison prints list item keys and cuts each side at 300 characters**, so a
   long body or a gallery that differs past the cut shows two identical texts.
9. **A pasted table whose cells hold bare text becomes one paragraph with the cells joined.** Paste
   a table of four cells holding "CellA1", "CellB1", "CellA2", "CellB2" into a rich-text field:
   "CellA1CellB1CellA2CellB2".
10. **The publish panel says "Ekki birt" on every open of a published entry** until its first
    status read returns (69 to 79 ms locally, a network round trip on hosted).
11. **The panel reads "Birt á vef ✓" while the draft differs from what is live**, after an edit or
    a restore.
12. **The dashed image box takes no drop.** A `dragover` dispatched on it is not handled.
13. **On the local stack every image in a bundle is `null`**, because local Storage URLs are `http`
    and the projection keeps only `https`. Image delivery cannot be seen or tested locally.

## 15. What surprised

- The sweep's three-per-tenant claim. The worker's own default says ten.
- Images missing from every local bundle (bug 13). The media was copied and public; only the
  bundle left it out.
- "Birt á vef ✓" for the settings entry that no page shows.
- The database API already has archive for entries and images. Only the buttons are missing, and
  an un-archive.
- The document schema already has an image node and entry links. The editor makes neither.
- Locally the editor's wait for "live" is the panel's 2 s poll, not the worker: 23 images or none,
  the answer came at 2.1 s.
- A draft with 230 images is 31.7 KB. The 1 MiB limit is far away; the form's height is the limit
  that is reached first.

## 16. Running it again

From the worktree that has `probe/dld-shape` checked out, with the local stack up (`pnpm db:start`):

```sh
pnpm install
pnpm db:reset          # a clean local database; the numbers above come from one
cd apps/cms
PROBE_IMAGE_DIR=<a folder of photo-sized JPEGs, searched recursively, read only> \
PROBE_OUT=<a folder for screenshots, findings.jsonl and the bundles> \
  pnpm exec playwright test -c playwright.probe.config.ts
```

Playwright builds and starts the CMS and the demo site, as the e2e run does, then runs three files
in order: `e2e/probe/dld-shape.probe.ts` (steps 1 to 6 at 1440 px, then at 375 px),
`drag.probe.ts` and `import-load.probe.ts`. About 25 minutes in all; step 4 waits two minutes on
purpose at each width. The whole chain was run once in parts, with the servers started by hand; the
start-everything path above was checked with one step only.

- `PROBE_WIDTHS=1440`, and `-g "1440 px 4 "` or any step's name, run a part of it.
- `PROBE_REUSE_SERVERS=1` uses servers already running; start them with
  `sh e2e/probe/serve.sh cms` and `sh e2e/probe/serve.sh site` in two terminals.
- `PROBE_RESUME=1` keeps the entries an interrupted step 3 made. `PROBE_BULK=0` skips the import load.

The probe leaves its content in the local database (90 entries, 570 images, about 300 MB of
originals). `pnpm db:reset` clears it.
