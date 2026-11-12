# DLD: content model

| | |
|---|---|
| Written | 2026-11-12 |
| State | **DRAFT. Not approved.** Under review for DLD and for the platform; then to Einar |
| Lives in | `modules/dld` in this repository, once approved. Nothing here goes into core |
| Depends on | Enhancements A1 (library: caption and credit per file) and A7 (live confirmation for content with no page of its own), both approved |

**What is hard to change afterwards:** the tenant's slug, the names of types and fields, and each field's kind. Labels, help and order in the form can change at any time. Icelandic labels below are DRAFT and go to Einar in the copy batch.

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

| Field | Kind | Required | Label (DRAFT) | From |
|---|---|---|---|---|
| `title` | text, max 120 | yes | „Titill" | `titleShort` |
| `categories` | list of select (the seven below) | no | „Flokkar" | `categories` |
| `cover` | image | yes | „Forsíðumynd" | `image` |
| `gallery` | list of image | no | „Myndir" | `images` |
| `body` | rich text | no | „Texti" | `description` |
| `facts` | group of eight optional texts | no | „Staðreyndir" | `meta` |
| `videos` | list of group: `url` (link), `title` (text), `still` (image) | no | „Myndbönd" | the video block |
| `position` | whole number | no | „Röð á yfirlitssíðu" | position in the array |

- **Address:** `/verk/{slug}`. The slug follows the title until first publish and never changes after. The import keeps today's 40 slugs.
- **`facts`:** `client` „Verkkaupi", `year` „Framkvæmt", `contractors` „Verktakar", `collaborators` „Samstarf", `location` „Staðsetning", `role` „Hlutverk DLD", `award` „Viðurkenning", `photography` „Ljósmyndir". The site's ninth fact, „Helstu atriði", is used by no project and is left out.
- **Captions and photographer credits** belong to each file in the library, not to the project.
- **Order on `/verk`:** projects with no `position` come first, newest first; then by `position`, lowest first. The import gives today's 40 the numbers 10, 20, 30… in today's order. A new project therefore appears at the top without anyone typing a number.
- **Featured on the home page** is not a field here: see `home`.
- **Live check:** the project's own page, and `/verk`.

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

| Field | Kind | Required | Label (DRAFT) | From |
|---|---|---|---|---|
| `title` | text, max 200 | yes | „Titill" | `title` |
| `date` | date | yes | „Dagsetning" | `date` |
| `kind` | select: `frett` „Frétt eða verkefnapistill", `jolakvedja` „Jólakveðja" | no (empty means `frett`) | „Tegund" | `kind` |
| `image` | image | yes | „Aðalmynd" | first of `images` |
| `gallery` | list of image | no | „Fleiri myndir" | the rest of `images` |
| `body` | rich text | no | „Texti" | `body` |
| `relatedProject` | reference to a project | no | „Tengt verk" | `relatedProject` |
| `videos` | as on a project | no | „Myndbönd" | — |

- **Address:** `/frettir/{slug}`. The import keeps today's 18 slugs.
- **The label on the site** is derived, as today: „Jólakveðja" for that kind; „Verkefnapistill" when a project is linked; otherwise „Frétt".
- **Christmas cards** store a full date. The site shows the year alone for that kind. The import keeps today's 24 December.
- **`dateLabel`** (today a hand-written second copy of the date) is dropped. The site formats the date.
- **Live check:** the post's own page, `/frettir`, and `/` while it is among the three newest (by date, then by slug).
- **A tenant type, not the shared `news` type.** The shared type carries `excerpt` and `source`, which DLD's site shows nowhere; a field that does nothing misleads an editor.

### 3.3 `person` — „Starfsmaður" (2 today)

| Field | Kind | Required | Label (DRAFT) | From |
|---|---|---|---|---|
| `name` | text | yes | „Nafn" | `name` |
| `title` | text | yes | „Starfsheiti" | `title` |
| `role` | text | no | „Hlutverk" | `role` |
| `email` | text | no | „Netfang" | `email` |
| `portrait` | image | yes | „Mynd" | `portrait` |
| `bio` | list of group: `heading` (text), `items` (list of text) | no | „Ferill" | `bio` |
| `position` | whole number | no | „Röð" | position in the array |

No page of its own. **Live check:** `/um-okkur` (needs A7).

### 3.4 `home` — „Forsíða" (one entry)

| Field | Kind | Limits | Label (DRAFT) | From |
|---|---|---|---|---|
| `slides` | list of image | 1 to 8 | „Myndir efst á forsíðu" | `hero.slides` |
| `featured` | list of reference to a project | at most 6 | „Verk á forsíðu" | the `featured` flag |

**Live check:** `/` (needs A7). The slogans, the headline and the section texts stay in code.

### 3.5 `settings` — „Tengiliðaupplýsingar" (one entry)

| Field | Kind | Required | Label (DRAFT) | From |
|---|---|---|---|---|
| `email` | text | yes | „Netfang" | `siteConfig.email` |
| `phone` | text | no | „Sími" | `siteConfig.phone.number` |
| `address` | group: `line1`, `line2` (texts) | no | „Heimilisfang" | `siteConfig.addresses[0]` |
| `mapUrl` | link | no | „Slóð á Google Maps" | `addresses[0].maps.url` |
| `socials` | list of group: `label` (text), `url` (link) | no | „Samfélagsmiðlar" | `siteConfig.socials` |
| `footerText` | text | no | „Texti neðst á vefnum" | `footer.copyrightSuffix` |

**Live check:** `/` and `/hafdu-samband` (needs A7). The site builds the phone link and the map embed from these values.

## 4. What stays in the site's code

| Thing | Why |
|---|---|
| The nine services and their „Tengd verk" | Told fixed to DLD. The site looks the projects up by slug and skips one that is gone |
| Page texts, the slogans, the headline, section labels | Told fixed to DLD |
| The logo | It is an SVG; the Hub takes JPEG, PNG and WebP. The offer lists it as editable: DLD must be told |
| The category labels and their order | Mirrored from this module; a new category is a code change in both |
| The redirect map from the old WordPress addresses (`legacyPath`) | Migration data, not something an editor maintains. Frozen into the site at import |
| SEO defaults, navigation, the contact form's copy, the legal name | Not in the offer's CMS list |

## 5. What the site must do with this model

- Sort projects as in 3.1, and people by `position`.
- Skip a reference whose target is unpublished, everywhere: „Tengd verk", „Verk á forsíðu", „Tengt verk".
- Read a video's provider and id from the link. An address it does not recognise is shown as a plain link, never an error.
- Take image width and height from the delivered value, not from files on disk.
- Show the year alone for a Christmas card.
- Keep today's fallbacks: the alt text „{titill} — mynd N" when an image has none, and the first paragraph as the excerpt.

## 6. What the import does

| Today | Becomes |
|---|---|
| Paragraphs, headings, links | The same, word for word. Headings become level 2. The 33 paragraphs that begin with a typed „- " or „1. " stay paragraphs, unchanged |
| Links to another page of the site (2) and to the site's PDF (1) | Full addresses on the site's domain. Relative links are not allowed in the Hub |
| The one video placed inside a text | The project's first `videos` item. It moves from inside the text to the page's fixed video position |
| The six `featured` projects | `home.featured`, in today's order |
| The four slideshow images | `home.slides`. The first uses today's JPEG version |
| Image files | The site's present web-sized files (long edge at most 2,400 px), one library file each. The seven byte-identical duplicates become one file each |
| Alt text | Empty for the 204 images that have none. See question 4 for the other 24 |
| `legacyPath` | Not imported; stays in the site |

## 7. Open questions

**For Einar**

1. **The slogans** (ten, mostly DLD's own): in `home`, or in code as told?
2. **`footerText`:** keep the field (the offer names "texta neðst á vefnum"), or leave the footer in code?
3. **The logo** cannot be self-service. Who tells DLD, and when?
4. **The 24 alt texts** on today's site were drafted by Litljómi as placeholders. Import them, or leave them empty for DLD to write?
5. **A new project appears first on `/verk`** unless given a number. Right default?

**For DLD, through Einar**

6. Should captions and photographer credits show on the site, and where? The model stores them either way.
