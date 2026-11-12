# Probe: the DLD site without the static export

Run on 2026-11-12. A throwaway probe: nothing built here is kept, nothing was deployed, and no file
of either repository was changed (this report is the one file added, here). It answers one
question: can the DLD site leave `output: "export"` and take the Hub SDK on its current Next.js
version without changing what visitors get?

**Short answer.** Yes for the build and for the 64 existing pages. With the export line removed,
one `transpilePackages` line, one tsconfig flag and `dynamicParams = false` on two routes, the site
builds on Next.js 16.2.4 with the SDK, every existing URL is still prerendered at build, and all 64
pages plus the 404 are served with markup that is byte-identical to the export once script tags are
removed. The revalidation and preview routes work. Four things found here change how the real
integration has to be planned:

1. A CMS-driven route that accepts new slugs (`dynamicParams` on) answers every unknown or
   unpublished slug with a 404 whose HTML body is empty until JavaScript runs (section 6).
2. After a webhook, a page that reads the CMS answers **500** while the delivery host is
   unreachable. With the release marker in the root layout, as the spec asks, that is every page
   including the 404 (section 9).
3. The two dynamic routes trace all of `public/` (240 files, 125 MB) into their server bundle
   (section 13).
4. `npm audit` lists advisories against `next@16.2.4` that only matter once the site runs a server
   (section 13).

## 1. What was probed, and how

| | |
|---|---|
| Site | `dld-is` at `main` @ `13f1df0`: Next.js 16.2.4 (Turbopack), React 19.2.4, TypeScript 5.9.3, Tailwind v4, npm 10.9.8, Node 22.23.1 |
| Hub | this repository at `bf9cf20`; `@litljomi/cms-sdk` 0.1.0 and `@litljomi/rich-text` 0.1.0 |
| Where | a `git clone` of the site's local directory, in a session scratch folder (path in section 15) |
| Hosted reads | only the Hub's public Storage files over HTTPS: `delivery/demo/current.json`, `delivery/demo/releases/44.json`, one other tenant's pointer and bundle (to find an image, see 7.3), and that image. Eighteen read-only GETs of the site's public preview for the static-host baseline (section 5.4) |
| Not done | no deploy; nothing changed on Vercel, in DNS or in the Supabase project; no `.env*` file read; no browser run |

The clone has three probe branches. The other two build on `probe/no-export`.

| Branch | Commit | What it holds |
|---|---|---|
| `probe/no-export` | `a520841` | `output: "export"` removed, nothing else |
| | `1f5acb2` | `dynamicParams = false` on the two dynamic routes |
| | `46f73d5` | the vendored SDK and renderer, the scratch page, the revalidation and preview routes |
| | `9565358` | a scratch entry route with the default `dynamicParams` |
| `probe/images-on` | `f5716da` | image optimisation on, the media host as the only remote pattern |
| `probe/layout-marker` | `6bdc895` | the release marker in the root layout |

Claims about what Next.js 16 does cite the docs shipped in the site's
`node_modules/next/dist/docs/` (`next-docs/` below), or the shipped source where the docs are
silent.

**Packing.** `npm pack <hub>/packages/sdk <hub>/packages/rich-text --pack-destination <clone>/vendor`
was run with the clone as the working directory. `git status --porcelain --untracked-files=all` in
the Hub repository was identical before and after: packing left no file there.

```
8fd58a552bd7cc69449d6a459d55c2e566fcf04f102239951f877e69acc97cc2  vendor/litljomi-cms-sdk-0.1.0.tgz
b9741ff2d26389566ddc0b58b98ce0e5110f4eaee864c61d7fa38efb74827bd7  vendor/litljomi-rich-text-0.1.0.tgz
```

## 2. Config changes required

Everything the site's own files need, from `git diff main..probe/no-export`:

```diff
--- a/next.config.ts
+++ b/next.config.ts
 const nextConfig: NextConfig = {
-  output: "export",
   trailingSlash: false,
+  // The SDK and the renderer ship TypeScript source (Hub spec §7.3).
+  transpilePackages: ["@litljomi/cms-sdk", "@litljomi/rich-text"],
   images: {
     unoptimized: true,
   },
```

```diff
--- a/tsconfig.json
+++ b/tsconfig.json
     "noEmit": true,
+    "allowImportingTsExtensions": true,
```

```diff
--- a/package.json
+++ b/package.json
   "dependencies": {
+    "@litljomi/cms-sdk": "file:vendor/litljomi-cms-sdk-0.1.0.tgz",
+    "@litljomi/rich-text": "file:vendor/litljomi-rich-text-0.1.0.tgz",
```

```diff
--- a/src/app/verk/[slug]/page.tsx      (the same three lines in src/app/frettir/[slug]/page.tsx)
+++ b/src/app/verk/[slug]/page.tsx
+// Probe: without `output: "export"` an unknown slug would otherwise be rendered on demand.
+export const dynamicParams = false;
+
 export async function generateStaticParams() {
```

Why each one is needed, with the error it fixes:

| Change | Without it |
|---|---|
| Remove `output: "export"` | Route handlers that read the request, ISR and draft mode are unsupported under the export (`next-docs/01-app/02-guides/static-exports.md`, "Unsupported Features") |
| `transpilePackages` | The build fails in the compile step: `./node_modules/@litljomi/cms-sdk/src/index.ts` `Unknown module type. This module doesn't have an associated type.` (and the same for `@litljomi/rich-text`) |
| `allowImportingTsExtensions` | Compilation passes, then the type check fails: `./node_modules/@litljomi/cms-sdk/src/client.ts:2:33 Type error: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.` It needs `noEmit`, which the site already has. `skipLibCheck` does not cover it: the packages are `.ts` source, not declarations, so the site's build type-checks the SDK's source every time |
| `dynamicParams = false` on `/verk/[slug]` and `/frettir/[slug]` | The build passes, but an unknown slug is rendered on demand and its 404 has an empty body (section 6). Under the export the option is forced: `dynamicParams: true` is on the unsupported list |
| `images` | Unchanged. With `unoptimized: true` a remote `src` needs no `remotePatterns` entry and none is enforced. Turning optimisation on is section 10 |

Nothing else changed: `vercel.json`, `robots.ts`, `sitemap.ts` (both keep `dynamic = "force-static"`),
`not-found.tsx`, `postcss.config.mjs`. The build did not rewrite `tsconfig.json`.
`npx tsc --noEmit && npm run build`, the site's stated verification bar, passes.

**Dependencies.** `npm install` of the two tarballs added 46 packages (`node_modules` 361 MB to
381 MB, `package-lock.json` +582 lines): `@litljomi/rich-text` declares `@tiptap/*`, `@tiptap/pm`
and `zod` as dependencies, although the site imports only the renderer. None of it reaches the
browser: client JavaScript is 737,945 bytes without the SDK and 737,975 with it, and no client
chunk contains the SDK, ProseMirror or zod. The site's rule "five runtime dependencies" becomes
seven direct ones.

**Environment variables.** The build needs `CMS_DELIVERY_BASE_URL` and `CMS_TENANT` (both public)
and network access to the delivery host. Without them: `Error: CMS_DELIVERY_BASE_URL is not set`,
`Failed to collect page data for /cms-probe/[slug]`, exit 1. `CMS_WEBHOOK_SECRETS` is read only by
the revalidation route at request time; `CMS_PREVIEW_SECRETS` and `CMS_PREVIEW_BASE_URL` only by
preview. `CMS_MEDIA_HOST` is read at build once image optimisation is on.

**Fresh clone.** A `git clone` of `probe/no-export` with no `node_modules` passes `npm ci` and,
with the two public variables, `npm run build` (the check runbook `production.md` G2.5 asks for).

## 3. The build

Route table of `probe/no-export` at `46f73d5` (the scratch entry route of `9565358` adds
`● /cms-probe/[slug]  1h  1y` with 8 paths):

```
Route (app)                                               Revalidate  Expire
┌ ○ /
├ ○ /_not-found
├ ƒ /api/cms/preview
├ ƒ /api/cms/revalidate
├ ○ /cms-probe                                                    1h      1y
├ ○ /frettir
├ ● /frettir/[slug]
│ ├ /frettir/jolakvedja-dld-2019
│ ├ /frettir/hlemmtorg-kynnt
│ ├ /frettir/design-diplomacy-a-honnunarmars
│ └ [+15 more paths]
├ ○ /hafdu-samband
├ ○ /icon.png
├ ○ /robots.txt
├ ○ /sitemap.xml
├ ○ /thjonusta
├ ○ /um-okkur
├ ○ /verk
└ ● /verk/[slug]
  ├ /verk/fang-bekkir-vid-godafoss
  ├ /verk/or-samkeppni
  ├ /verk/utgafa-frimerkja-tileinkud-landslagsarkitektur
  └ [+37 more paths]

○  (Static)   prerendered as static content
●  (SSG)      prerendered as static HTML (uses generateStaticParams)
ƒ  (Dynamic)  server-rendered on demand
```

- **All 64 existing URLs are still prerendered at build**, of the same kinds as under the export:
  6 `○` pages, 40 + 18 `●` pages. None has a revalidation interval, because none reads the CMS.
  `robots.txt`, `sitemap.xml` and `icon.png` are `○` as before.
- **Dynamic:** only the two new route handlers.
- **The scratch page** is `○` with `Revalidate 1h, Expire 1y`: the SDK's pointer fetch
  (`revalidate: 3600`, tag `cms`) makes it ISR, not dynamic.
- The export's `out/` no longer exists. The prerendered HTML is in `.next/server/app/`: 66 `.html`
  files without the scratch routes (the 64 routes, `_not-found.html`, `_global-error.html`). The
  export also had 66, but composed differently (`404.html` and `_not-found.html`).

**Build time**, wall clock of `npm run build` after `rm -rf .next`, on one Mac, 9 workers:

| State | Pages generated | Seconds |
|---|---|---|
| `main`, with the export | 69 | 3.97, 3.78, 3.96 (5.61 on the first build after `npm ci`) |
| export removed | 69 | 3.82, 3.93, 3.68 |
| plus `dynamicParams = false` | 69 | 4.16 |
| plus SDK, scratch page, two route handlers (reads the hosted bucket) | 71 | 4.71, 5.83, 4.56 |
| plus the scratch entry route | 79 | 5.20, 4.46, 4.98, 4.78, 4.50, 4.52, 4.51 |

Removing the export does not change the build time. With the SDK and the scratch routes a build
takes about half a second to a second longer: the type check goes from about 1.25 s to about 1.5 s,
and page generation from about 0.25 s to between 0.3 and 0.9 s, which now includes the requests to
the hosted bucket. Build time on Vercel was not measured.

One of about 40 builds failed, in a step the export build has too: `next/font/google`
(`Module not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font'`,
`next/font/google queries have exactly one entry`, 30 errors). Five immediate reruns passed; it was
not reproduced.

## 4. Served output against the export

**How it was compared.** `next start -H 127.0.0.1 -p 3210`, then for every `<loc>` of the export's
`sitemap.xml` (64 paths) plus one unmatched path, `curl -s -o <file> -w '%{http_code}'`. A Node
script (`.probe/compare.mjs`) reads the served file and the export's file for the same path
(`out/<path>.html`, `out/index.html` for `/`, `out/404.html` for the unmatched path) and compares,
by regular expression over the raw HTML: every `<title>`, the text of every `<h1>`, the canonical
`href`, both robots metas, the description, `og:url` and `og:image`. It also requires exactly one
`<h1>` and the expected status, and reports whether the two files are byte-identical after removing
`<script>…</script>` blocks and `<link>` tags that point at `/_next/static/`. The export compared
against was the site repository's own `out/` (built 2026-11-12 02:57, seconds before the last
commit was made), and again the clone's own fresh export of `main`.

**Result, against both exports, at `1f5acb2` and again at `9565358`:**

```
65 paths compared: 65 match (status, title, h1, canonical, robots, description, og:url, og:image),
0 differ; 65 have byte-identical markup once <script> and /_next/static <link> tags are removed
```

A sample of the 65 rows:

| Status | Path | `<title>` | `<h1>` | Canonical |
|---|---|---|---|---|
| 200 | `/` | Dagný Land Design – landslagsarkitektúr, skipulag og vöruhönnun | Að horfa með vakandi augum og opnum huga á hvert verkefni | `https://dld.litljomi.is` |
| 200 | `/verk` | Verk \| Dagný Land Design | Verk | `…/verk` |
| 200 | `/frettir` | Fréttir \| Dagný Land Design | Fréttir | `…/frettir` |
| 200 | `/thjonusta` | Þjónusta \| Dagný Land Design | Þjónusta | `…/thjonusta` |
| 200 | `/um-okkur` | Um okkur \| Dagný Land Design | Um okkur | `…/um-okkur` |
| 200 | `/hafdu-samband` | Hafðu samband \| Dagný Land Design | Hafðu samband | `…/hafdu-samband` |
| 200 | `/verk/fang-bekkir-vid-godafoss` | Fang bekkir við Goðafoss \| Dagný Land Design | Fang bekkir við Goðafoss | `…/verk/fang-bekkir-vid-godafoss` |
| 200 | `/verk/samkeppni-hlemmur` | Samkeppni um Hlemmsvæði \| Dagný Land Design | Samkeppni um Hlemmsvæði | `…/verk/samkeppni-hlemmur` |
| 200 | `/frettir/hlemmtorg-kynnt` | Hlemmtorg kynnt \| Dagný Land Design | Hlemmtorg kynnt | `…/frettir/hlemmtorg-kynnt` |
| 200 | `/frettir/jolakvedja-dld-2019` | Jólakveðja 2019 \| Dagný Land Design | Jólakveðja 2019 | `…/frettir/jolakvedja-dld-2019` |
| 404 | `/this-page-does-not-exist-probe` | Síða fannst ekki \| Dagný Land Design | Ekkert að finna hér | none |

What does differ inside the removed tags, on one project page diffed in full (51,907 bytes in both):
two chunk file names and the build id inside the inlined flight payload. Nothing else.

`robots.txt` is byte-identical to the export's (`User-Agent: *`, `Disallow: /`). `sitemap.xml` has
the same 64 `<loc>` entries and is identical apart from `<lastmod>`, which is the build time.

## 5. Routing and headers

### 5.1 Edge URLs under `next start`

| Request | Answer |
|---|---|
| `/verk` | 200 |
| `/verk/` | 308, `location: /verk` (and `/verk/<slug>/` to `/verk/<slug>`) |
| `/verk.html`, `/index.html`, `/404.html`, `/verk/<slug>.html` | 404, the site's 404 page |
| `/verk/finnst-ekki-probe`, `/frettir/finnst-ekki-probe` | 404, the site's 404 page, with `dynamicParams = false` (section 6 without it) |
| `/this-page-does-not-exist-probe`, `/VERK`, `/projects` | 404, the site's 404 page |
| `/404`, `/_not-found` | 404 |
| `/robots.txt`, `/sitemap.xml`, `/icon.png` | 200 |
| `/verk.txt`, `/index.txt`, `/__next._tree.txt` | 404. The export publishes these flight-payload files (200, `text/plain` on the static host); the server build answers `GET /verk?_rsc=…` with `RSC: 1` as `text/x-component` instead. Nothing a visitor requests by hand |
| `POST /verk` | 405 |

### 5.2 The same URLs on the static host today

Read from the public preview, which is the export on Vercel: `/verk` 200, `/verk/` 308 to `/verk`,
`/verk.html` 404, an unknown slug and an unmatched path 404 with `x-matched-path: /_not-found`.
**The server build answers every one of these the same way locally.**

### 5.3 Headers that differ from the static host

| | Static host today (Vercel, export) | `next start` |
|---|---|---|
| Prerendered page | `cache-control: public, max-age=0, must-revalidate`, `etag`, `x-vercel-cache: HIT` | `Cache-Control: s-maxage=31536000`, `ETag`, `x-nextjs-cache: HIT`, `x-nextjs-prerender: 1` (sent twice), `x-nextjs-stale-time: 300`, `X-Powered-By: Next.js`, `Vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept-Encoding` |
| ISR page (the scratch page) | none exists | `Cache-Control: s-maxage=3600, stale-while-revalidate=31532400`, `x-nextjs-cache: HIT`, or `MISS` on the first read after a webhook |
| 404, unmatched path | `public, max-age=0, must-revalidate` | `private, no-cache, no-store, max-age=0, must-revalidate` |
| `robots.txt`, `sitemap.xml` | `public, max-age=0, must-revalidate`; `text/plain; charset=utf-8` | the same cache header; `text/plain` without a charset |
| Files from `public/` | `public, max-age=0, must-revalidate`, strong `etag` | `public, max-age=0`, weak `ETag`, `Last-Modified` |
| `/_next/static/*` | `public,max-age=31536000,immutable` | the same |
| `X-Robots-Tag: noindex, nofollow` | on every response (`vercel.json`) | absent: `next start` does not read `vercel.json` |
| `strict-transport-security`, `access-control-allow-origin: *`, `content-disposition: inline` | present (Vercel adds them) | absent |

Conditional requests work (`If-None-Match` gives 304), `HEAD` works, and `next start` gzips when
asked. What Vercel sends for a prerendered or ISR page of a server build was not observed.

### 5.4 Reads of the public preview

Ten GETs of `https://dld.litljomi.is` (`/`, `/verk`, `/verk/`, `/verk.html`, one project, one
unknown slug, one unmatched path, `/robots.txt`, `/sitemap.xml`, `/logo.svg`) and eight more for
the `.txt` files, `/404` and two cache headers. Read-only, for the tables above.

## 6. Unknown slugs and the 404 page

With the export gone and nothing else changed (`a520841`), `dynamicParams` takes its default,
`true` (`next-docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/dynamicParams.md`:
segments not in `generateStaticParams` "are generated at request time"). Measured:

```
GET /verk/finnst-ekki-probe
HTTP/1.1 404 Not Found
x-nextjs-cache: MISS
Cache-Control: s-maxage=31536000
Content-Length: 15517
```

The status is right and the `<title>` is the 404 page's, but the document is
`<html id="__next_error__">` with an empty `<body>`: 1,606 bytes of markup once scripts are
removed, no `<h1>`. The text "Ekkert að finna hér" is only inside the inlined flight payload, so the
404 page can appear only once JavaScript has run (not checked in a browser) and not at all without
it. The static 404 is 29,478 bytes with 14,815 bytes of markup. The response is marked cacheable
for a year, and each such URL writes four files
(`<slug>.html`, `.meta`, `.rsc`, `.segments`) into `.next/server/app/verk/`. The shell is what
Next.js builds for a thrown `notFound()` (`node_modules/next/dist/server/app-render/app-render.js`,
`getErrorRSCPayload`); the scratch entry route gave the same shell, so it is not specific to the
site's pages.

With `export const dynamicParams = false` on both routes (`1f5acb2`): an unknown slug gets the
prerendered 404 page, markup byte-identical to the export's `404.html`, `Cache-Control: private,
no-cache, no-store, max-age=0, must-revalidate`, and nothing is written to disk. That is what the
comparison in section 4 ran against.

**The same rule seen from the CMS side.** The scratch entry route (`/cms-probe/[slug]`, default
`dynamicParams`) was run against a loopback copy of the public files whose next release adds one
slug and drops another (`sh .probe/run-checks.sh slugs`):

| When | Request | Answer |
|---|---|---|
| Release 44 | a slug published at build | 200, full HTML, `HIT` |
| | a slug not published yet | 404, `__next_error__` shell, `s-maxage=3600, stale-while-revalidate=31532400`, cached (`MISS` then `HIT`) |
| Release 45 published, signed webhook | the new slug, first read | **200, full HTML**, `MISS`; second read `HIT` |
| | the dropped slug, first read | **404**, `__next_error__` shell |
| | a slug that never existed | 404, `__next_error__` shell |

So a page for a slug published after the build appears on the first request after the webhook, and
the 404 cached for that URL before the publish is replaced. The price is that every 404 on such a
route has the empty body. The two properties come from the same switch: with `dynamicParams =
false` the 404 is the static page and a new slug needs a new build.

The SDK's own scanner reads the shell to its end and finds no marker
(`scanEntryMarkers`: `ids: 0, complete: true`), and the status is 404, which is what the live
check's `absent` rule for an entry's own path asks for (spec §7.4).

## 7. The SDK integration

Added files, all new, none imported by an existing page:

- `src/core/cms/client.ts`: `import "server-only"`, then the reference integration's client
  (`apps/demo-site/src/lib/cms.ts`): `cms()` with the preview option, `publishedCms()` for
  `generateStaticParams`, the variables read on use.
- `src/app/cms-probe/page.tsx`: the scratch page.
- `src/app/cms-probe/[slug]/page.tsx`: the scratch entry route (section 6).
- `src/app/api/cms/revalidate/route.ts` and `src/app/api/cms/preview/route.ts`.

`revalidateTag` from 16.2.4's `next/cache` is accepted by `createRevalidateHandler` as it is; the
type check passes.

### 7.1 Markers

The scratch page read the `demo` tenant's release 44 from the hosted public bucket at build. Its
served HTML, read with the SDK's own parsers (`parseReleaseMarker`, `parseEntryMarkers`,
`scanEntryMarkers`, imported from the vendored tarball):

```
"releaseMarker": 44, "entryMarkers": 8, "scanComplete": true,
"firstMarker": { "id": "37afdb8f-e706-43be-a66b-8df4d0c20e37",
                 "hash": "bb96ba459e7145a0597cb989215355981c7f60011a42b1e1e029e4a5c6aca68c" }
"releaseLine": "tenant demo, release 44, generated 2026-11-12T12:22:36.399Z"
"h1": ["CMS probe"]
```

`CmsReleaseMarker` was rendered inside the page, not in a `<head>`: React hoists the `<meta>` and
the parser finds it. The site's sitemap still has 64 URLs; the scratch routes are not in it.

### 7.2 Rich text

One entry's `description`, through `RichText` from the vendored renderer:

```html
<p><strong>PRUFA</strong></p><ol start="1"><li><p>prufa</p></li><li><p>prufa</p></li></ol><h3>prufa</h3><p></p><p></p><p></p>
```

The renderer emits bare elements with no class names. For an image node it emits a plain `<img>`
with the media host's URL (`packages/rich-text/src/render.tsx`), not `next/image`: such images
would bypass the optimiser whatever the site's `images` setting is.

### 7.3 Image

The `demo` tenant's release has no image: its `event` type has no image field, and no rich-text body
holds an image node. The media host holds one public image, from another tenant's release
(1240×826 JPEG, 533,167 bytes). The scratch page takes it from that tenant's public bundle through
the SDK when `CMS_PROBE_IMAGE_TENANT` is set, and renders it with `next/image` from the bundle's
`width` and `height`. The bundle's dimensions match the file (checked with `sips`). With
`unoptimized: true` it is emitted as:

```html
<img data-probe="image" alt="" loading="lazy" width="1240" height="826" decoding="async"
     data-nimg="1" style="color:transparent" src="https://<project-ref>.supabase.co/storage/v1/object/public/media-public/…/….jpg"/>
```

The authored `sizes` is dropped, as for every image on the site today (section 10.1).

## 8. The revalidation route

The commands, as `.probe/run-checks.sh` runs them. The secret is a random test value made per run
and passed on the command line; the signature comes from the SDK's own `signWebhook`.

```sh
SECRET="$(openssl rand -hex 32)"
CMS_DELIVERY_BASE_URL=… CMS_TENANT=demo CMS_WEBHOOK_SECRETS="$SECRET" \
  npx next start -H 127.0.0.1 -p 3210 &

BODY='{"probe":true}'; TS=$(date +%s)
SIG=$(CMS_SIGN_SECRET="$SECRET" node --no-warnings -e \
  "import('./.probe/sdk/package/src/webhook.ts').then(m=>process.stdout.write(m.signWebhook(process.argv[1],process.env.CMS_SIGN_SECRET,Number(process.argv[2]))))" \
  "$BODY" "$TS")
curl -s -X POST -H "x-cms-signature: $SIG" -H "x-cms-timestamp: $TS" \
  -H 'content-type: application/json' --data "$BODY" http://127.0.0.1:3210/api/cms/revalidate
```

**Against the hosted public bucket** (`sh .probe/run-checks.sh real`):

```
signed POST -> 200 {"revalidated":true,"at":"2026-11-12T17:04:56.153Z"}
before : x-nextjs-cache: HIT    renderedAt 2026-11-12T17:04:53.193Z   release 44
after-1: x-nextjs-cache: MISS   renderedAt 2026-11-12T17:04:56.327Z   release 44
after-2: x-nextjs-cache: HIT    renderedAt 2026-11-12T17:04:56.327Z   release 44
```

**Against a loopback copy of the same public files, with the pointer moved to a locally made
release 45** (`sh .probe/run-checks.sh mirror`). The copy logs every request it serves:

```
== pointer flipped to release 45, no webhook: two reads
flipped-1: x-nextjs-cache: HIT   release 44      mirror: (no request)
flipped-2: x-nextjs-cache: HIT   release 44      mirror: (no request)
== signed POST
signed POST -> 200 {"revalidated":true,"at":"2026-11-12T17:13:40.672Z"}
== after the webhook: two reads
after-1: x-nextjs-cache: MISS  release 45  "event: PROBE next release (prufa)"
   mirror: GET /demo/current.json
   mirror: GET /demo/releases/45.json
after-2: x-nextjs-cache: HIT   release 45        mirror: (no request)
```

The first request after the webhook already shows the new release: it blocks, re-reads the pointer
and fetches the new bundle. When the pointer still names the same release, only the pointer is
fetched again; the bundle comes from the data cache.

**Refused requests:**

```
bad signature (64 hex zeros)           -> 401 {"revalidated":false}
signed with another secret             -> 401 {"revalidated":false}
stale timestamp (now-330 s, signed)    -> 401 {"revalidated":false}
future timestamp (now+330 s, signed)   -> 401 {"revalidated":false}
timestamp sent differs from signed     -> 401 {"revalidated":false}
body differs from the signed body      -> 401
no signature headers                   -> 401
GET instead of POST                    -> 405
```

None of them caused a request to the delivery host or a regeneration. The window is 300 seconds
either way; a request signed for `now+301` was accepted once in an early run because a second had
passed before it arrived, which is the handler working as written. A replay of an accepted request
inside the window is accepted again, as the SDK documents.

`/api/cms/revalidate` answers 404 to `GET` at the export commit and 405 once the route exists.

## 9. When the delivery host is unreachable

`sh .probe/run-checks.sh outage`: build, start, stop the loopback copy, send a signed webhook, read.

```
signed POST -> 200 {"revalidated":true,…}
read 1: HTTP/1.1 500 Internal Server Error
read 2: HTTP/1.1 500 Internal Server Error
read 3: HTTP/1.1 500 Internal Server Error
an existing page: 200
== delivery host back
back-1: HTTP/1.1 200 OK x-nextjs-cache: MISS   release 44
```

The body of the 500 is the 21 bytes `Internal Server Error`: the site has no `error.tsx` or
`global-error.tsx`. The server log shows `TypeError: fetch failed` with `ECONNREFUSED`. The page
recovers on the first request after the host returns.

This differs from spec §7.3 ("sites keep serving their last good pages") and from
`next-docs/01-app/02-guides/incremental-static-regeneration.md` ("If an error is thrown while
attempting to revalidate data, the last successfully generated data will continue to be served").
The difference is `{ expire: 0 }`: the tag is expired, not stale, so there is no page to fall back
on and the render error reaches the visitor. The time-based path (the hourly `revalidate: 3600`
with the host down and no webhook) was not tested. Under the export no visitor request depends on
the Hub at all.

**With the release marker in the root layout** (`probe/layout-marker`, spec §7.3 item 3), the same
sequence:

```
POST -> 200
/                                  500
/verk                              500
/verk/fang-bekkir-vid-godafoss     500
/this-page-does-not-exist-probe    500
/robots.txt                        200
/sitemap.xml                       200
```

That branch also shows what the marker does to the route table: every page stays `○` or `●` but
gains `Revalidate 1h, Expire 1y`, `/_not-found` included, and is served with
`s-maxage=3600, stale-while-revalidate=31532400`. The build still makes one request for the pointer
and one for the bundle. Title, `<h1>` and canonical still match the export on all 65 paths. The
markup is no longer byte-identical: besides the `<meta name="cms-release">`, the two image preloads
in the home page's `<head>` swap order and one React `useId` value on `/verk` changes (6 of 8
sampled pages are identical once the marker is removed).

## 10. Images

### 10.1 Today (`images.unoptimized: true`)

The site has 25 `next/image` usages in 19 files, 19 of them with an authored `sizes` (the six
without: the three header logos, the footer logo, the project cover and the sharp image of the news
band hero), and one raw `<img>` inside a `<picture>` (the home hero). On seven pages sampled, every
image is emitted as a plain `<img src="/projects/…jpg">`: **no `srcset` and no `sizes` attribute on
any of them**. The authored `sizes` strings are not in the HTML at all.

### 10.2 Optimisation on (`probe/images-on`)

```diff
   images: {
-    unoptimized: true,
+    remotePatterns: [
+      {
+        protocol: "https",
+        hostname: process.env.CMS_MEDIA_HOST ?? "media.invalid",
+        pathname: "/storage/v1/object/public/media-public/**",
+        search: "",
+      },
+    ],
   },
```

It builds, with the same route table. Title, `<h1>` and canonical still match the export on all 65
paths; the markup of every page changes, because every image tag does.

**What the existing usage emits.** `/verk`: 42 `<img>`, 41 with a `/_next/image?url=…&w=…&q=75`
`src` and a `srcset`, 40 with `sizes`. **The authored `sizes` strings become live**, for example
`(min-width: 1536px) 450px, (min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw` with ten
width candidates from 256 to 3840. Image preloads change from `href` to `imagesrcset` plus
`imagesizes`. Unchanged: the SVG logo (`next/image` leaves a `.svg` source unoptimised) and the home
hero's `<picture>`.

**Bytes.** Each first-time variant is made on request and cached under `.next/cache/images`.

| Page | Local images | Originals | As `w=640` WebP | As `w=1080` WebP |
|---|---|---|---|---|
| `/verk` | 41 | 20,014,658 B | 1,825,552 B (9.1 %) | 4,110,180 B (20.5 %) |
| `/thjonusta` | 25 | 11,609,057 B | 1,042,612 B (9.0 %) | 2,368,820 B (20.4 %) |
| `/` | 11 | 4,749,359 B | 469,128 B (9.9 %) | 1,141,836 B (24.0 %) |

One project cover: 368,309 B as the JPEG original (2400×1600), 22,372 B at `w=640`, 61,594 B at
`w=1080`. The first request for a variant took 0.56 s, later first-time variants 0.02 to 0.2 s, a
cached one 2 ms. The remote image: 200 at `w=640` (22,294 B) and `w=1080` (42,052 B).

**What breaks or changes.** Nothing failed at build or in the checks. These behave differently:

| Case | Observed |
|---|---|
| Images with width and height but no `sizes` (the project cover, the sharp image of a news band hero, the footer logo) | one candidate, `w=3840 … 1x`, or `1x` and `2x`. The cover is served at its own width as WebP (207,192 B against 368,309 B), not responsively |
| The news band hero | the blurred ground (`sizes="100vw"`, eight candidates) and the sharp image (`w=3840` only) now request different URLs. The code comment there says "the same file as the sharp image, so it costs no second download"; with optimisation on that stops being true |
| A quality other than 75 | `400 "q" parameter (quality) of 80 is not allowed`. `qualities` defaults to `[75]` and the docs call the field required from Next.js 16 |
| A width outside the configured lists | 400 |
| A local image with a query string | `400 "url" parameter is not allowed` with no `localPatterns` configured; no image `src` in the site has one |
| An SVG asked of the optimiser directly | `400 "url" parameter is valid but image type is not allowed` |
| The media host with a query string, or a path outside `media-public` | 400, because of `search: ""` and `pathname` |
| Any other remote host | `400 "url" parameter is not allowed` |
| Response headers of an optimised image | `Cache-Control: public, max-age=14400, must-revalidate`, `Vary: Accept`, `Content-Disposition: attachment; filename="….webp"`, `Content-Security-Policy: script-src 'none'; frame-src 'none'; sandbox;`. Opening such a URL in a tab downloads it; today's files are served inline |
| Rich-text images | bypass the optimiser (section 7.2) |

The site's `og:image` values are unaffected: metadata uses the original paths.

**`minimumCacheTTL`** defaults to **14400 seconds (4 hours)** in this version:
`next-docs/01-app/03-api-reference/02-components/image.md`, "`minimumCacheTTL`" ("If no
configuration is provided, the default below is used … `minimumCacheTTL: 14400, // 4 hours`"), and
`node_modules/next/dist/shared/lib/image-config.js`. The same section says the max age of an
optimised image is the larger of `minimumCacheTTL` and the upstream `Cache-Control`, and that
"There is no mechanism to invalidate the cache at this time". Both test cases gave 14400: the local
file is served with `max-age=0`, the media host with `max-age=3600`.

Not checked: any of this in a browser (the rotating home cards, the lightbox, the slideshow), and
anything on Vercel, where the platform's own optimiser and its pricing apply.

### 10.3 What a remote image needs in place of `image-dimensions.ts`

`src/core/utils/image-dimensions.ts` reads `public/<path>` with `readFileSync` and parses the JPEG
or PNG header. Three components call it: `ProjectCover` (intrinsic size, and wide or narrow layout),
`ProjectImage` (intrinsic size and `max-width`) and `NewsHero` (full-bleed hero from 1000 px, band
hero below). Given a remote URL it would look for a file under `public/` and throw
`Image not found`.

A remote image needs its width and height as data. The bundle carries them: `PublicAsset` has
`id`, `url`, `width`, `height`, `mime`, `alt` and an optional `focal`
(`packages/sdk/src/bundle.ts`), and the one real asset checked had the right values. With
optimisation on it also needs the media host in `remotePatterns`.

## 11. The data cache limit, and the bundle

**The limit.** The docs in `node_modules` do not state one. A search of `next-docs/` for `2MB`,
`2 MB`, "size limit" and "data cache" with "limit" finds nothing about cached `fetch` responses, in
16.2.4 or in the 16.4.3 docs in this repository's `node_modules`. The limit is in the shipped
source, `node_modules/next/dist/server/lib/incremental-cache/index.js`:

```js
// FetchCache has upper limit of 2MB per-entry currently
const itemSize = JSON.stringify(data).length;
if (ctx.fetchCache && itemSize > 2 * 1024 * 1024 && !this.hasCustomCacheHandler && !ctx.isImplicitBuildTimeCache) {
    const warningText = `Failed to set Next.js data cache for ${ctx.fetchUrl || pathname}, items over 2MB can not be cached (${itemSize} bytes)`;
    if (this.dev) { throw … }
    console.warn(warningText);
    return;
}
```

The 2,097,152 is measured on the serialised cache entry, in which the body is base64
(`server/lib/patch-fetch.js`: `body: Buffer.from(bodyBuffer).toString('base64')`). A 1,600,000-byte
body measured 2,133,678, so the overhead is 342 bytes and **the limit on the response body is about
1,572,600 bytes (1.57 MB)**, not 2 MB.

**What happens above it**, measured with the bundle padded on the loopback copy
(`sh .probe/run-checks.sh big <bytes>`):

| | 1,500,000-byte bundle | 1,600,000-byte bundle |
|---|---|---|
| Build | passes, no warning | passes, with `Failed to set Next.js data cache for …/releases/45.json, items over 2MB can not be cached (2133678 bytes)` once per consumer |
| Requests for the bundle during a build with 10 consumers | 1 | 10 |
| After a webhook that names the same release | pointer fetched, bundle from the cache | pointer **and bundle** fetched again, and the warning again |
| `next dev` | not run | the page answers 200; the log shows `Failed to set fetch cache … Error: Failed to set Next.js data cache …` and the bundle is fetched on every request |

So above the limit nothing fails. The bundle is simply never cached: every page render at build and
every regeneration downloads it again. Whether Vercel applies the same check was not verified.

**The bundle.** The `demo` tenant's release 44 is **5,842 bytes** (1,685 gzipped; `content-length:
5842`, `cache-control: public, max-age=31536000, immutable`), 8 entries of one type: 0.37 % of the
limit. The pointer is 110 bytes with `max-age=30`. For scale only, and not a bundle measurement:
the site's whole content layer, `src/content/`, is 232,688 bytes of TypeScript source.

**`revalidateTag(tag, { expire: 0 })` in 16.2.4 and in 16.4.** The two versions' docs
(`01-app/03-api-reference/04-functions/revalidateTag.md`, 16.2.4 from the site, 16.4.3 from this
repository) describe the same behaviour in different words:

| | 16.2.4 | 16.4.3 |
|---|---|---|
| Where `{ expire: 0 }` appears | only a closing note: "For webhooks or third-party services that need immediate expiration, you can pass `{ expire: 0 }` … This pattern is necessary when external systems call your Route Handlers and require data to expire immediately" | a listed case: "**`{ expire: 0 }`**: Stale content is never served, so the next request is a blocking revalidate/cache miss" |
| No second argument | "(deprecated): The tag entry is expired immediately, and the next request … will be a blocking revalidate/cache miss" | "(deprecated): Behaves like `{ expire: 0 }`" |
| The object form | "an object with an `expire` property for custom expiration behavior" | "an object with an `expire` property, in seconds"; for a named profile "only its `expire` is read" |

In the source, 16.2.4 passes the object through and treats `expire === 0` like the no-profile path
(`server/web/spec-extension/revalidate.js`; the file-system cache sets the tag's `expired` to now).
16.4.3 additionally validates and normalises the object. Measured on 16.2.4 in section 8: the first
request after the webhook is a blocking miss with the new release.

## 12. Invariants of the site that change meaning

From the site's README and `docs/`. "Vercel" in the last column means it could not be checked
locally and has to be checked on a Vercel preview deployment of a server build.

| Invariant | Today | Without the export | Re-check on Vercel |
|---|---|---|---|
| Noindex layer 1, `robots.ts` reading `VERCEL_ENV` | evaluated at build, written to `out/robots.txt` | unchanged: `dynamic = "force-static"`, still `○`, byte-identical output. The value is still fixed at build, so promoting a build without rebuilding keeps its `robots.txt` | that `robots.txt` on a preview and on production reads as intended |
| Noindex layer 2, robots meta from `siteConfig.indexable` | in every exported page | unchanged on the 64 pages. New: route handlers answer JSON with no meta, and pages rendered on demand take the flag from the deployed build | none beyond a spot check |
| Noindex layer 3, `vercel.json` `X-Robots-Tag` on `/(.*)` | on every static response | `next start` ignores `vercel.json`, so nothing was observed | the header on a prerendered page, an ISR page, a page rendered on demand, both kinds of 404, `/api/cms/*`, `/_next/image` and `/_next/static`. At cutover, the same list with the `missing` host condition |
| `vercel.json` in general | headers only; "no redirects before cutover" | still valid as written. The file gains meaning it did not have: it can now set function regions (the reference site pins `fra1`; this file names none) | the region functions run in |
| `not-found` | Vercel serves the exported 404 for anything unmatched, unknown slugs included | unmatched paths: the same page, different cache header (5.3). Unknown slugs: the same page only with `dynamicParams = false`; otherwise the empty-body 404 (section 6). The README's false-positive note about `noindex` in `not-found.tsx` still holds | status, body and headers of an unmatched path and of an unknown slug |
| `trailingSlash: false`, "no `cleanUrls` key needed" | `/verk/` 308, `/verk.html` 404, measured on Vercel | the same answers from `next start` (5.1) | the same three requests |
| Redirects planned for cutover | only possible in `vercel.json` or bulk redirects: the export has no `redirects()` | `redirects()` in `next.config` becomes available as a second place. The trailing-slash 308 is now issued by Next.js | hop count for a legacy URL that ends in `/`; that `/thjonusta#…` targets keep the fragment |
| The contact form sends nothing | no request at all; "under `output: "export"` there are no Next route handlers at request time" | the form's markup is byte-identical, so it still sends nothing. The reason stated for not wiring it no longer holds: a route handler or a server action is now possible | nothing until it is wired |
| "64 URLs in the sitemap" | counted from `src/content` at build | unchanged here (64, scratch routes excluded). `sitemap.ts` is `force-static`: an entry published after the build would not be in it | none for the probe |
| "`out/` contains 66 HTML files", "exactly one `<h1>` per page, verified by counting in `out/`", `grep … src out`, `cd out && python3 -m http.server` | checks read `out/` | `out/` is gone. The same HTML is in `.next/server/app/**/*.html` (66 files, section 3) or comes from `next start` | none |
| "Fully static, no server runtime" | no functions | route handlers, ISR and the image endpoint are a server surface (section 13, audit) | function count, size and logs of a preview deployment |
| "Five runtime dependencies" | 5 | 7 direct, 46 more packages installed | none |
| `next/image` is "a layout helper, not a transformer" | true | still true while `unoptimized: true` stays; section 10 otherwise | section 10's list on Vercel's optimiser |
| Image dimensions read from `public/` at build | runs only at build | would also run whenever a project or news page is regenerated at request time, which starts once such a page reads the CMS; see the trace finding in section 13 | that a regenerated project or news page can read `public/` inside its function |

Also for Vercel, with no local equivalent: that the project has no Output Directory override
pointing at `out`; that the two public variables exist for Preview builds too, or preview builds
fail (runbook `operations.md` §2 step 11b sets them for `production` only); that the webhook target
is a host deployment protection leaves public; how long a tag invalidation takes to reach every
edge; whether the data cache and the prerendered pages survive a new deployment; cold-start time of
the first request for a page rendered on demand; and what the functions and the optimiser cost,
since the site has none of either today.

## 13. Other findings

**The dynamic routes trace all of `public/`.** `.next/server/app/verk/[slug]/page.js.nft.json` lists
358 files, 240 of them under `public/`: every file there, 125,451,994 bytes. The news route's trace
lists the same 240. These are the two routes whose components import `image-dimensions.ts`, which
reads `path.join(process.cwd(), "public", publicPath)` with a path known only at run time. No other
route traces a file under `public/`. Under the export no function exists, so this has never
mattered; on a server build the trace decides what is packed with those routes' functions. Not
checked on Vercel.

**`npm audit`.** It reports 6 findings (1 moderate, 4 high, 1 critical), the same six on `main`
before the SDK: none comes from the vendored packages. They are `next` (range up to 16.4.0, fix
16.4.6), `sharp`, `postcss`, `nanoid`, `source-map-js` and `baseline-browser-mapping`. The `next`
entry groups 33 advisories for versions from 16.0.0 (5 critical, 13 high, 12 moderate, 3 low),
several of them about the things this probe turns on: five on the Image Optimization API (two
denial of service, one request forgery, and two rated critical for remote code execution with AVIF
or SVG input), cache poisoning of SSG and ISR pages, and denial of service through Server
Components. This is the registry's advisory data as returned on 2026-11-12; whether each applies on
Vercel, or to this site's configuration, was not assessed. A static export exposes none of this at
request time.

**Draft mode affects every page.** With the preview cookies set, an existing page (`/verk`) is
rendered per request and served `private, no-cache, no-store`.

**The preview route** was cheap and is in: `ƒ /api/cms/preview`, the reference route unchanged.
Checked against a loopback stand-in for the CMS preview endpoint:

```
valid token, path=/cms-probe      -> 307, location: /cms-probe, cache-control: private, no-store,
                                     set-cookie: cms-preview=…; Max-Age=300; HttpOnly; SameSite=lax
                                     set-cookie: __prerender_bypass=…; Secure; HttpOnly; SameSite=none
token for another tenant          -> 401
token signed with another secret  -> 401
valid token, path=//evil.example  -> 400
no token                          -> 401
scratch page with the cookies     -> 200, private, no-cache, no-store; shows the draft title;
                                     stand-in logged GET /api/preview/demo [bearer]
scratch page without the cookies  -> the published release, from the cache, no request
```

Not checked against the real CMS. That needs the site registered with a preview URL and a preview
secret (runbook `operations.md` §2 step 11d), `CMS_PREVIEW_BASE_URL`, and a module whose entries
have a `site.path`.

## 14. Not checked

- Anything on Vercel: section 12's last column and the list under its table.
- Anything in a browser. All checks are `curl` and scripts over the served HTML.
- The hourly revalidation with the delivery host down (section 9).
- The real CMS: no publish, no webhook from the worker, no live check, no preview token minted by
  the CMS. The webhook requests were signed locally with the SDK's helper and a test secret.
- A bundle of the client's real size and shape. Only the `demo` tenant's 5,842-byte bundle and
  padded copies of it.
- Whether Next.js 16.4 serves the same empty-body 404 for `notFound()` (section 6). The probe ran
  on 16.2.4 only.

## 15. Rerunning it

The clone is at
`/private/tmp/claude-501/-Users-einarzoega--claude-spares-spare-9XMWmj/56627df8-9791-44e5-adbe-050bfcaf3d9b/scratchpad/dld-site-probe`,
on `probe/no-export`, with its `origin` remote removed. It is in a temporary folder and will not
survive a cleanup of it. Scripts, logs and the export baseline are in its `.probe/` folder, which
git ignores through `.git/info/exclude`.

```sh
cd <clone>
npm ci                                 # only if node_modules is gone

# Build by hand. The two variables are public.
CMS_DELIVERY_BASE_URL=https://<project-ref>.supabase.co/storage/v1/object/public/delivery \
CMS_TENANT=demo npm run build

# Each of these rebuilds, starts `next start` on 127.0.0.1:3210, runs its checks and stops.
sh .probe/run-checks.sh real           # hosted public bucket: 64 routes + 404 against the export,
                                       # edge URLs, markers, revalidation 200 and 401
EXPORT_OUT=<site repo>/out sh .probe/run-checks.sh real   # the same, against the site's own out/
sh .probe/run-checks.sh mirror         # loopback copy: pointer flip, revalidation, preview
sh .probe/run-checks.sh slugs          # a release that adds one slug and drops another
sh .probe/run-checks.sh outage         # delivery host stopped after a webhook
sh .probe/run-checks.sh big 1600000    # bundle padded past the cache limit
```

`<project-ref>` is the production project named in this repository's `CLAUDE.md`. The script holds
the full URL. The `mirror`, `slugs`, `outage` and `big` modes also use port 3299 on loopback. The
image experiment is `git checkout probe/images-on`, then a build with
`CMS_MEDIA_HOST=<project-ref>.supabase.co` added, `next start`, and
`node .probe/img-facts.mjs http://127.0.0.1:3210 /verk` or
`node .probe/img-weight.mjs http://127.0.0.1:3210 /verk`. The layout experiment is
`git checkout probe/layout-marker`. Logs of the runs reported here are in `.probe/logs/`.
