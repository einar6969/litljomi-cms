# DLD: content model

| | |
|---|---|
| Written | 2026-11-12, second draft |
| State | **Approved by Einar on 2026-11-12** ("Approve as recommended"), with the five recommended answers in section 8: slogans in the CMS; the footer text field kept; DLD told about the logo; the 24 drafted alt texts imported; a new project appears first |
| Lives in | `modules/dld` in this repository, once approved. Nothing here goes into core |
| Needs from the platform | A1 (library: caption and credit per file), A7 (live confirmation for content with no page of its own), A11 (the `video` field kind), A12 (manual ordering). All approved |

**What is hard to change afterwards:** the tenant's slug, the names of types and fields, each field's kind, and any limit that is later tightened. Loosening a limit, adding a field, adding a select option and changing a label are all free. So the limits below are set now, on the tight side. Icelandic labels are DRAFT and go to Einar in the copy batch.

## 1. Tenant

| | |
|---|---|
| Slug | `dld`. Permanent; it is part of every public image address |
| Name shown in the editor | „Dagný Land Design" |
| Locale | Icelandic |

## 2. What the editor sees

Left menu: **Verk**, **Fréttir**, **Starfsfólk**, **Forsíða**, **Tengiliðaupplýsingar**, and the Hub's own **Myndasafn**.

## 3. Types

Keys are English, as in the Hub's other modules. "From" is where the value lives in `dld-is` today.

### 3.1 `project` — „Verk" (40 today)

| Field | Kind | Required | Limits | Label (DRAFT) | From |
|---|---|---|---|---|---|
| `title` | text | yes | 120 characters | „Titill" | `titleShort` |
| `categories` | list of select (the seven below) | no | at most 7 | „Flokkar" | `categories` |
| `images` | list of image | yes, at least 1 | at most 40 | „Myndir (sú fyrsta er aðalmynd)" | `image`, then `images` |
| `body` | rich text | no | — | „Texti" | `description` |
| `facts` | group of seven optional texts | no | 300 characters each | „Staðreyndir" | `meta` |
| `videos` | list of video (A11) | no | at most 6 | „Myndbönd" | the video block |

- **Shown in lists by** `title`. **No sort date.** **Order:** set by dragging in the list (A12); a new project lands first.
- **Address:** `/verk/{slug}`. The slug follows the title until first publish and never changes after. The import keeps today's 40 slugs.
- **One image list, not a cover field and a gallery.** The first image is the cover; dragging another to the top changes it. Twelve files are picked or uploaded in one step.
- **`facts`:** `client` „Verkkaupi", `year` „Framkvæmt (ár)", `contractors` „Verktakar", `collaborators` „Samstarf", `location` „Staðsetning", `role` „Hlutverk DLD", `award` „Viðurkenning". Two of the site's nine facts are left out: „Helstu atriði" (no project uses it) and „Ljósmyndir" (the photographer is the credit on each file).
- **Captions and photographer credits** belong to each file in the library.
- **Featured on the home page** is not a field here: see `home`.
- **Live check:** the project's own page, and `/verk`. A featured project's card on `/` is not checked (a check cannot see which projects `home` lists).

**Categories** (stored value → label, DLD's wording unchanged, in today's order):

| Value | Label |
|---|---|
| `fraedsluefni` | Fræðsluefni |
| `honnun` | Hönnun |
| `samkeppnir` | Samkeppnir |
| `skipulag-utivist` | Skipulag / útivist |
| `voruhonnun` | Vöruhönnun |
| `thatttokuhonnun` | Þátttökuhönnun |
| `throunarverkefni` | Þróunarverkefni, sýningar og innsetningar |

Adding a category later is a small code change. Removing or renaming a stored value is a breaking change, which suits the offer's promise that the categories stay as they are.

### 3.2 `news` — „Frétt" (18 today)

| Field | Kind | Required | Limits | Label (DRAFT) | From |
|---|---|---|---|---|---|
| `title` | text | yes | 200 characters | „Titill" | `title` |
| `date` | date | yes | — | „Dagsetning" | `date` |
| `kind` | select: `frett` „Frétt eða verkefnapistill", `jolakvedja` „Jólakveðja" | yes | — | „Tegund" | `kind` |
| `image` | image | yes | — | „Aðalmynd" | first of `images` |
| `gallery` | list of image | no | at most 20 | „Fleiri myndir" | the rest of `images` |
| `body` | rich text | no | — | „Texti" | `body` |
| `relatedProject` | reference to a project | no | — | „Tengt verk" | `relatedProject` |
| `videos` | list of video (A11) | no | at most 6 | „Myndbönd" | — |

- **Shown in lists by** `title`. **Sorted by** `date`, newest first.
- **Address:** `/frettir/{slug}`. The import keeps today's 18 slugs.
- **The label on the site** is derived, as today: „Jólakveðja" for that kind; „Verkefnapistill" when a project is linked; otherwise „Frétt".
- **Christmas cards** store a full date. The site shows the year alone for that kind. The import keeps today's 24 December.
- **`dateLabel`** (today a hand-written second copy of the date) is dropped. The site formats the date.
- **A main image and a gallery here,** unlike a project: a post has one image in 17 of 18 cases, and a Christmas card is that one image.
- **Live check:** the post's own page, `/frettir`, and `/` while it is among the three newest. The module sorts by date, newest first, then by slug, exactly as the site does.
- **A tenant type, not the shared `news` type.** The shared type carries `excerpt` and `source`, which DLD's site shows nowhere; a field that does nothing misleads an editor. `title`, `date`, `image` and `body` are kept identical to the shared type, so adopting it later only adds fields.

### 3.3 `person` — „Starfsmaður" (2 today)

| Field | Kind | Required | Limits | Label (DRAFT) | From |
|---|---|---|---|---|---|
| `name` | text | yes | 120 | „Nafn" | `name` |
| `jobTitle` | text | yes | 120 | „Starfsheiti" | `title` |
| `role` | text | no | 200 | „Hlutverk hjá DLD" | `role` |
| `email` | text | no | 200 | „Netfang" | `email` |
| `portrait` | image | yes | — | „Mynd" | `portrait` |
| `bio` | list of group: `heading` (text, required, 80), `items` (list of text, at most 20, 300 each) | no | at most 6 | „Menntun og ferill" | `bio` |

**Shown in lists by** `name`. **Order:** by dragging (A12). No page of its own. **Live check:** `/um-okkur` (A7).

### 3.4 `home` — „Forsíða" (one entry, a singleton)

| Field | Kind | Limits | Label (DRAFT) | From |
|---|---|---|---|---|
| `slides` | list of image | 1 to 8 | „Myndir efst á forsíðu" | `hero.slides` |
| `featured` | list of reference to a project | at most 6 | „Verk á forsíðu" | the `featured` flag |
| `slogans` | list of text | at most 12, 120 characters each | „Slagorð á forsíðu" | `hero.slogans` — **question 1** |

**Live check:** `/` (A7).

### 3.5 `contact` — „Tengiliðaupplýsingar" (one entry, a singleton)

| Field | Kind | Required | Limits | Label (DRAFT) | From |
|---|---|---|---|---|---|
| `email` | text | yes | 200 | „Netfang" | `siteConfig.email` |
| `phone` | text | no | 40 | „Sími" | `siteConfig.phone.number` |
| `address` | group: `line1` (required), `line2` | no | 120 each | „Heimilisfang" | `siteConfig.addresses[0]` |
| `mapUrl` | link | no | — | „Hlekkur á Google Maps" | `addresses[0].maps.url` |
| `socials` | list of group: `label` (text, required, 40), `url` (link, required) | no | at most 8 | „Samfélagsmiðlar" | `siteConfig.socials` |
| `footerText` | text | no | 200 | „Texti í fæti vefsins" | `footer.copyrightSuffix` — **question 2** |

**Live check:** `/` and `/hafdu-samband` (A7). The site builds the phone link and the map embed from these values. The type is named `contact`, not `settings`: a tenant type should not take a name the editor's own pages are likely to want.

## 4. What stays in the site's code

| Thing | Why |
|---|---|
| The nine services and their „Tengd verk" | Told fixed to DLD. The site looks the projects up by slug and skips one that is gone |
| Page texts, the headline, section labels | Told fixed to DLD |
| The logo | It is an SVG; the Hub takes JPEG, PNG and WebP. The offer lists it as editable: DLD must be told |
| The category labels and their order | Mirrored from this module; a new category is a code change in both |
| The redirect map from the old WordPress addresses (`legacyPath`) | Migration data, not something an editor maintains. Frozen into the site at import |
| SEO defaults, navigation, the contact form's copy, the legal name | Not in the offer's CMS list |

## 5. What the site must do with this model

- Show projects and people in the delivered order.
- Skip a reference whose target is unpublished, and drop a repeated one, everywhere: „Tengd verk", „Verk á forsíðu", „Tengt verk", categories.
- Show every image of a project, however many.
- Take image width and height from the delivered value, not from files on disk.
- Show the year alone for a Christmas card.
- Keep today's fallbacks: the alt text „{titill} — mynd N" when an image has none, the first paragraph as the excerpt, and the code's slogans when `slogans` is empty.

## 6. What the import does

| Today | Becomes |
|---|---|
| Paragraphs, headings, links | The same, word for word. Headings become level 2. The 33 paragraphs that begin with a typed „- " or „1. " stay paragraphs, unchanged |
| A link in a text to another project or post | A reference to that entry, so it survives a change of address |
| A link to a page that is not an entry, and the link to the site's PDF | A full address on the site's domain. Relative links are not allowed in the Hub |
| The one video placed inside a text | The project's first `videos` item. It moves from inside the text to the page's fixed video position |
| The six `featured` projects | `home.featured`, in today's order |
| The four slideshow images | `home.slides`. The first uses today's JPEG version |
| Image files | The site's present web-sized files (long edge at most 2,400 px), one library file each. The seven byte-identical duplicates become one file each |
| Alt text | Empty for the 204 images that have none. See question 4 for the other 24 |
| The order of projects and people | Today's order |
| `legacyPath` | Not imported; stays in the site |

Order of work: projects, then news, then people, then `home` and `contact`, because an entry can only be published after the entries it refers to. `home` and `contact` are opened as singletons, never created as ordinary entries. Each entry is published before anyone opens it in the editor, so its imported slug holds.

## 7. What the reviews changed

| From | Change |
|---|---|
| DLD's side | One image list per project, the first being the cover. Clearer labels throughout. The photographer fact dropped in favour of the credit on each file |
| The platform's side | `person.title` became `jobTitle`; `settings` became `contact`; limits set on every text and list now; required parts inside video, social and address items; the two singletons marked as such; in-site links imported as references; news kept compatible with the shared type |
| Einar, 2026-11-12 | The `video` kind and manual ordering are built first (A11, A12), so there is no link-plus-still group and no typed order number |

## 8. Open questions

**For Einar** (the client-side review's answer in brackets)

1. **The slogans:** in `home` as above, or in code as DLD was told? Recommended: **in**. They are mostly DLD's own words, and each change would otherwise be an email. [In.]
2. **`footerText`:** keep the field, or leave the footer in code? Recommended: **keep**; the offer names the footer text. [Keep, with a label that says exactly what it controls.]
3. **The logo** cannot be self-service. Recommended: tell DLD now, with an offer to swap it on request. [The same.]
4. **The 24 alt texts** on today's site were drafted by Litljómi. Recommended: **import them** and tell DLD they are drafts to correct. [Import.]
5. **A new project appears first on `/verk`** until someone drags it. Recommended: **yes**. [Yes.]

**To tell DLD** (Einar's messages; none has been sent)

- The logo is changed on request, not by them.
- A video sits at a fixed place on the page, not anywhere in the text. One existing video moves.
- New projects appear under a service's „Tengd verk" only on request.
- Captions and credits are stored; whether and where they show is their choice (question 6).

**For DLD, through Einar**

6. Should captions and photographer credits show on the site, and where?
