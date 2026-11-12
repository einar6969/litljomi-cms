# DLD site: repository map for a CMS integration

Read-only reconnaissance of the `dld-is` repository at `main` @ `13f1df0` (2026-11-12, clean, equal
to `origin/main`). It reports what exists. It does not recommend a CMS or design a migration.

**How the numbers were produced.** No install, build or dev server was run. Counts come from reading
the source, from read-only scripts that transpiled the data files in memory with the repo's own
TypeScript, from `find`/`stat`/`sips` on `public/`, and from the `out/` folder left by an earlier
local build (dated 2026-11-12). Claims about Next.js 16 cite the docs shipped in
`node_modules/next/dist/docs/` (abbreviated `next-docs/` below). All paths are relative to the
repository root.

Contact details, staff names and addresses are replaced by `<…>` in the examples.

---

## 1. Stack and build

### Versions

| Package | `package.json` | Locked (`package-lock.json`) |
|---|---|---|
| `next` | `16.2.4` (`package.json:12`) | 16.2.4 |
| `react`, `react-dom` | `19.2.4` (`:13-14`) | 19.2.4 |
| `clsx` | `^2.1.1` (`:11`) | 2.1.1 |
| `tailwind-merge` | `^3.5.0` (`:15`) | 3.5.0 |
| `tailwindcss`, `@tailwindcss/postcss` (dev) | `^4` (`:18`, `:22`) | 4.2.2 |
| `typescript` (dev) | `^5` (`:23`) | 5.9.3 |
| `@types/node` / `@types/react` / `@types/react-dom` (dev) | `^20` / `^19` / `^19` | 20.19.39 / 19.2.14 / 19.2.3 |

Five runtime dependencies. `server-only` is imported once (`src/core/utils/image-dimensions.ts:11`)
and is not in `package.json`; it resolves to the copy Next ships
(`node_modules/next/dist/compiled/server-only`). The package is still named `dld-demo`
(`package.json:2`). Next requires Node `>=20.9.0` (`node_modules/next/package.json:375-377`); the
repo has no `.nvmrc` and no `engines` field.

### Scripts and tooling

- `dev` = `next dev`, `build` = `next build`, `start` = `next start` (`package.json:5-9`).
- No lint script, no test suite, no formatter, no CI (`README.md:128-133`). The stated bar is
  `npx tsc --noEmit && npm run build`.
- Tailwind v4 through PostCSS (`postcss.config.mjs`); tokens live in an `@theme` block
  (`src/app/globals.css:3-18`). There is no `tailwind.config`.
- 438 tracked files: 240 under `public/`, 186 under `src/`, 2 under `docs/`.

### Config

| File | Content |
|---|---|
| `next.config.ts:3-9` | `output: "export"`, `trailingSlash: false`, `images: { unoptimized: true }`. Nothing else: no `redirects`, `headers`, `rewrites`, `remotePatterns`, custom image loader or `cacheComponents`. |
| `tsconfig.json` | `strict: true` (`:7`), `moduleResolution: "bundler"`, alias `@/*` → `./src/*` (`:21-23`). |
| `vercel.json:3-8` | One rule: `X-Robots-Tag: noindex, nofollow` on `/(.*)`. No redirects, no rewrites, no build settings. |
| `.gitignore` | Ignores `.next/`, `out/`, `.env*`, `.vercel`. No `.env` file exists. |

### What `output: "export"` rules out today

From `next-docs/01-app/02-guides/static-exports.md:274-292`, not supported under a static export:
dynamic routes with `dynamicParams: true` or without `generateStaticParams()`, route handlers that
rely on `Request`, cookies, rewrites, redirects and headers in `next.config`, Proxy, Incremental
Static Regeneration, image optimisation with the default loader, Draft Mode, Server Actions and
intercepting routes.

Still supported under export:

- Server Components, which run during `next build` (`static-exports.md:53-57`), including `async`
  ones that `fetch` at build time (`:59-67`).
- Route handlers, `GET` only, rendered to static files at build (`static-exports.md:233-251`).
- `next/image` with a custom loader (`static-exports.md:168-183`).

Proxy is listed as unsupported on static export in its own reference too
(`next-docs/01-app/03-api-reference/03-file-conventions/proxy.md:728`).

### What `images.unoptimized` does today

`next/image` serves the source file as-is
(`next-docs/01-app/03-api-reference/02-components/image.md:391-414`). In the built HTML every
`<img>` carries a plain `src` and no `srcset` or `sizes` attribute (checked in
`out/verk/samkeppni-hlemmur.html`). The roughly 20 hand-written `sizes` strings in `src/ui` are
therefore inert, and every card, cover and gallery image downloads the full file. An absolute
external image URL "must be configured with remotePatterns" (`image.md:71`); none is configured.

`next/image` uses the Next 16 `preload` prop (the `priority` prop is deprecated, `image.md:291-293`)
on the cover, the news hero, the first index card, the logos and the Um okkur photo.

### Every dependency on being static or on Vercel

| Where | Dependency |
|---|---|
| `src/app/robots.ts:4` | `export const dynamic = "force-static"`. |
| `src/app/robots.ts:9-11` | Reads `process.env.VERCEL_ENV` and `process.env.NODE_ENV` **at build time**. Crawling is allowed only when `siteConfig.indexable` is true **and** the build is a production one (`:13-20`). These are the only two environment variables read anywhere in `src/`. |
| `src/app/sitemap.ts:7`, `:9` | `force-static`; every URL's `lastModified` is the build time. |
| `src/core/utils/image-dimensions.ts:12-13`, `:24-28` | `node:fs` read of `path.join(process.cwd(), "public", <src>)` during render. Works because all rendering happens at build with `public/` on disk. |
| `src/app/verk/[slug]/page.tsx:21-23`, `src/app/frettir/[slug]/page.tsx:13-15` | `generateStaticParams()` is the only source of detail pages. Neither file sets `dynamicParams`. |
| `src/ui/components/layout/Footer.tsx:6` | The copyright year is `new Date().getFullYear()` at build. |
| `src/content/site.ts:39-40`, `:48` | `domain`, `url` and `indexable` are literals in source, not environment variables. |
| `vercel.json` | The noindex header is a platform rule, because `next.config` headers are unsupported under export. |
| `src/app/layout.tsx:10-15` | `next/font/google` (Open Sans 400/600/700, `latin`), fetched at build and self-hosted. |
| `src/ui/components/common/ContactForm.tsx:3-7` | The form sends nothing (section 7). |

There is no `route.ts`, `proxy.ts`, `middleware.ts`, Server Action, `fetch(` call, `next/headers`
import, `draftMode`, `revalidatePath`/`revalidateTag`, `"use cache"`, `loading.tsx`, `error.tsx`,
`opengraph-image` or `manifest` anywhere in `src/`.

### Routes

64 URLs in the sitemap plus the 404. `out/` holds 66 HTML files (the 64, `404.html` and
`_not-found.html`).

| Route | Pages | Route file | Composition root |
|---|---|---|---|
| `/` | 1 | `src/app/page.tsx` | `src/ui/pages/home-page.tsx` |
| `/verk` | 1 | `src/app/verk/page.tsx` | `src/ui/pages/verk-page.tsx` |
| `/verk/[slug]` | 40 | `src/app/verk/[slug]/page.tsx` | `src/ui/pages/detail-page.tsx` |
| `/thjonusta` | 1 | `src/app/thjonusta/page.tsx` | `src/ui/pages/thjonusta-page.tsx` |
| `/frettir` | 1 | `src/app/frettir/page.tsx` | `src/ui/pages/frettir-page.tsx` |
| `/frettir/[slug]` | 18 | `src/app/frettir/[slug]/page.tsx` | `src/ui/pages/news-page.tsx` |
| `/um-okkur` | 1 | `src/app/um-okkur/page.tsx` | `src/ui/pages/um-okkur-page.tsx` |
| `/hafdu-samband` | 1 | `src/app/hafdu-samband/page.tsx` | `src/ui/pages/hafdu-samband-page.tsx` |
| 404 | n/a | `src/app/not-found.tsx` | `src/ui/pages/not-found-page.tsx` |

`params` is a `Promise` in both dynamic routes (`src/app/verk/[slug]/page.tsx:11-13`).

---

## 2. The content model as it exists in code

All content is TypeScript under `src/content/`. Types are in `src/content/types.ts`; each data file
ends in `satisfies <Type>`, so a wrong shape is a type error.

### Inventory

| Content type | Count | Where | Type |
|---|---|---|---|
| Project (work) | 40 | `src/content/data/projects/<slug>.ts`, registered in `index.ts:46-87` | `Project` (`types.ts:71-87`) |
| News post | 18 (8 „Frétt", 6 „Verkefnapistill", 4 „Jólakveðja") | `src/content/data/news/<slug>.ts`, registered in `index.ts:28-47` | `NewsPost` (`types.ts:183-207`) |
| Service | 9 | `src/content/data/services/<slug>.ts`, registered in `index.ts:14-24` | `Service` (`types.ts:168-180`) |
| Person | 2 | `src/content/data/people.ts:7-58` | `Person` (`types.ts:147-159`) |
| Work category | 7 strings | `src/content/data/categories.ts:2-10` | readonly tuple of strings |
| Editorial section | 2 | `src/content/data/editorial/{vidurkenningar,umfjollun}.ts` | `EditorialPageContent` (`types.ts:210-217`) |
| Navigation | 5 links | `src/content/data/navigation.ts:8-14` | `NavItem[]`, derived from `routes` |
| Routes | 6 | `src/content/routes.ts:11-18` | `RouteDefinition` |
| Site settings | 1 object | `src/content/site.ts:31-57` | inferred `as const` |
| SEO | 1 default + 6 pages | `src/content/seo.ts` | `PageSeo` |
| Header / footer / UI labels | 3 objects | `src/content/{header,footer,ui}.ts` | inferred |
| Page copy | 8 modules | `src/content/pages/*.ts` | inferred, a few typed |
| Contact form copy | 1 module | `src/content/forms/contact.ts` | inferred |

No item has an ID other than its `slug`, a draft or published state, a created or updated date, an
author, or a locale. Everything in the arrays is published. The site is Icelandic only
(`<html lang="is">`, `src/app/layout.tsx:52`).

### Project (`types.ts:71-87`)

| Field | Type | Required | Set on | Authored or derived | Example |
|---|---|---|---|---|---|
| `slug` | `string` | yes | 40/40 | authored | `"samkeppni-hlemmur"` |
| `titleShort` | `string` | yes | 40/40 | authored | `"Samkeppni um Hlemmsvæði"` |
| `categories` | `string[]` | yes, may be empty | 40/40 (0 values: 1 project, 1 value: 28, 2 values: 11) | authored | `["Samkeppnir", "Skipulag / útivist"]` |
| `image` | `ImageAsset` | yes | 40/40 | authored | `{ src: "/projects/<slug>/<slug>-01.jpg" }` |
| `images` | `ImageAsset[]` | no | 39/40 (1 to 5 entries) | authored | `[{ src: "/projects/<slug>/<slug>-02.jpg", alt: "…" }]` |
| `description` | rich text (section 3) | no | 40/40 | authored | 1 to 60 blocks, median 3 |
| `meta` | `ProjectMeta` | no | 4/40 | authored | `{ verkkaupi: "Reykjavíkurborg", ar: "2009-2010", verktakar: "…" }` |
| `featured` | `boolean` | no | 6/40 | authored | `true` |
| `legacyPath` | `string` | no | 40/40 | authored | `"/portfolio/samkeppni-hlemmur"` |

Notes:

- `slug` is also the file name, the image folder name and the URL segment (`/verk/<slug>`). File
  name and slug match on all 40.
- `titleShort` is the only title. There is no long title. Longest: 81 characters.
- `categories` holds the category **label strings**, compared by string equality
  (`src/ui/sections/Verk/WorkIndex.tsx:54`). Nothing checks them against `projectCategories`; all
  50 memberships happen to match. Membership: Samkeppnir 12, Þróunarverkefni, sýningar og
  innsetningar 12, Vöruhönnun 9, Hönnun 8, Skipulag / útivist 5, Þátttökuhönnun 3, Fræðsluefni 1.
  One project has none by design (`types.ts:74-78`) and shows only under „Allt".
- `legacyPath` is the old WordPress path. Six do not follow `/portfolio/<slug>` (for example
  `/portfolio/test`, `/portfolio/knattspyrnuvollur`), so it cannot be derived from the slug.

`ProjectMeta` (`types.ts:57-69`), all optional strings except `features: string[]`:

| Field | Label (`src/content/pages/verk.ts:33-43`) | Projects that set it |
|---|---|---|
| `verkkaupi` | „Verkkaupi" | 3 |
| `ar` | „Framkvæmt" | 1 |
| `verktakar` | „Verktakar" | 2 |
| `samstarf` | „Samstarf" | 3 |
| `stadsetning` | „Staðsetning" | 0 |
| `hlutverk` | „Hlutverk DLD" | 0 |
| `vidurkenning` | „Viðurkenning" | 0 |
| `ljosmyndir` | „Ljósmyndir" | 0 |
| `features` | „Helstu atriði" (`verk.ts:20`) | 0 |

Facts render in the order of `projectMetaFields`, not the order in the data
(`src/ui/sections/Verk/ProjectTitle.tsx:10-14`).

`ImageAsset` (`types.ts:47-55`):

| Field | Type | Required | Set on | Rendered |
|---|---|---|---|---|
| `src` | `string`, a path under `public/` | yes | 228/228 | yes |
| `alt` | `string` | no | 24/228 | yes, with fallbacks (section 5) |
| `caption` | `string` | no | 0 | no ("schema only", `types.ts:51`) |
| `credit` | `string` | no | 0 | no ("schema only", `types.ts:53`) |

Derived for a project, none of it stored:

| Derived value | Rule | Where |
|---|---|---|
| URL | `/verk/<slug>` | `src/content/routes.ts:21-23` |
| Meta description | first paragraph that is not a heading or media block, flattened to plain text; else a template | `src/app/verk/[slug]/page.tsx:15-19`, `src/content/seo.ts:72-73` |
| OG image | the cover `src`, no dimensions declared | `src/app/verk/[slug]/page.tsx:33-36`, `src/core/seo/metadata.ts:25-27` |
| Cover layout | full width when the file is ≥ 1176 px wide and landscape, else on a pale band (11 of 40 covers) | `src/ui/sections/Verk/ProjectCover.tsx:11`, `:23-24` |
| Image `width`/`height` | read from the file | `src/ui/sections/Verk/ProjectImage.tsx:31` |
| Heading anchors | `<slug>-h<n>` | `src/ui/sections/Verk/DetailContent.tsx:99-102` |
| Contents list | shown when there are more than 3 headings (6 projects) | `DetailContent.tsx:35`, `:103-106` |
| Gallery | `images` minus any placed by an image block | `DetailContent.tsx:110-123` |
| Gallery alt fallback | „<title> — mynd N" | `src/content/ui.ts:17`, `DetailContent.tsx:118` |
| „Fréttir af verkefninu" | posts whose `relatedProject` is this slug, newest first (4 projects have any) | `DetailContent.tsx:125-127` |
| „Fleiri verk" | `moreProjects()` (section 4) | `src/content/data/projects/index.ts:125-138` |
| Home card images | cover plus first gallery images, at most `rotation.images` (3) | `src/ui/sections/Home/FeaturedProjects.tsx:15-17` |

### News post (`types.ts:183-207`)

| Field | Type | Required | Set on | Authored or derived | Example |
|---|---|---|---|---|---|
| `slug` | `string` | yes | 18/18 | authored | `"hlemmtorg-kynnt"` |
| `kind` | `"jolakvedja"` | no | 4/18 | authored | `"jolakvedja"` |
| `date` | `string`, `YYYY-MM-DD` | yes | 18/18 | authored | `"2019-12-13"` |
| `datePrecision` | `"year"` | no | 4/18 | authored | `"year"` |
| `dateLabel` | `string` | yes | 18/18 | authored by hand | `"13. desember 2019"`, or `"2019"` |
| `title` | `string` | yes | 18/18 | authored | `"Hlemmtorg kynnt"` |
| `body` | rich text (section 3) | yes, may be `[]` | 18/18 (4 empty) | authored | |
| `images` | `ImageAsset[]` | no | 18/18 (17 have one, 1 has two) | authored | first entry is the lead image |
| `relatedProject` | `string`, a project slug | no | 6/18 | authored | `"samkeppni-hlemmur"` |
| `legacyPath` | `string` | no | 18/18 | authored | `"/hlemmtorg-kynnt"` |

Notes:

- `date` is the sort key. `dateLabel` is a second, hand-written copy of the same date in Icelandic.
  No code formats a date; the label renders as written. The two are checked against each other only
  for year-precision posts (`src/content/data/news/index.ts:58-62`).
- The four year-precision posts carry an invented `-12-24` day as a sort key only
  (`types.ts:193-197`).
- Posts run from 2012-03-23 to 2019-12-24. Two posts share 2016-04-04.
- `legacyPath`: 12 are `/<slug>`, 2 are unrelated WordPress slugs (`/prufa`, `/onnur-prufa`) and the
  4 Christmas cards are under `/portfolio/`.

Derived for a post:

| Derived value | Rule | Where |
|---|---|---|
| Type label | `kind === "jolakvedja"` → „Jólakveðja"; else has `relatedProject` → „Verkefnapistill"; else „Frétt" | `src/ui/components/common/NewsPostMeta.tsx:16-25`, labels in `src/content/pages/frettir.ts:13-20` |
| `<time dateTime>` | full `date`, or the year alone for year precision | `src/content/data/news/index.ts:70-72` |
| URL | `/frettir/<slug>` | `src/content/routes.ts:34-36` |
| Meta description | lead paragraph as plain text, else the title | `src/app/frettir/[slug]/page.tsx:22-23` |
| OG image | always the site default; the post's own image is not passed | `src/app/frettir/[slug]/page.tsx:25-27` |
| Excerpt | lead paragraph as plain text, clamped by CSS | `src/ui/pages/frettir-page.tsx:21`, `src/ui/components/common/NewsCard.tsx:16` |
| Hero layout | full-bleed when the lead image is ≥ 1000 px wide and the post is not a Christmas card (8 posts); otherwise a band (10 posts) | `src/ui/sections/Frettir/NewsHero.tsx:14`, `:32-34` |
| Filter tab | „Fréttir" shows `frett` and `jolakvedja`; „Verkefnapistlar" shows `pistill` | `src/ui/sections/Frettir/NewsIndex.tsx:52-55` |
| Project card | the resolved `relatedProject` | `src/ui/sections/Frettir/NewsArticle.tsx:55`, `:82` |
| „Fleiri fréttir" | the 3 newest other posts | `src/ui/sections/Frettir/MoreNews.tsx:10`, `:20-22` |

### Service (`types.ts:168-180`)

| Field | Type | Required | Set on | Example |
|---|---|---|---|---|
| `slug` | `string` | yes | 9/9 | `"skipulag"` |
| `title` | `string` | yes | 9/9 | `"Skipulag"` |
| `teaser` | `string` | yes | 9/9 | `"Skipulagsverkefni spanna stærri skipulagsheildir."` |
| `body` | rich text | yes | 9/9 (1 to 3 blocks each) | |
| `relatedProjects` | `string[]`, project slugs in display order | yes | 9/9 (1 to 11 entries) | `["geysir-i-haukadal", "landmannalaugar"]` |

`teaser` is authored on all nine and rendered nowhere (`types.ts:171`). `slug` is the section
anchor on the one services page (`/thjonusta#<slug>`, `src/content/routes.ts:29-31`); services have
no pages of their own. The nine services make 33 references to 23 distinct projects.

### Person (`types.ts:147-165`)

| Field | Type | Required | Set on | Example |
|---|---|---|---|---|
| `slug` | `string` | yes | 2/2 | `"<first-last>"` |
| `name` | `string` | yes | 2/2 | `"<Full Name>"` |
| `title` | `string` | yes | 2/2 | `"Landslagsarkitekt FÍLA"` |
| `role` | `string` | no | 1/2 | `"Stofnandi og eigandi …"` |
| `email` | `string` | no | 2/2 | `"<email>"` |
| `portrait` | `string`, path under `public/people/` | yes | 2/2 | `"/people/<slug>.jpg"` |
| `portraitAlt` | `string` | yes | 2/2 | the person's name |
| `bio` | `BioSection[]` = `{ heading: string; items: string[] }` | no | 2/2 (2 sections each, 1 to 3 items) | `{ heading: "Menntun", items: ["1992 M.Sc. …"] }` |

`slug` is only a React key (`src/ui/sections/UmOkkur/Team.tsx:21`); there are no person pages.
Array order is display order. `title` and `role` are joined with ` · ` in the component
(`Team.tsx:36-37`). Bio items are plain strings.

### Categories (`src/content/data/categories.ts`)

`projectCategories` (`:2-10`) is seven label strings: Fræðsluefni, Hönnun, Samkeppnir,
Skipulag / útivist, Vöruhönnun, Þátttökuhönnun, Þróunarverkefni, sýningar og innsetningar. They have
no slug or ID; the label is the identity and the filter value. Array order is tab order.
`allCategoriesLabel` = „Allt" (`:13`). The seven categories and the nine services are separate
lists that share three names; the README says not to join them (`README.md:369-378`).

### Site settings: `siteConfig` (`src/content/site.ts:31-57`)

| Field | Type | Example | Read by |
|---|---|---|---|
| `name` | `string` | `"Dagný Land Design"` | `src/app/layout.tsx:26`, `src/core/seo/metadata.ts:36`, `src/content/pages/home.ts:150`, `src/content/seo.ts:61` |
| `fullName` | `string` | legal name | `src/ui/components/layout/Footer.tsx:109` |
| `shortName` | `string` | `"DLD"` | nothing |
| `domain` | `string` | `<preview host>` | `src/app/robots.ts:29` |
| `url` | `string` | `https://<preview host>` | `src/app/layout.tsx:23`, `src/core/seo/url.ts:31-32`, `src/app/robots.ts:28` |
| `indexable` | `boolean` | `false` | `src/app/layout.tsx:24`, `src/app/robots.ts:13` |
| `locale` | `string` | `"is_IS"` | `src/app/layout.tsx:27`, `src/core/seo/metadata.ts:37` |
| `defaultOgImage` | `string` | `"/og-image.jpg"` | `src/app/layout.tsx:31`, `:42`, `src/core/seo/metadata.ts:21` |
| `email` | `string` | `"<email>"` | `ContactSection.tsx:30-31`, `Footer.tsx:66-69`, `home.ts:150`, `seo.ts:61` |
| `phone` | `Phone` = `{ number: string; href: string }` (`types.ts:108-113`) | `{ number: "<display>", href: "tel:+354…" }` | `ContactSection.tsx:39-40`, `Footer.tsx:25-28` |
| `addresses` | `readonly Address[]`, 1 entry (`types.ts:100-106`) | `{ label: "Staðsetning", line1: "<street>", line2: "<postcode city>", maps: {…} }` | `ContactSection.tsx:47-51`, `MapSection.tsx:8-10`, `Footer.tsx:34-58` |
| `addresses[].maps` | optional `AddressMaps` = `{ url; embedUrl; iframeTitle }` (`types.ts:94-98`) | Google Maps link, embed URL and iframe title | `MapSection.tsx:21-24`, `:36`, `Footer.tsx:37-51` |
| `socials` | `readonly SocialLink[]`, 1 entry = `{ label; href }` | `{ label: "Facebook", href: "https://www.facebook.com/…" }` | `Footer.tsx:74-87` |
| `foundingDate` | `string` | `"2011"` | nothing |

All authored. The logo, the footer text and the SEO defaults are **not** in `siteConfig`:

| Module | Fields |
|---|---|
| `src/content/header.ts:6-42` | `theme: "light" \| "dark"` (now `"dark"`, `:15`); `logo` and `logoLight`, each `{ src, alt, width, height }`; `homeHref`; `homeAriaLabel`. |
| `src/content/footer.ts:1-31` | `logo` `{ src, alt, width, height }`; `labels` `{ phone, email }`; `copyrightSuffix`; `credit` `{ prefix, label, url }`; `mapsAriaLabel(line1, line2)` (a function). |
| `src/content/seo.ts:14-22` | `siteSeo` `{ titleTemplate, defaultTitle, description, ogImageAlt }`. |
| `src/content/seo.ts:29-63` | `pageSeo`: `{ title, description }` for `home`, `umOkkur`, `thjonusta`, `verk`, `frettir`, `hafduSamband`. Two descriptions are composed from other content (`:45`, `:61`). |
| `src/content/seo.ts:65-74` | `notFoundSeo.title`; `detailSeoFallbacks.project(titleShort)` (a function). |

### Home page: `homeContent` and `homeCta` (`src/content/pages/home.ts`)

| Field | Type | Value now | Notes |
|---|---|---|---|
| `hero.eyebrow` | `string` | four disciplines joined by ` · ` (`:41`) | upper-cased by CSS |
| `hero.slogans` | `string[]` | 10 (`:50-76`) | the first is the page `<h1>`; the others rotate after load |
| `hero.slides` | `HeroSlide[]` (`types.ts:138-144`) | 4 (`:14-32`) | each `{ image: string; imageFallback?: string; project: string }` |
| `hero.slideSeconds` | `number` | `4` (`:84`) | |
| `hero.primaryCta`, `hero.secondaryCta` | `{ label, href }` | (`:85-92`) | `href` and one label come from `routes` |
| `intro` | `{ eyebrow, title, body, linkLabel, linkHref, image, imageAlt }` | (`:94-105`) | `image` is `/assets/intro.jpg` |
| `featuredProjects` | `{ eyebrow, title, linkLabel, linkHref, rotation: { images: 3, seconds: 5 } }` | (`:126-140`) | which projects appear is the `featured` flag on each project, not this object |
| `servicePreview` | `{ eyebrow, title, linkLabel, linkHref }` | (`:117-125`) | lists all nine services, titles only |
| `latestNews` | `{ eyebrow, title, linkLabel, linkHref, count: 3 }` | (`:106-116`) | |
| `homeCta` | `CtaCard` (`types.ts:128-135`) = `{ title, description, href, linkText, image, imageAlt }` | (`:143-155`) | rendered only at the foot of `/thjonusta` (`src/ui/pages/thjonusta-page.tsx:35`), not on the home page; `description` is composed from `siteConfig` (`:150`) |

Hero slides point at image **paths**, not at a project's image by position. Slide 1 is a separate
crop (`/assets/home-hero.avif` with a `.jpg` fallback); slides 2 to 4 reuse project gallery files.
`project` is checked at build and rendered nowhere (`src/ui/sections/Home/Hero.tsx:40-48`).

### Other page modules (`src/content/pages/`)

| Module | Exports and fields |
|---|---|
| `um-okkur.ts` | `umOkkurContent` = `{ intro: { text, image, imageAlt }, process: { title } }` (`:3-13`); `umOkkurStatements`: 3 × `AboutStatement { id, title, body }` (`:19-37`); `processSteps`: 4 × `ProcessStep { id, number, title, body }` (`:40-65`). All bodies are single plain strings. |
| `thjonusta.ts` | `thjonustaContent` = `{ hero: { title, description }, gridLede, indexLabel, relatedLabel }` (`:1-20`). |
| `verk.ts` | `verkContent` = `{ hero: { title, description }, filter: { label, allLabel }, detail: { featuresLabel, galleryEyebrow, relatedNewsHeading, tocLabel, moreTitle, moreLinkLabel } }` (`:5-31`); `projectMetaFields`: 8 × `{ key, label }` (`:33-43`). |
| `frettir.ts` | `frettirContent` = `{ title, labels: { frett, pistill, jolakvedja }, filter: { groupLabel, all, frett, pistill }, detail: { relatedProjectLabel, galleryEyebrow, moreTitle, moreLinkLabel } }` (`:4-42`). |
| `hafdu-samband.ts` | `hafduSambandContent` = `{ title, lede?, fieldHeadings: { email, phone, locations }, mapLinkLabel }` (`:10-22`); `lede` is unset. |
| `starfsmenn.ts` | `starfsmennContent` = `{ title }`. |
| `not-found.ts` | `notFoundContent` = `{ heading, body, buttonLabel, buttonHref, gif }`; `gif` is an absolute URL to a file hosted outside the repo. |

### Remaining modules

| Module | Content |
|---|---|
| `src/content/routes.ts` | `routes`: 6 × `{ path, label }` (`:11-18`); `projectPath`, `serviceSectionPath`, `newsPath` (`:21-36`). |
| `src/content/data/navigation.ts:8-14` | `navItems`, built from five `routes` entries. Nothing here is authored separately. |
| `src/content/ui.ts` | `uiCopy`: `nav` (4 strings), `lightbox` (3), `gallery` (2 functions), `video` (1 function, 1 string). |
| `src/content/forms/contact.ts` | `formCopy` (title, success texts, 6 field labels, 2 submit labels), `MAX_LENGTHS` (5 numbers), `validationCopy` (6 strings, 3 functions). |
| `src/content/data/editorial/vidurkenningar.ts` | `{ title, blocks }`: 1 prose block of 3 paragraphs, 1 inline link. |
| `src/content/data/editorial/umfjollun.ts` | `{ title, blocks }`: 4 blocks: prose (2 paragraphs); list (5 items, each a single link); prose with `heading` (1 paragraph); list (6 plain strings). |

`EditorialBlock` (`types.ts:210-212`) is `{ kind: "prose"; heading?; body }` or
`{ kind: "list"; heading?; items }`, where `body` and `items` are rich-text arrays.

**Eight values in `src/content/` are functions, not data**: `uiCopy.gallery.imageAlt` and
`.openImage` (`ui.ts:17-22`), `uiCopy.video.play` (`ui.ts:27`), `footerContent.mapsAriaLabel`
(`footer.ts:29-30`), `detailSeoFallbacks.project` (`seo.ts:72-73`), and three in `validationCopy`
(`forms/contact.ts:32`, `:37-38`, `:40-41`).

---

## 3. The rich-text format

One format serves project descriptions, news bodies, service bodies and the editorial blocks. Its
type is named `ProjectDescriptionParagraph` everywhere (`types.ts:39-44`). It is an **array of
blocks**; each block is one of five shapes:

| Block | Shape | Defined | Rendered by | Renders as |
|---|---|---|---|---|
| Plain paragraph | `string` | `types.ts:40` | `src/ui/components/common/ProseBlocks.tsx:100-102`, `:155-159` | `<p>` (or `<li>` with `as="li"`) |
| Paragraph with links | `Array<string \| { text: string; href: string }>` | `types.ts:1-6`, `:41` | `ProseBlocks.tsx:55-94`, `:104-106` | `<p>` of `<span>`s and links |
| Heading | `{ kind: "heading"; text: string }` | `types.ts:9-12` | `ProseBlocks.tsx:133-153` | `<h2>`, or `<h3>` with `headingLevel="h3"` |
| Image | `{ kind: "image"; src: string }` | `types.ts:19-22` | project page only, `src/ui/sections/Verk/DetailContent.tsx:184-195` | the image, opening the page lightbox |
| Video | `{ kind: "video"; provider: "vimeo" \| "youtube"; id: string; title: string; poster: string }` | `types.ts:29-37` | `src/ui/components/common/PlacedVideoBlock.tsx:18-30`, then `PlacedVideo.tsx` (client) | click-to-play poster; a link to the provider's page without JavaScript |

Facts about the format:

- **The only inline mark is a link.** There is no bold, italic, line break, quote, list or table,
  and one heading level. No string contains HTML or a newline.
- Link handling is by `href` shape (`ProseBlocks.tsx:31-45`, `:67-93`): a path starting with `/` is
  a `next/link`, unless it ends in a file extension, when it is a plain `<a>`; `http(s)` opens in a
  new tab; anything else is a plain `<a>`.
- Internal links are raw path strings (`"/verk"`, `"/verk/<slug>"`, `"/files/<name>.pdf"`), not
  references.
- Whitespace around links is significant and lives in the neighbouring string segments (35 segment
  strings start or end with a space).
- `ProseBlocks` drops image and video blocks (`ProseBlocks.tsx:127-129`). The project page splits
  the array at media blocks itself (`DetailContent.tsx:56-79`); the news page splits at video
  blocks only (`src/ui/sections/Frettir/NewsArticle.tsx:31-45`). So an image block renders on
  project pages only, and a video block on project and news pages only.
- Plain-text helpers: `flattenProjectDescriptionParagraph` and `leadParagraphText`
  (`src/core/utils/project-description.ts:53-75`). They feed meta descriptions and excerpts.
- The editorial list variant renders items as rows; an item that is one link fills its row
  (`src/ui/sections/UmOkkur/Umfjollun.tsx:14-18`, `:40-76`).

### Usage counts

| | Projects (40) | News (18) | Services (9) | Editorial (2) |
|---|---|---|---|---|
| Blocks in total | 432 | 52 | 16 | 17 |
| Plain paragraphs | 335 (39 items) | 38 (10 items) | 12 (8 items) | 11 |
| Paragraphs with links | 21 (15 items) | 9 (8 items) | 4 (4 items) | 6 |
| Headings | 75 (10 items) | 5 (1 item) | 0 | 0 (1 block-level `heading`) |
| Image blocks | 0 | 0 | 0 | 0 |
| Video blocks | 1 (1 item) | 0 | 0 | 0 |
| Inline links | 22 | 9 | 5 | 6 |

Of the 36 links in projects, news and services: 33 external (17 of them `http://`), 2 internal
routes, 1 internal PDF. Nine paragraphs are nothing but one link.

Text volume: projects total about 88,800 characters (per project: minimum 54, median about 580,
maximum 15,858; five exceed 8,000). News: maximum 5,356, median about 515, four empty. The longest
single paragraph is 3,513 characters. A project has 1 to 60 blocks (median 3); a post 0 to 16.

Structure carried as plain text, which the format cannot express:

- 33 paragraphs in 4 projects are list items typed as text, beginning `- ` or `1. `
  (`geysir-i-haukadal` 9, `landmannalaugar` 11, `laugavegur` 6, `norraenahusid` 7).
- 6 headings are followed directly by another heading.
- One paragraph opens with a row of asterisks used as a divider
  (`lokal-global-haeg-breytileg-att-2`).
- One project lists five documents as five single-link paragraphs whose link text starts with `-`
  (`baeklingar-gerdir-fyrir-reykjavikurborg`).

The copy is reproduced verbatim from the old site, typos included, apart from a short list of
corrections (`docs/DEMO-NOTES.md:16-65`).

---

## 4. Relations, ordering and build-time validation

### Relations

| Relation | Stored as | Direction | Count | Resolved by |
|---|---|---|---|---|
| News post → project | `NewsPost.relatedProject` (slug) | many to one | 6 posts → 4 projects | `getNewsPostProject()` (`src/content/data/news/index.ts:92-102`) |
| Project → its news | not stored | inverse of the above | 4 projects | inline filter (`DetailContent.tsx:125-127`) |
| Service → projects | `Service.relatedProjects` (ordered slugs) | many to many | 33 refs, 23 projects | `getRelatedProjects()` (`src/content/data/services/index.ts:30-40`) |
| Project → categories | `Project.categories` (label strings) | many to many | 50 memberships | string equality (`WorkIndex.tsx:54`) |
| Featured projects | `Project.featured` | flag | 6 | `featuredProjects` (`src/content/data/projects/index.ts:89`) |
| Hero slide → project | `HeroSlide.project` (slug) | many to one | 4 | checked only (`Hero.tsx:10-18`) |
| Hero slide → image | `HeroSlide.image` (path) | n/a | 4 | used as-is |
| Video block → poster | `VideoBlock.poster` (path of an own image) | n/a | 1 | `assertVideoBlocks` |
| Image block → image | `ImageBlock.src` (path of an own image) | n/a | 0 | check in `projects/index.ts:100-106` |
| Text → page or file | `href` strings inside rich text | n/a | 3 internal | none |

### Ordering rules

| List | Rule | Where |
|---|---|---|
| `projects` | position in the hand-written array | `projects/index.ts:45-87` |
| `/verk` index | the featured projects in array order, then the rest in array order | `projectsForIndex()`, `projects/index.ts:116-118` |
| Home „Sýnishorn verka" | `featuredProjects` in array order (6) | `projects/index.ts:89` |
| „Fleiri verk" | up to 3 other projects that share the project's **first** category, in array order, topped up from the featured projects; never itself, never twice | `moreProjects()`, `projects/index.ts:125-138` |
| `news` | array order is nominal; every consumer sorts | `news/index.ts:28-47` |
| News lists | `date` descending by string compare; the sort is stable, so same-day posts keep array order | `newsByDate()`, `news/index.ts:78-80` |
| Home news | the 3 newest | `latestNews(count)`, `news/index.ts:83-85`; `count` in `home.ts:115` |
| „Fleiri fréttir" | the 3 newest other posts | `MoreNews.tsx:10`, `:20-22` |
| A project's related news | `date` descending | `DetailContent.tsx:125-127` |
| `services` | position in the array | `services/index.ts:13-24` |
| „Tengd verk" | order of `relatedProjects` | `services/index.ts:30-40` |
| `people`, statements, process steps, slogans, slides | position in the array | their modules |
| Category tabs | position in `projectCategories` | `src/ui/pages/verk-page.tsx:21-24` |
| Project facts | order of `projectMetaFields` | `verk.ts:33-43` |

Display order is the array position in an `index.ts` import list. No item carries an order field.

### Build-time checks that throw

| Check | Fails when | Where |
|---|---|---|
| Image block ownership | an image block's `src` is not the project's cover or a gallery image | `projects/index.ts:97-106` (module scope) |
| Video poster and id | the poster is not one of the item's own images, or the id does not match `^\d+$` (Vimeo) or `^[A-Za-z0-9_-]{11}$` (YouTube) | `src/core/utils/video.ts:5-8`, `:16-32`; called at `projects/index.ts:108` and `news/index.ts:63` |
| Year-precision label | `datePrecision === "year"` and `dateLabel` is not the year | `news/index.ts:57-62` (module scope) |
| Unknown `relatedProject` | the slug matches no project | `news/index.ts:92-102`, reached through `NewsPostMeta.tsx:18` and `NewsArticle.tsx:55` |
| Unknown service project | a `relatedProjects` slug matches no project | `services/index.ts:30-40`, called at `src/ui/sections/Thjonusta/ServiceSection.tsx:27` |
| Unknown hero slide project | a slide's `project` matches no project | `src/ui/sections/Home/Hero.tsx:10-18`, `:42` |
| Image file | the file is missing, or is not a readable JPEG or PNG | `src/core/utils/image-dimensions.ts:23-40` |
| Editorial shape | a Viðurkenningar block is not prose, or has a heading | `src/ui/sections/UmOkkur/Vidurkenningar.tsx:10-16` (module scope) |
| Shape of every item | a field is missing or mistyped | `satisfies` in each data file; `tsc` during `next build` |

`getImageDimensions` runs for every project cover (`ProjectCover.tsx:23`), every project gallery or
placed image (`ProjectImage.tsx:31`) and every news lead image (`NewsHero.tsx:32`): 227 file reads
per build. It reads **JPEG and PNG only** (`image-dimensions.ts:33-37`); an AVIF or WebP file in
any of those positions fails the build.

Not checked anywhere: category strings against `projectCategories`; uniqueness of slugs or legacy
paths; existence of files that never pass through `getImageDimensions` (hero slides, page images,
portraits, a post's second and later images); internal `href`s in rich text; `date` format.

An unknown slug at request time is not a build error: both detail pages call `notFound()`
(`src/app/verk/[slug]/page.tsx:43`, `src/app/frettir/[slug]/page.tsx:33`) and `generateMetadata`
returns `{}` (`:28`, `:20`).

### `legacyPath`

Set on all 58 projects and posts. **No code reads it.** It is meant to feed a redirect map at
cutover; the generator does not exist yet (`README.md:53-87`). The README also lists 18 redirect
rules that come from no content item (old service pages to `/thjonusta#<slug>`, old section pages
to `/um-okkur`, `/verk-2` and `/sort/<category>` to `/verk`).

---

## 5. Media

### How images are referenced

Every image is a string path under `public/`, written into the data:

| Use | Path pattern | Referenced from |
|---|---|---|
| Project cover | `/projects/<slug>/<slug>-01.jpg` | `Project.image.src` |
| Project gallery | `/projects/<slug>/<slug>-02.jpg` onward | `Project.images[].src` |
| News images | `/news/<slug>/<slug>-01.jpg` onward | `NewsPost.images[].src` |
| Portraits | `/people/<slug>.jpg` | `Person.portrait` |
| Page images | `/assets/{home-hero.avif,home-hero.jpg,intro.jpg,um-okkur.jpg,samband.jpg}` | `home.ts:16-17`, `:103`, `:153`; `um-okkur.ts:7` |
| Logos | `/logo.svg`, `/logo-light.svg`, `/logo-vertical-light.png` | `header.ts:17`, `:34`; `footer.ts:13` |
| Share image | `/og-image.jpg` | `site.ts:50` |
| Favicon | `src/app/icon.png` | file convention |
| Download | `/files/<name>.pdf` | one rich-text link |

The naming is exact: on all 228 project and news images the position in the data equals the number
in the file name. Every file in `public/projects` and `public/news` is referenced by the data and
every reference exists (no orphans, none missing). File names are lower-case ASCII kebab-case by
rule (`README.md:946-948`).

### Widths, heights and `sizes`

- The data carries **no dimensions**. Where the layout needs them they are read from the file at
  build by `getImageDimensions` (`image-dimensions.ts:23-40`, guarded by `server-only`).
- Those dimensions set `width`/`height` on covers and gallery images, cap an image at its own pixel
  width (`ProjectImage.tsx:38`), and pick a layout from the width (cover at 1176 px, news hero at
  1000 px).
- Every other image uses `next/image` with `fill` inside a fixed-ratio box (3:2, 4:3, 3:4, 1:1 or
  16:9), cropped with `object-cover`. There is no focal point or crop data.
- The logos' sizes are literals in content (`header.ts:23-24`, `:37-38`; `footer.ts:16-17`).
- `sizes` strings are literals per component. With `images.unoptimized` they are not emitted
  (section 1).

### `next/image` versus `<img>`

`next/image` is imported by 19 files. The only raw `<img>`/`<picture>` is the home hero slideshow
(`src/ui/sections/Home/HeroSlideshow.tsx:156-175`), which serves the AVIF through `<source>` with a
JPEG fallback and is preloaded through `react-dom` `preload()` (`Hero.tsx:51-55`). The 404 page
uses a CSS background image from a remote URL (`src/ui/pages/not-found-page.tsx:12`).

### Alt text and captions

| Where the image shows | `alt` source |
|---|---|
| Project cover | `image.alt`, else `titleShort` (`ProjectCover.tsx:29`) |
| Project gallery and lightbox | `alt`, else „<title> — mynd N" (`DetailContent.tsx:118`) |
| Home project card, „Fleiri verk" | cover `alt`, else `titleShort` (`FeaturedProjects.tsx:62`, `MoreProjects.tsx:54`) |
| News hero | lead `alt`, else the post title (`NewsHero.tsx:66`, `:121`) |
| News gallery | `alt`, else „<title> — mynd N" (`DetailGallery.tsx:30`) |
| `/verk` cards, news cards, news index, „Tengd verk", project card on a post, video poster, hero slides | always `alt=""` (decorative) |
| Portraits, page images, logos | their own literal fields (`portraitAlt`, `imageAlt`, `logo.alt`) |

Authored `alt`: **24 of 228** content images (23 project images on 16 projects, 8 of them covers;
1 news image). All 24 are agency-drafted placeholders (section 8). `caption`: 0. `credit`: 0. No
component renders a caption or a credit. The lightbox shows the item's title and a counter
(`src/ui/components/shared/Lightbox/LightboxCaption.tsx:19-24`).

### Volume

| Folder | Files | Bytes | Format |
|---|---|---|---|
| `public/projects/` (40 folders) | 209 | 103.0 MB | JPEG |
| `public/news/` (18 folders) | 19 | 9.5 MB | JPEG |
| `public/assets/` | 5 | 1.7 MB | 4 JPEG, 1 AVIF |
| `public/people/` | 2 | 0.16 MB | JPEG |
| `public/files/` | 1 | 10.9 MB | PDF |
| `public/` root | 4 | 0.2 MB | 2 SVG, 1 PNG, 1 JPEG |
| **Total** | **240** | **125.5 MB** | 235 JPEG, 2 SVG, 1 PNG, 1 AVIF, 1 PDF |

The 228 project and news images:

- **Per item:** a project has 1 to 6 images (cover plus up to 5), median 6; one has only a cover. A
  post has 1, except one with 2.
- **File size:** average 493 KB, median 381 KB, smallest 49 KB, largest 2.33 MB. 20 images exceed
  1 MB and 81 exceed 500 KB. The 40 covers total 20.0 MB, and `/verk` requests all of them at full
  size.
- **Largest files:** the PDF (10.9 MB); then `gengid-a-gleri-og-grjoti-04.jpg` (2.33 MB),
  `thufnahopp-02.jpg` (2.19 MB), `flikk-flakk-vestmannaeyjar-04.jpg` (1.96 MB),
  `fellaskoli-veggur-med-meiru-04.jpg` (1.90 MB). The heaviest project folder is 8.6 MB.
- **Pixel size:** long edge capped at 2400 px, never upscaled, JPEG quality 82
  (`README.md:968-969`). Width: 2400 px on 83 images; 2000 to 2399 on 40; 1600 to 1999 on 24; 1176
  to 1599 on 33; 1000 to 1175 on 11; under 1000 on 37. Smallest 472 × 629. Most common sizes:
  2400 × 1800 (25), 960 × 720 (18), 2400 × 1600 (10). 141 distinct sizes.
- **Shape:** 36 portrait, 12 near-square, 75 near 4:3, 71 near 3:2, 34 wider.
- **Encoding:** progressive JPEG, sRGB. At least some files keep camera EXIF (make, model, capture
  date).
- **Duplicates:** 3 groups of byte-identical files (7 files): the same photograph stored separately
  under two or three projects.

Other raster files: home hero 2400 × 1350 (AVIF and JPEG), `intro.jpg` and `samband.jpg`
1600 × 1200, `um-okkur.jpg` 1920 × 720, `og-image.jpg` 1200 × 630, portraits 900 × 900, footer logo
480 × 354.

Full-size originals are kept outside the repository (`README.md:963-973`).

### Video and embeds

No video is hosted. One video block exists (Vimeo). The player iframe loads only after a click
(`PlacedVideo.tsx`); embed URLs are built in `src/core/utils/video.ts:35-49`. The contact page
embeds a Google Maps iframe from `siteConfig.addresses[].maps.embedUrl`
(`src/ui/sections/HafduSamband/MapSection.tsx:21-28`).

---

## 6. The data seam

**There is no single data-access layer.** `src/content/` is a tree of modules that export constants
evaluated at import, plus a few synchronous helper functions in the three collection index files.
Routes and components import those modules directly and read them synchronously.

### Size of the seam

Import statements from `@/content/*` in files outside `src/content/`:

| | Statements | Files |
|---|---|---|
| All | 121 | 60 |
| Value imports | 100 | 54 |
| Type-only imports | 21 | 21 |
| Value imports in `src/app` | 24 | 12 |
| Value imports in `src/ui` | 73 | 40 |
| Value imports in `src/core` | 3 | 2 |

Value imports by kind of module:

| Group | Statements | Files |
|---|---|---|
| Collections, `data/*` (projects, news, services, people, categories, navigation, editorial) | 24 | 22 |
| Page copy, `pages/*` | 27 | 27 |
| `routes` | 21 | 21 |
| `seo` | 10 | 10 |
| `site` | 7 | 7 |
| `ui` | 6 | 6 |
| `header`, `footer`, `forms/contact` | 5 | 5 |

The three collection barrels (`data/projects`, `data/news`, `data/services`) account for 18 of
those statements in 17 files. They are the closest thing to a narrow layer.

### Exports of the collection modules (all synchronous)

| Module | Export | Kind | Importers |
|---|---|---|---|
| `data/projects/index.ts` | `projects` | array | `src/app/sitemap.ts:2`, `src/app/verk/[slug]/page.tsx:4`, `src/ui/sections/Home/Hero.tsx:4` |
| | `featuredProjects` | array filtered at module load (`:89`) | `src/ui/sections/Home/FeaturedProjects.tsx:7` |
| | `projectsForIndex()` | function | `src/ui/pages/verk-page.tsx:4` |
| | `moreProjects(project, count = 3)` | function | `src/ui/sections/Verk/MoreProjects.tsx:7` |
| `data/news/index.ts` | `news` | array | `src/app/sitemap.ts:3`, `src/app/frettir/[slug]/page.tsx:4`, `src/ui/sections/Verk/DetailContent.tsx:22` |
| | `newsByDate()` | function | `src/ui/pages/frettir-page.tsx:4`, `src/ui/sections/Frettir/MoreNews.tsx:6` |
| | `latestNews(count)` | function | `src/ui/sections/Home/LatestNews.tsx:6` |
| | `newsPostDateTime(post)` | pure helper | `NewsPostMeta.tsx:2`, `frettir-page.tsx:4`, `NewsHero.tsx:6`, `DetailContent.tsx:22` |
| | `getNewsPostProject(post)` | function, throws | `NewsPostMeta.tsx:2`, `NewsArticle.tsx:10` |
| `data/services/index.ts` | `services` | array | `src/ui/pages/thjonusta-page.tsx:6`, `src/ui/sections/Home/ServicePreview.tsx:5` |
| | `getRelatedProjects(service)` | function, throws | `src/ui/sections/Thjonusta/ServiceSection.tsx:4` |
| `data/people.ts` | `people` | array | `src/ui/sections/UmOkkur/Team.tsx:4` |
| `data/categories.ts` | `projectCategories` | tuple | `src/ui/pages/verk-page.tsx:3` |
| | `allCategoriesLabel` | string | `src/content/pages/verk.ts:1` only |
| `data/navigation.ts` | `navItems` | array | `HeaderLinks.tsx:3`, `HeaderMobileMenu.tsx:12` |
| `data/editorial/*.ts` | default export | object | `Vidurkenningar.tsx:4`, `Umfjollun.tsx:4` |

**There is no "get by slug" function.** The lookup is written inline each time:
`projects.find((p) => p.slug === slug)` at `src/app/verk/[slug]/page.tsx:27` and `:42`,
`Hero.tsx:11`, `news/index.ts:95` and `services/index.ts:32`; `news.find(...)` at
`src/app/frettir/[slug]/page.tsx:19` and `:32`. A project's related news is an inline filter and
sort (`DetailContent.tsx:125-127`).

### Enumerators

| File | What it enumerates |
|---|---|
| `src/app/verk/[slug]/page.tsx:21-23` | `generateStaticParams`: every project slug |
| `src/app/verk/[slug]/page.tsx:25-38` | `generateMetadata`: finds the project; title, lead paragraph, cover as OG image |
| `src/app/frettir/[slug]/page.tsx:13-15` | `generateStaticParams`: every post slug |
| `src/app/frettir/[slug]/page.tsx:17-28` | `generateMetadata`: finds the post; title, lead paragraph |
| `src/app/sitemap.ts:11-45` | 6 static routes, every project, every post; all three lists are built at **module scope** (`:20-41`) |
| `src/app/robots.ts:6-31` | no content; `siteConfig` and environment only |
| the 6 static `page.tsx` files and `layout.tsx:17-44` | a static `export const metadata` built from `pageSeo`, `siteSeo`, `routes` and `siteConfig` |

Only the two `[slug]` routes use `generateMetadata`. The other eight metadata objects (six pages,
the layout and the 404) are module-level constants.

### How each page gets its data

| Page | Flow |
|---|---|
| `/verk/[slug]` | The route finds the `Project` and passes the whole object down as a prop (`page.tsx:45` → `detail-page.tsx:9` → `DetailContent`). Its children then import more themselves: `news` for related posts (`DetailContent.tsx:22`), `moreProjects` (`MoreProjects.tsx:7`), page labels (`verkContent`), `uiCopy`. |
| `/frettir/[slug]` | Same shape: the `NewsPost` goes down as a prop (`page.tsx:35` → `news-page.tsx:9` → `NewsArticle`); `NewsArticle` calls `getNewsPostProject` (`:55`), and `MoreNews` calls `newsByDate()` (`:20`). |
| `/` | No props. Each of the five sections imports its own data: `Hero` (`homeContent`, `projects`), `Intro`, `FeaturedProjects` (`featuredProjects`), `ServicePreview` (`services`), `LatestNews` (`latestNews`). |
| `/verk` | `verk-page.tsx:10-24` maps `projectsForIndex()` and `projectCategories` to plain props for the client component `WorkIndex`. |
| `/frettir` | `frettir-page.tsx:11-24` maps `newsByDate()` to plain props for the client component `NewsIndex`. |
| `/thjonusta` | `thjonusta-page.tsx` imports `services`; each `ServiceSection` calls `getRelatedProjects`. |
| `/um-okkur` | No props. Six sections each import their own module. |
| `/hafdu-samband` | No props. Two sections import `siteConfig`, page copy and form copy. |
| Layout | `Header` (client) and `Footer` (server) import their own modules. |

### Server components versus client components

Twenty files are marked `"use client"`. Two patterns exist.

**Client components fed plain, serialisable props built on the server** (no content module in the
browser bundle):

| Client component | Props built at |
|---|---|
| `WorkIndex` | `src/ui/pages/verk-page.tsx:10-34` |
| `NewsIndex` | `src/ui/pages/frettir-page.tsx:11-32` |
| `HeroSlideshow` | `src/ui/sections/Home/Hero.tsx:40-62` |
| `FeaturedCardImage` | `src/ui/sections/Home/FeaturedProjects.tsx:60-66` |
| `ServiceIndex` | `src/ui/pages/thjonusta-page.tsx:21-28` |
| `PlacedVideo` | `src/ui/components/common/PlacedVideoBlock.tsx:18-30` |
| `ProjectLightbox` | `src/ui/sections/Verk/DetailContent.tsx:131-137` |
| `DetailGallery` | `src/ui/sections/Frettir/NewsArticle.tsx:86-90` (receives `ImageAsset[]`) |

**Client components that import content values directly** (the module ships to the browser, and the
read cannot be awaited):

| File | Imports |
|---|---|
| `src/ui/components/layout/Header/Header.tsx:5-7` | `headerContent`, `routes`, `uiCopy` |
| `src/ui/components/layout/Header/HeaderLogo.tsx:6` | `headerContent` (both logos, `theme`) |
| `src/ui/components/layout/Header/HeaderLinks.tsx:3` | `navItems` (no directive of its own; imported by the client `Header`) |
| `src/ui/components/layout/Header/HeaderMobileMenu.tsx:12-13` | `navItems`, `uiCopy` |
| `src/ui/components/common/ContactForm.tsx:12-16` | `formCopy`, `MAX_LENGTHS`, `validationCopy` |
| `src/ui/components/shared/Lightbox/ImageLightbox.tsx:11` | `uiCopy` |
| `src/ui/sections/DetailPage/DetailGallery.tsx:7` | `uiCopy` |

So `header.ts`, `routes.ts`, `ui.ts`, `data/navigation.ts` and `forms/contact.ts` reach the
browser. `site.ts`, `seo.ts`, the page modules and the three collections do not. The header logo,
the navigation and the header theme are read inside a client component.

### Reads that happen at module scope

These run once when the module is imported, outside any function or component:

| Where | What |
|---|---|
| `src/content/data/projects/index.ts:89`, `:97-109` | `featuredProjects`; the image and video validation loop |
| `src/content/data/news/index.ts:57-64` | the date-label and video validation loop |
| `src/app/sitemap.ts:9`, `:20-41` | build time; the three URL lists |
| `src/app/layout.tsx:17-44` and six `page.tsx` files | `export const metadata` |
| `src/ui/sections/Home/Hero.tsx:7`, `FeaturedProjects.tsx:11-12`, `LatestNews.tsx:9`, `ServicePreview.tsx:9`, `Intro.tsx:7` | destructuring `homeContent` |
| `src/ui/sections/UmOkkur/Vidurkenningar.tsx:10-16` | flattens and validates the editorial blocks |
| `src/ui/sections/UmOkkur/Umfjollun.tsx:97-100` | splits the editorial blocks into two columns |

Content modules also depend on each other at module scope:

- `home.ts:5` and `seo.ts:4` read `siteConfig.addresses[0]`; `home.ts:150` and `seo.ts:61` compose
  sentences from `siteConfig`.
- `seo.ts:45` reuses `thjonustaContent.hero.description`.
- `navigation.ts:8-14` is built from `routes`; `home.ts:85-92`, `:102`, `:113`, `:124`, `:131` and
  `header.ts:40` take paths or labels from `routes`.
- `frettir.ts:36` and `:40`, and `verk.ts:16` and `:29`, alias labels owned by other page modules.

### Direction of dependencies

The README states that `content/` imports nothing from `app`, `ui` or `core` (`README.md:195-196`).
Two content files do import pure helpers from `core`: `data/projects/index.ts:2-3`
(`isImageBlock`, `assertVideoBlocks`) and `data/news/index.ts:3` (`assertVideoBlocks`).

### Summary of the seam

- Collections account for 24 value-import statements, 18 of them through three small barrels
  (17 files). By-slug lookups are inline in 7 places. All of it is synchronous.
- Singleton content (site settings, SEO, routes, page copy, labels, header, footer) is imported
  directly at the other 76 value-import statements.
- Detail pages receive their main item as a prop; every other piece of data is imported by the
  component that shows it.
- Seven files in the client bundle import content values directly.

---

## 7. What a runtime-backed integration would touch

### Things that exist only because the site is static

| Fact | Where |
|---|---|
| Publishing is a git commit to `main` followed by a Vercel build. No deploy hook, webhook receiver or revalidation endpoint exists. | whole repo |
| No route handlers at all, so no form endpoint, preview endpoint or webhook endpoint. Under export a handler could only be a build-time `GET` (`static-exports.md:233-251`). | no `route.ts` |
| No Draft Mode. It needs a route handler that sets a cookie (`next-docs/01-app/02-guides/draft-mode.md:16-40`) and is unsupported under export (`static-exports.md:290`). | not present |
| No draft or published state in the content model. | `types.ts` |
| The contact form validates in the browser, waits 400 ms, shows a success panel and sends nothing. It has a honeypot field. | `ContactForm.tsx:3-7`, `:83-112`; `README.md:583-615` |
| `robots.txt` and `sitemap.xml` are generated once per build; `lastModified` is the build time for all 64 URLs. | `robots.ts:4`, `sitemap.ts:7-9` |
| The noindex header is a `vercel.json` rule. | `vercel.json:3-8` |
| Image dimensions come from files on the build machine's disk. | `image-dimensions.ts:24-28` |
| Every validation in section 4 is a build failure, so a bad reference cannot reach a visitor. | section 4 |
| Images are served unoptimised from `public/`, full size. | `next.config.ts:6-8` |

### If `output: "export"` were removed

| Item | Current state | What changes or needs a decision |
|---|---|---|
| `images.unoptimized` | `true` (`next.config.ts:6-8`). No `srcset`. | It was needed because the default loader is unsupported under export (`static-exports.md:289`). Remote image URLs need `images.remotePatterns` (`image.md:71`, `:533-535`); none is set. |
| `sizes` strings | About 20, written to the layout, never emitted. | They become live as soon as images are optimised or a loader is set. |
| `getImageDimensions` | Reads `public/<src>` from disk; JPEG and PNG only. | It has no file to read for an image that is not in `public/`, and no path for a page rendered outside the build. It decides two layouts and supplies `width`/`height` for 227 images. |
| `[slug]` routes | `generateStaticParams` only; `dynamicParams` not set. | The default is `true`: a slug not in the list is rendered at request time (`next-docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/dynamicParams.md:16-17`). The pages then call `notFound()` for an unknown slug. |
| Revalidation | None. | ISR and on-demand revalidation need a server (`static-exports.md:288`). For ISR on generated paths the docs require an empty `generateStaticParams` array or `dynamic = 'force-static'` (`next-docs/01-app/03-api-reference/04-functions/generate-static-params.md:57`). |
| `robots.ts`, `sitemap.ts` | `force-static`; environment read at build. | They keep working. The sitemap's module-scope lists (`sitemap.ts:20-41`) freeze the content at build unless moved into the function. |
| `trailingSlash` | `false`, which is also the default (`next.config.ts:5`). | On Vercel today: clean paths answer 200, `/verk/` is a 308 to `/verk`, `/verk.html` is a 404 (`README.md:643-648`). Under export the flag also decides `about.html` versus `about/index.html` (`next-docs/01-app/03-api-reference/05-config/01-next-config-js/trailingSlash.md:27`). |
| `vercel.json` header | Applies to every deployment. | Platform rule, independent of the export. Cutover adds a `missing` host condition so only the production host drops it (`README.md:49-52`). |
| The noindex switches | `siteConfig.indexable` (`site.ts:48`) drives the robots meta (`layout.tsx:24`) and `robots.ts:13`; `vercel.json` is the third layer. | Three independent layers that must change together (`README.md:25-41`). `url` and `domain` are literals changed at cutover. |
| 404 | `app/not-found.tsx` → `404.html` and `_not-found.html`; it sets its own noindex (`not-found.tsx:5-11`). The image is a remote GIF. | With a server the same file serves unmatched URLs and `notFound()` calls. |
| Cutover redirects | None ship. Planned in `vercel.json` `redirects`, generated from `legacyPath` plus a fixed list; `vercel.json` is read before the build, so a generator script or Vercel bulk redirects is still to be chosen (`README.md:53-87`). Several targets carry a `#fragment`. | `next.config` `redirects` are unsupported under export (`static-exports.md:285`) and available without it (`next-docs/01-app/03-api-reference/05-config/01-next-config-js/redirects.md:10-24`). Nothing reads `legacyPath` yet. |
| Contact form | Inert. | A route handler or Server Action becomes possible (both unsupported under export, `static-exports.md:282`, `:291`). |
| Client-side content | Seven client-bundle files import content modules (section 6). | Those reads cannot be async; the values would have to arrive as props. |
| Module-scope reads | Listed in section 6. | Each is evaluated once per build or per server start, not per request. |
| Template functions | Eight functions in content (section 2). | Not serialisable as stored data. |
| Cache Components | Not enabled. | If enabled: `dynamicParams` is unavailable (`dynamicParams.md:22`) and `generateStaticParams` must return at least one param (`generate-static-params.md:310`). |
| Environment variables | `VERCEL_ENV` and `NODE_ENV` only, read at build. | No secret or token is read anywhere and no `.env` file exists. |
| Footer year | Build-time `new Date()` (`Footer.tsx:6`). | Stays a build-time or render-time value. |
| Third parties today | Google Fonts at build; a Google Maps iframe; Vimeo or YouTube after a click; one remote GIF. | No analytics, cookies or consent banner exist (`README.md:121-126`). |

### If the export stays

Everything in the table above stays as it is. Content then has to be available while `next build`
runs (Server Components run at build, `static-exports.md:53-57`), a content change needs a new
build to appear, and Draft Mode, ISR, Server Actions, request-time route handlers and default image
optimisation remain unavailable (`static-exports.md:274-292`).

---

## 8. Placeholder and provisional content

Provenance is recorded **only in code comments** next to each value (`PROPOSED PLACEHOLDER`,
`CONFIRMED`, `[ASSUMED — confirm]`, `DRAFT`) and in two documents. No field carries it, so it does
not travel with the data.

### Markers in `src/`

| Marker | Count | Meaning |
|---|---|---|
| `PROPOSED PLACEHOLDER` | 59 comment lines (the README says 57, `README.md:490`) | text drafted by the agency, not client copy |
| `[ASSUMED — confirm]` | 13 | a default taken without confirmation |
| `CONFIRMED` | 20, all in `src/content/` | client copy or a confirmed fact |

`docs/placeholder-manifest.md` is the checklist: 28 rows of copy and labels (`:16-43`), 24 alt-text
slots (`:52-75`), and a statement that no placeholder imagery ships (`:77-80`).

### By content type

| Content type | Placeholder or provisional | Everything else |
|---|---|---|
| **Projects** | `alt` on 23 images across 16 projects (`placeholder-manifest.md:52-75`). The poster choice of the one video block is assumed (`data/projects/samkeppni-hlemmur.ts:31`). | Titles, categories, text, links, facts and images are the client's own published content. |
| **News posts** | `alt` on 1 image. The four Christmas cards' day and month are assumed sort keys (`data/news/jolakvedja-*.ts:12-16`). | Titles, dates, text and images are the client's. |
| **Services** | One related project was chosen by the agency (`data/services/torg.ts:12-15`). | Titles, teasers and text are the client's. |
| **People** | None. | |
| **Categories** | The „Allt" label (`data/categories.ts:12-13`). | The seven labels are the client's. |
| **Site settings** | None marked. | |
| **Home page** | Section labels and headings: `servicePreview.eyebrow` and `.linkLabel`, `featuredProjects.eyebrow`, `.title` and `.linkLabel`, `latestNews.title` and `.linkLabel`, `homeCta.title` and the format of `homeCta.description` (`home.ts:109-155`). Assumed: the `·` separators in the hero eyebrow (`:39`), a dropped full stop in slogan 2 (`:61`), and the timings `slideSeconds: 4` (`:80-84`) and `rotation.seconds: 5` (`:136-139`). | The ten slogans, the intro title and body, and `servicePreview.title` are marked confirmed. |
| **Um okkur** | Two statement titles, „Markmið" and „Framtíðarsýn" (`um-okkur.ts:27-28`, `:33-34`). | Intro, statement bodies, „Gildi", the four process steps, both editorial sections. |
| **Þjónusta page** | `indexLabel`, `relatedLabel` (`thjonusta.ts:16-19`). | Hero title, description, lede. |
| **Verk page** | `hero.description`, `filter.label`, all six `detail.*` labels, four of the eight fact labels (`verk.ts:9-43`). | Hero title; the first four fact labels. |
| **Fréttir page** | The three type labels, the four filter labels, `detail.relatedProjectLabel`, `detail.moreTitle` (`frettir.ts:13-41`). | Page title. |
| **Hafðu samband** | `mapLinkLabel` (`hafdu-samband.ts:20-21`). | Title and the three field headings. |
| **SEO** | Descriptions for `verk`, `frettir` and `hafduSamband`; the project fallback template (`seo.ts:49-61`, `:71-73`). | The other titles and descriptions. |
| **UI labels** | The skip link, the two video labels (`ui.ts:7-8`, `:24-29`). | Menu, lightbox and gallery labels carry no marker. |
| **Contact form, footer, 404** | No markers. These are generic interface strings, not client copy. | |
| **Images** | None are placeholders. The hero, intro, Um okkur, CTA and share images are the agency's selections from the client's own images. | |

Also provisional as behaviour rather than text: the header's dark theme is a trial behind one switch
(`header.ts:15`), and the news filter's grouping of Christmas cards under „Fréttir" is assumed
(`NewsIndex.tsx:47-55`).

---

## 9. Anything surprising

### Fields that are authored but unused, or defined but never set

| Field | State |
|---|---|
| `legacyPath` on projects and posts | set on 58 items; read by no code |
| `Service.teaser` | set on 9; rendered nowhere |
| `HeroSlide.project` | set on 4; validated, never shown |
| `siteConfig.shortName`, `siteConfig.foundingDate` | set; read by nothing |
| `routes.home.label` („Heim") | set; read by nothing |
| `ImageAsset.caption`, `ImageAsset.credit` | in the type; never set, never rendered |
| `ProjectMeta.stadsetning`, `hlutverk`, `vidurkenning`, `ljosmyndir`, `features` | in the type with labels and render paths; never set |
| `ImageBlock` | type, validation and renderer exist; no item uses one |
| `hafduSambandContent.lede` | optional; unset |
| `image.alt` on `WorkIndexItem` and `NewsIndexItem` | passed to the client components (`verk-page.tsx:15-18`, `frettir-page.tsx:22`) but both render `alt=""` (`WorkIndex.tsx:167-169`) |
| `Person.slug` | a React key only |
| `detailSeoFallbacks.project` | never fires; every project has text |

### More than one source for the same thing

- `date` and `dateLabel` on every post are two hand-written forms of one date.
- The firm's opening sentence appears four times: `home.ts:98`, `um-okkur.ts:6` (inside a longer
  paragraph), `seo.ts:19`, `seo.ts:34`. The Verk intro appears twice: `verk.ts:11`, `seo.ts:51`.
- One email address is both `siteConfig.email` (`site.ts:51`) and a person's `email`
  (`people.ts:13`).
- Seven image files are duplicates of others, and three alt texts are repeated for them.
- Display order is encoded as array position in three `index.ts` files, so adding an item means a
  new file, an import line and a place in the array.
- Category membership is repeated label text on each project, not a reference.
- Two overlapping taxonomies, 9 services and 7 categories, share three names and are deliberately
  not joined (`README.md:369-378`).

### Naming that misleads

- The shared rich-text type is `ProjectDescriptionParagraph`; news, services and editorial use it.
- `titleShort` is the only title.
- `homeCta` and `sections/Home/Cta.tsx` render on `/thjonusta`, not on the home page.
- `pages/starfsmenn.ts` holds one heading for a section of `/um-okkur`; there is no such route.
- The package is named `dld-demo`; the main notes file is `docs/DEMO-NOTES.md`.

### Content or behaviour outside `src/content/`

| What | Where |
|---|---|
| „Mynd ekki tiltæk" (lightbox error text) | `src/ui/components/shared/Lightbox/LightboxImage.tsx:38` |
| „404" | `src/ui/pages/not-found-page.tsx:16` |
| The ` · ` separators between categories and between a person's title and role; the `©` line layout | `ProjectTitle.tsx:33`, `Team.tsx:37`, `Footer.tsx:109` |
| Lightbox counter „n / total" | `LightboxCaption.tsx:22-24` |
| Contents-list threshold (more than 3 headings) | `DetailContent.tsx:35` |
| „Fleiri fréttir" count (3), „Fleiri verk" count (3) | `MoreNews.tsx:10`, `projects/index.ts:125` |
| Layout thresholds 1176 px and 1000 px | `ProjectCover.tsx:11`, `NewsHero.tsx:14` |
| Which post kinds each news filter tab shows | `NewsIndex.tsx:52-55` |
| Sitemap priorities and change frequencies | `sitemap.ts:11-18` |
| Header and brand colours | `src/app/globals.css:3-18`, `:34-46` |
| OG image size 1200 × 630 | `metadata.ts:27`, `layout.tsx:32-33` |

Apart from the two strings in the first two rows, no visitor-facing text is hard-coded in
`src/ui` or `src/app`.

### Structural labels versus client copy

Roughly: `ui.ts`, `forms/contact.ts`, `footer.ts` labels, `routes` labels, the page modules' label
fields and `projectMetaFields` are interface labels. The client's own writing is in the projects,
posts, services, people, the two editorial sections, the Um okkur intro, statements and process
steps, the Þjónusta intro, the home intro and the ten slogans. The comments in each file say which
is which (section 8); the data does not.

### Other

- A wrong reference is always a build failure, never a runtime fallback, so the data has no
  tolerance for a dangling slug.
- Meta descriptions and excerpts are the whole first paragraph, untruncated. First paragraphs run
  to several hundred characters or more.
- News posts never use their own image as the share image.
- The first image of a post is both its hero and its card thumbnail; a project's cover is a
  separate field from its gallery.
- `out/` and `.next/` from a local build are present in the working tree (both gitignored).
- The README counts 57 placeholder markers; there are 59.
