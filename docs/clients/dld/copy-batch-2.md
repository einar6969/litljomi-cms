# Copy batch 2: DLD's editor-facing strings

Every string below is DRAFT until Einar approves it (step E6). Strings are quoted exactly as in `modules/dld/src/index.ts` and are never corrected in the tables. Proposals are in the lists, not in the code.

Source: `modules/dld/src/index.ts` on main `964037e`, compared with `content-model.md` (approved 2026-11-12). Source column: "content model" means the string is given verbatim there; "builder" means the module's builder wrote it and the content model gives none.

## Counts

- **73 strings in all**, 60 distinct. Ten texts are used more than once (Verk, Titill, Mynd, Texti, Myndband, Myndbönd, Netfang, Atriði, Forsíða, Tengiliðaupplýsingar), so changing one means changing every use in the code.
- By part: tenant name and menu 6, type names 5, Verk 23, Frétt 12, Starfsmaður 10, Forsíða 6, Tengiliðaupplýsingar 11 (tally at the end).
- By source: **56 content model, 17 builder**. The 17 builder strings are item labels of lists, the group item labels, the bio and social members, and the two address lines.
- **Help texts: 0. Placeholders: 0. Plural type names: 0.** The platform's field kinds carry only a label and a required flag, and a type carries one `label`. So the "help texts" the plan mentions do not exist for tenant fields. The list headings in the menu serve as the plural form.
- The label text of every field the content model gives matches the code exactly. No label differs from the model.

## Needs a decision

1. **No help texts or placeholders are possible.** Anything an editor needs to be told has to go in the label itself, as `Myndir (sú fyrsta er aðalmynd)` already does. Decide: accept that, or ask for a `help` option on field kinds (a platform change, not for DLD's launch).
2. **`footerText` label.** Content model question 2 says "keep, with a label that says exactly what it controls". The code has `Texti í fæti vefsins`, which is the model's draft and does not say what part of the footer it sets (today it is the text after the copyright mark, `copyrightSuffix`). Einar to say what it controls; then the label should name it, for example `Texti aftan við höfundarréttarmerki í fæti`. Proposal only, wording to be checked against the site.
3. **`Hlutverk DLD` (project fact) and `Hlutverk hjá DLD` (person role)** are two spellings of nearly the same words, and a person also has `Starfsheiti`. Both are the content model's, so they are not errors. Decide: leave, or make them match (`Hlutverk hjá DLD` in both).
4. **`Lína 1` and `Lína 2` (address, builder).** Neutral but awkward to read in an editor. Proposal: `Gata og húsnúmer` and `Póstnúmer og staður`. Only if the site shows exactly that; otherwise leave.
5. **`Heiti` (social link name, builder).** Next to `Titill` elsewhere it is unclear. Proposal: `Nafn miðils` (the editor then types Instagram, Facebook).
6. **`Tegund` (news kind).** Says little. Proposal: `Tegund færslu`. The model gives `Tegund`, so this is a change to an approved draft.
7. **`Hluti` (a section of Menntun og ferill, builder).** Proposal: leave, or `Hluti ferilsins`. Low priority.
8. **`Atriði` is both the list label and the item label** in the bio section. In Icelandic the form is the same in singular and plural, so it reads correctly, but the editor sees the same word twice. Proposal: list label `Atriði undir fyrirsögn`, item label `Atriði`.
9. **`Mynd` is used for four different things** (project image, news gallery image, person portrait, home slide). The model gives it for the person portrait; the item labels are builder. Proposal: leave the item labels, and consider `Andlitsmynd` for the portrait.
10. **`Fleiri myndir` and `Aðalmynd` (news)** are the model's and fine. Only note: the project list says `Myndir (sú fyrsta er aðalmynd)` and the news type says `Aðalmynd`, so "aðalmynd" is used in both senses. No change proposed.
11. **`Skipulag / útivist`** has spaces around the slash. It is DLD's own wording, kept verbatim by the model. No change proposed; listed so the approval is a conscious one.
12. **Not a string, but approved with them:** `Framkvæmt (ár)` is a free text field (300 characters), so an editor can write a range. Label is the model's. No change.

## The home singleton shows „Án titils" on the dashboard

**What happens.** A type's list title is read from the field named in `preview.title`, and only a text value counts (`packages/schema/src/define-type.ts`, `queryColumns`). For `home` that field is `slogans`, a list, so the stored title is empty and the dashboard shows `Án titils` (`t.entries.untitled`, `apps/cms/src/editor/TenantOverview.tsx` line 58). `home` has no text field of its own, so the module cannot point `preview.title` at anything better. `contact` is fine: it shows its email address as the title, which works but is the address, not a name.

The same fallback is used in the entry list page, the ordered table, the reference picker and the asset usage list, but a singleton is reached from the menu and the "Síður" card, so only the dashboard's recent-changes table shows the problem in practice.

**Smallest generic fix (proposed, platform side, one file).** In `TenantOverview.tsx`, where the row title is chosen, use the type's label when the title is empty and the type is a singleton:

`row.title ?? (isSingleton(row.type) ? typeLabel(row.type) : t.entries.untitled)`

`structure` is already a prop, and the small type label already printed beside the title would then read `Forsíða` twice on that row. To avoid that, hide the small label when it was used as the title. No new string, no schema change, and it fixes every singleton of every tenant. The same line can be applied in the list page (`[type]/page.tsx` line 161) if singletons ever show there.

**Module-side choice (no platform change).** Add a text field to `home` that is only a label, for example `name` with a fixed value, and point `preview.title` at it. That adds a field an editor must see and cannot meaningfully edit, and it changes a type the content model fixed, so it is the worse option. Alternative: leave it, since the entry is reachable from the menu and the dashboard's "Síður" card, and only the recent-changes row reads `Án titils`.

**Recommendation:** the generic fix, as a small PR in the next platform batch. Not needed for launch.

## Tenant and menu

| Where it shows | String | Source |
|---|---|---|
| Admin header and tenant home, name of the site | Dagný Land Design | content model (section 1) |
| Left menu, type 1 | Verk | content model (section 2) |
| Left menu, type 2 | Fréttir | content model (section 2) |
| Left menu, type 3 | Starfsfólk | content model (section 2) |
| Left menu, singleton | Forsíða | content model (section 2) |
| Left menu, singleton | Tengiliðaupplýsingar | content model (section 2) |

## Type names (singular; no plural is defined)

| Where it shows | String | Source |
|---|---|---|
| Type `project`: entry editor heading, status lines, small label on dashboard rows | Verk | content model (3.1) |
| Type `news` | Frétt | content model (3.2) |
| Type `person` | Starfsmaður | content model (3.3) |
| Type `home` | Forsíða | content model (3.4) |
| Type `contact` | Tengiliðaupplýsingar | content model (3.5) |

## Verk (`project`)

| Where it shows | String | Source |
|---|---|---|
| Field `title` | Titill | content model |
| Field `categories`, list heading | Flokkar | content model |
| Field `categories`, each item | Flokkur | builder |
| Category option 1 | Fræðsluefni | content model |
| Category option 2 | Hönnun | content model |
| Category option 3 | Samkeppnir | content model |
| Category option 4 | Skipulag / útivist | content model |
| Category option 5 | Vöruhönnun | content model |
| Category option 6 | Þátttökuhönnun | content model |
| Category option 7 | Þróunarverkefni, sýningar og innsetningar | content model |
| Field `images`, list heading | Myndir (sú fyrsta er aðalmynd) | content model |
| Field `images`, each item | Mynd | builder |
| Field `body` | Texti | content model |
| Field `facts`, group heading | Staðreyndir | content model |
| `facts.client` | Verkkaupi | content model |
| `facts.year` | Framkvæmt (ár) | content model |
| `facts.contractors` | Verktakar | content model |
| `facts.collaborators` | Samstarf | content model |
| `facts.location` | Staðsetning | content model |
| `facts.role` | Hlutverk DLD | content model |
| `facts.award` | Viðurkenning | content model |
| Field `videos`, list heading | Myndbönd | content model |
| Field `videos`, each item | Myndband | builder |

23 strings (3 builder).

## Frétt (`news`)

| Where it shows | String | Source |
|---|---|---|
| Field `title` | Titill | content model |
| Field `date` | Dagsetning | content model |
| Field `kind` | Tegund | content model |
| `kind` option `frett` | Frétt eða verkefnapistill | content model |
| `kind` option `jolakvedja` | Jólakveðja | content model |
| Field `image` | Aðalmynd | content model |
| Field `gallery`, list heading | Fleiri myndir | content model |
| Field `gallery`, each item | Mynd | builder |
| Field `body` | Texti | content model |
| Field `relatedProject` | Tengt verk | content model |
| Field `videos`, list heading | Myndbönd | content model |
| Field `videos`, each item | Myndband | builder |

12 strings (2 builder).

## Starfsmaður (`person`)

| Where it shows | String | Source |
|---|---|---|
| Field `name` | Nafn | content model |
| Field `jobTitle` | Starfsheiti | content model |
| Field `role` | Hlutverk hjá DLD | content model |
| Field `email` | Netfang | content model |
| Field `portrait` | Mynd | content model |
| Field `bio`, list heading | Menntun og ferill | content model |
| Field `bio`, each item (a group) | Hluti | builder |
| `bio` item member `heading` | Fyrirsögn | builder |
| `bio` item member `items`, list heading | Atriði | builder |
| `bio` item member `items`, each item | Atriði | builder |

10 strings (4 builder).

## Forsíða (`home`, singleton)

| Where it shows | String | Source |
|---|---|---|
| Field `slides`, list heading | Myndir efst á forsíðu | content model |
| Field `slides`, each item | Mynd | builder |
| Field `featured`, list heading | Verk á forsíðu | content model |
| Field `featured`, each item | Verk | builder |
| Field `slogans`, list heading | Slagorð á forsíðu | content model |
| Field `slogans`, each item | Slagorð | builder |

6 strings (3 builder).

## Tengiliðaupplýsingar (`contact`, singleton)

| Where it shows | String | Source |
|---|---|---|
| Field `email` | Netfang | content model |
| Field `phone` | Sími | content model |
| Field `address`, group heading | Heimilisfang | content model |
| `address.line1` | Lína 1 | builder |
| `address.line2` | Lína 2 | builder |
| Field `mapUrl` | Hlekkur á Google Maps | content model |
| Field `socials`, list heading | Samfélagsmiðlar | content model |
| Field `socials`, each item (a group) | Samfélagsmiðill | builder |
| `socials` item member `label` | Heiti | builder |
| `socials` item member `url` | Hlekkur | builder |
| Field `footerText` | Texti í fæti vefsins | content model |

11 strings (5 builder).

## Tally

| Part | Strings | Builder |
|---|---|---|
| Tenant and menu | 6 | 0 |
| Type names | 5 | 0 |
| Verk | 23 | 3 |
| Frétt | 12 | 2 |
| Starfsmaður | 10 | 4 |
| Forsíða | 6 | 3 |
| Tengiliðaupplýsingar | 11 | 5 |
| **Total** | **73** | **17** |

Source split: 56 content model, 17 builder. The type names and menu entries repeat each other for Verk, Forsíða and Tengiliðaupplýsingar, which is why fewer are distinct.

Strings the editor also sees that this module does not define (they are in batch 1 and the platform): the video field's inner labels (`Slóð myndbandsins`, `Titill myndbandsins`, `Kyrrmynd`), the image buttons, the list buttons, the publish panel and the order-by-dragging help.
