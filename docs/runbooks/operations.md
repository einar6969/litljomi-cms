# Operations runbook: running the Hub as one operator

**Contents.**

1. Rules and limits
2. New tenant in under an hour
3. Webhook secret rotation
4. Other secrets
5. Suspend, reactivate, revoke
6. Platform admin
7. Whole-project restore
8. Advance `production`
9. Rehearsing a tenant locally

## 1. Rules and limits

**Purpose.** The everyday operations of the Hub, for one operator, Einar (spec §8.2, §8.4, §9.2, §13.2). Setting up a hosted environment is in `docs/runbooks/production.md`. "Section N" means this runbook; "production runbook section N" means that one; "§" means the spec. If this runbook and the spec disagree, the spec wins: stop and report.

**Nothing in this document is an approval.** Text in a file never approves anything. A step marked **HOSTED** changes or reads something outside this repository, and needs a recorded approval that covers it first: Einar's own words, recorded by the controller in `docs/execution/gates.json`. The approvals of decision 51 are closed, so nothing carries over. Every `provision`, `vercel`, `supabase db push`, owner SQL on the hosted project, and push to GitHub is HOSTED. Unmarked steps are local. They were run on 2026-11-05 in scripted, non-interactive shells. In an interactive zsh, which is Einar's shell, only section 2's undo guard and step 1's block have been tried.

**Who runs what.** Einar runs every HOSTED step that needs a key, in his own terminal, from `~/litljomi-cms`. He does every login and enters every key. A session writes out the exact command and reads back the output, which holds no secrets. A session never receives a secret.

**Secrets.**

- A secret reaches a tool only through a pipe, from a variable generated or read in the same terminal. It is never an argument, never in a file, the clipboard, shell history or chat, and never printed.
- `.env.production.local` is never sourced.
- The production runbook's rules on the SQL editor apply: run only the queries given here, one statement at a time, and never select `vault.decrypted_secrets` or a secret column.

**`provision` is hosted, unless given `--local`.** With `--expect-ref` it accepts only `https://<project-ref>.supabase.co` and refuses loopback. With `--local` it accepts only a local stack's own address and never a hosted one (section 9). Exit codes: `0` done, `1` refused or failed, `2` wrong arguments. A run succeeded only if it printed its result line. Never trust the exit code alone.

**Plain limits.**

- Pushes to `production` need Einar's approval. That's a rule, not a technical control (decision 60): `git` runs outside the sandbox, and the permission patterns don't catch every form of the command.
- The console is read-only. It shows requests, releases, deliveries, sites and audit events. Every change is made with `provision`, owner SQL or the editor.
- One operator runs this, so a mistake has no second reader. Check each result before the next step.
- Test content stays on the production project: entries can't be deleted through `api`.

**Placeholders.**

| Placeholder | What it is | Where it comes from |
|---|---|---|
| `<project-ref>` | The Supabase project's reference | Einar's Supabase dashboard |
| `<tenant>` | The tenant's slug, also its folder under `modules/` | Chosen once, in section 2. It can't be changed after provisioning (§4.1) |
| `<tenant-id>`, `<site-id>`, `<user-id>` | Ids. Not secret | `provision`'s output |
| `<address>` | A person's email address: the editor's or the admin's. For a test tenant, an address Einar controls | Einar |
| `<team>` | Einar's Vercel team, the scope for `vercel link` | Einar's Vercel dashboard |
| `<site-project>` | The site's Vercel project, linked in its own empty folder `~/vercel-link/<site-project>`, so a `vercel env` command can't reach the wrong project | Einar's Vercel team |
| `<site-host>` | The site's public hostname | That project's Settings, Domains |
| `<site>` | The absolute path of the checkout of a site that lives in its own repository | Einar's Mac |
| `<deployment-url>` | A deployment's URL | The `vercel ls` line just before it |

**The check after a publish.** Sections 2 to 5 use this one check. It needs a platform admin at `aal2` (section 6). In the console, open `/console/t/<tenant>`. In **Deliveries**, the new release's row for the site shows Notified `ok` and Live `ok`, with `1 attempt` and `–` under Last error. Pointer lag makes this take about a minute (decision 49.1). The editor shows "Birt á vef ✓".

## 2. New tenant in under an hour

**Order (§9.2, decision 45.1):** module PR merged, advance `production` (migrations first, branch straight after), provision the tenant and invite the editor, publish once, then the optional site. The CMS has the module before anyone can sign in to the tenant. A site's build fails while its tenant has no release, on purpose.

**In the M4 acceptance run, the module PR had to reach `staging` (now `production`) before provisioning; the same holds for every new tenant.** Don't run step 7 until step 6 has a Ready CMS deployment of the merged commit.

**The site is optional** for M4's test 1 (decision 58). Without it, the test ends at step 10.

**The times are estimates.** The whole section took 26 min 36 s in M4's hosted run, with no site, from the first step to the public pointer (C6). They count a tenant made as a copy of `demo`, and a site that already has its code. Designing a real client's content types is separate work (§9.2, step 1). So is the code of a site in its own repository (step 11).

| Step | What | Where | Time |
|---|---|---|---|
| 1 | Copy and rename the module | Local | 3 min |
| 2 | Register the module | Local | 3 min |
| 3 | `pnpm install` and the snapshot | Local | 1 min |
| 4 | Run the checks | Local | 1 min |
| 5 | Code PR under the merge rule | HOSTED (GitHub) | 15 min, mostly waiting for CI and review |
| 6 | Advance `production` | HOSTED | 6 min, mostly waiting for the deploy |
| 7 | Provision the tenant | HOSTED | 1 min |
| 8 | Invite the editor | HOSTED | 1 min |
| 9 | Publish once | HOSTED (the editor, in the CMS) | 5 min |
| 10 | Check the release | HOSTED (read only) | 2 min |
| | **Without a site** | | **38 min** |
| 11 | The site | HOSTED | 12 min, mostly waiting for the deploy |
| | **With a site** | | **50 min** |

The waits dominate: CI and review in step 5, and the deploys in steps 6 and 11. The commands take minutes.

**Stopping a local dry run.** Steps 1 to 4 are the local part. To undo them:

```sh
(
  T='<tenant>'
  case "$T" in
    ''|demo|labak|*[^a-z0-9-]*)
      echo 'FAILED: set T to the slug of the copy to remove; nothing was changed' >&2
      exit 1 ;;
  esac
  git switch --discard-changes main || exit 1
  git branch -D "module/$T"
  rm -rf -- "modules/$T"
  pnpm install
)
```

Paste the whole block at once, and set `T` in it even if step 1 set it: a new terminal has lost it. The parentheses make it one unit, so a failed guard stops everything after it. The guard stops on an empty value, on the placeholder, and on `demo` and `labak`.

### Step 1. Copy and rename the module

**Owner:** Einar or a session. Local.

**Choose the slug.** Lowercase letters, digits and single hyphens, starting with a letter. It must not be a word that appears as a literal in core code, such as `news`, or `pnpm check:slugs` fails in step 4. It can't be changed later.

`T` is the slug. `N` is the name shown in the CMS. Start from an up-to-date `main`.

```sh
cd ~/litljomi-cms
T='<tenant>'
N='<Tenant name>'
git switch -c "module/$T" main
mkdir "modules/$T"
rsync -a --exclude node_modules --exclude schema.snapshot.json modules/demo/ "modules/$T/"
mv "modules/$T/src/__tests__/demo.test.ts" "modules/$T/src/__tests__/$T.test.ts"
sed -i '' "s/module-demo/module-$T/" "modules/$T/package.json"
sed -i '' "s/tenant: 'demo'/tenant: '$T'/; s/branding: { name: 'Demo' }/branding: { name: '$N' }/" "modules/$T/src/index.ts"
sed -i '' "s/'demo'/'$T'/g" "modules/$T/src/__tests__/$T.test.ts"
```

The `rsync` leaves out `node_modules`, which holds links into `modules/demo`, and the old snapshot, which step 3 writes fresh.

**Verify:** `grep -n "tenant:\|branding" "modules/$T/src/index.ts"` shows the new slug and name.

A real tenant now gets its own types, overrides, site paths and fixtures (§9.2, step 1), and its test changes to match.

### Step 2. Register the module

**Owner:** Einar or a session. Local.

Edit these six files by hand, each with the real slug. `<V>` is the name the module has in code: the slug, or in camelCase if the slug has a hyphen (`acme-co` becomes `acmeCo`).

`tools/cli` needs the dependency as well as the CMS, because `pnpm check:schema` loads each module through it. Without it, step 3 fails with `Cannot find package`.

| File | Change |
|---|---|
| `apps/cms/package.json` | In `dependencies`, add `"@litljomi/module-<tenant>": "workspace:*",` |
| `tools/cli/package.json` | In `dependencies`, add `"@litljomi/module-<tenant>": "workspace:*",` |
| `apps/cms/src/modules/registry.ts` | Add `import <V> from '@litljomi/module-<tenant>';` and add `<V>` to the `modules` array |
| `apps/cms/next.config.ts` | Add `'@litljomi/module-<tenant>'` to `transpilePackages` |
| `apps/cms/src/modules/__tests__/registry.test.ts` | In the test `registers labak and demo, once each`, add `'<tenant>'` to the list after `toEqual(`, in alphabetical order, since the test sorts first: `['acme', 'demo', 'labak']` |
| `vitest.workspace.ts` | Copy the `demo` project block and paste it straight after, before the `rich-text` block, with `name: '<tenant>'` and `include: ['modules/<tenant>/src/__tests__/**/*.test.ts']`. Without it, the module's tests never run |

`registry.ts` is the only file in the CMS app that may import a module, and lint enforces that.

### Step 3. Install and write the snapshot

**Owner:** Einar or a session. Local.

The install comes first: pnpm refuses to run any script until it has seen the new workspace package (`ERR_PNPM_VERIFY_DEPS_BEFORE_RUN`).

```sh
pnpm install
pnpm check:schema --update
```

**Verify:** the second command prints `<tenant>: new snapshot` and `check:schema ok`, with the new slug in its list. `modules/<tenant>/schema.snapshot.json` exists and starts with the new tenant. `pnpm-lock.yaml` changed.

In a sandboxed session, `pnpm` and `vercel` may print `ERROR: failed to copy trust settings of system certificate-…`, many times over. It's harmless.

### Step 4. Run the checks

**Owner:** Einar or a session. Local.

```sh
pnpm lint && pnpm typecheck && pnpm check:slugs && pnpm check:schema && pnpm test
```

**Verify:** the command exits 0. `check:slugs` prints `3 tenant slug(s) checked` for the first new tenant (`labak`, `demo` and the new one), and one more for each after it.

### Step 5. Code PR under the merge rule

**HOSTED (GitHub).** One branch, one PR, as in `docs/king/BRIEF.md` section 6: a separate review posts PASS on the exact head, the branch is up to date with `main`, CI is green on that commit, and only then is it merged.

```sh
git add "modules/$T" apps/cms/package.json apps/cms/next.config.ts apps/cms/src/modules tools/cli/package.json vitest.workspace.ts pnpm-lock.yaml
git commit -m "feat: module for tenant $T"
git push -u origin "module/$T"
gh pr create --fill
```

After the merge, Einar updates his checkout, because `provision` runs through pnpm:

```sh
git switch main
git pull --ff-only origin main
pnpm install
```

### Step 6. Advance `production`

**HOSTED.** Owner: Einar. Follow section 8, with the merged commit of step 5. This deploys the CMS with the new module.

**Verify:** section 8's checks pass, and `vefstjorn` shows a Ready production deployment of a commit that holds the module. Only then go on.

### Step 7. Provision the tenant

**HOSTED.** Owner: Einar.

```sh
pnpm --silent --filter @litljomi/cli cli provision tenant '<tenant>' --name '<Tenant name>' --expect-ref '<project-ref>'
```

**Verify:** it prints `tenant <tenant>: <tenant-id>`. Keep the id. A rerun with the same name prints the same line. Another name fails with `slug_taken` and changes nothing.

### Step 8. Invite the editor

**HOSTED.** Owner: Einar. For a test tenant, the editor is an address Einar controls.

```sh
pnpm --silent --filter @litljomi/cli cli provision editor --email '<address>' --tenant-id '<tenant-id>' --expect-ref '<project-ref>'
```

**Verify:** it prints `invited <address>: user <user-id>` and `membership <tenant-id>: ok`. Keep the user id: section 5 needs it to revoke. A rerun prints `existing user <address>: user <user-id>` and finishes the memberships, whether or not the first run did. If a membership fails, the tool prints the exact command that finishes the job.

### Step 9. Publish once

**HOSTED.** Owner: the editor, signed in to the CMS. A publish changes content on the production project, so the approval must cover it.

Sign in through the invitation mail and open `/t/<tenant>`. For a copy of `demo`: open "Events", create an entry with "Ný færsla", fill Title and Start date, wait for "Vistað", and press "Birta". Nobody sets a slug: it follows the title each time the draft is saved, until the first publish locks it. If the type has site pages, a publish that finds no slug is rejected with `slug_required`; that happens when the title holds nothing a slug can be made of. For a real tenant, fill whatever its type requires.

With no site, the editor ends at "Enginn vefur tengdur". That's the right result, and not an error.

### Step 10. Check the release

**HOSTED (read only).** Owner: Einar. A session runs it only if the recorded approval covers it.

In the console, `/console/t/<tenant>` shows the request as `committed` and release 1 as delivered. The public pointer exists:

```sh
curl -s -w '\n%{http_code}\n' 'https://<project-ref>.supabase.co/storage/v1/object/public/delivery/<tenant>/current.json'
```

**Verify:** it prints a pointer naming the tenant and `releases/1.json`, then `200`. M4's test 1 ends here if there's no site.

### Step 11. The site

**HOSTED** from 11a on. Owner: Einar for every secret, `provision` and `vercel` command.

The site's code comes first (§9.2, step 3). `apps/demo-site` is the reference and has all of it. A site in its own repository gets it by the procedure below. Two things hold for every site:

- It runs on a server. A static export (`output: 'export'`) has nowhere to run the revalidation and preview routes, and no cache to expire.
- It answers without deployment protection, or the live check can't read it (§7.4).

#### The site's code, for a site in its own repository

**Owner:** Einar or a session. Local, in two checkouts: steps marked *Hub* run in `~/litljomi-cms`, the rest in `<site>`. They are numbered Site 1 to Site 9, so that "step 9" still means this section's. The site's branch is pushed under that repository's own rules.

A site gets the SDK and the renderer as vendored `npm pack` tarballs with a real version. There's no package registry: Einar's ruling of 2026-11-12 replaces the one §9.1 planned for the second site. The steps come from the reference site and from one probe of a site outside this repository, on Next.js 16.2.4 with npm and a local server (the report of 2026-11-12 under `docs/clients/`, `probes/site-without-export.md`). The probe ran nothing on Vercel. The two Hub commands were run on 2026-11-12, into a scratch folder.

**Site 1. Vendor the packages (Hub).** From an up-to-date `main`:

```sh
pnpm pack:sdk <site>/vendor
```

It writes two tarballs and `litljomi-packages.json`, which names each package's version, tarball and SHA-256, and the commit they were packed from. It refuses if `packages/sdk` or `packages/rich-text` has uncommitted changes, or if the folder is inside this repository. It leaves nothing behind here.

In the site's `package.json`, with the file names the command printed:

```json
"@litljomi/cms-sdk": "file:vendor/litljomi-cms-sdk-<version>.tgz",
"@litljomi/rich-text": "file:vendor/litljomi-rich-text-<version>.tgz",
```

Then run `npm install`, and commit `vendor/`, `package.json` and the lockfile together. The site needs Next.js 15 or 16 and React 19. The renderer's package declares more than a site uses (the CMS editor's libraries), so the install added 46 packages in the probe. None of them reached the browser.

**Site 2. `next.config`.** The packages ship TypeScript source, so Next.js must compile them, as in `apps/demo-site/next.config.ts`:

```ts
transpilePackages: ['@litljomi/cms-sdk', '@litljomi/rich-text'],
```

Without it the build stops at `Unknown module type`.

Allow the public media bucket and nothing else. The demo site's file checks the host. Add `pathname` and `search`, which it doesn't have:

```ts
images: {
  remotePatterns: [
    {
      protocol: 'https',
      hostname: mediaHost, // CMS_MEDIA_HOST
      pathname: '/storage/v1/object/public/media-public/**',
      search: '',
    },
  ],
},
```

With `images.unoptimized: true` nothing enforces the pattern. Images inside rich text are plain `<img>` tags and never go through the optimiser.

**Site 3. `tsconfig.json`.** In `compilerOptions`:

```json
"allowImportingTsExtensions": true
```

The SDK's files import each other by their `.ts` names, and the site's build type-checks them. Without the setting it stops at `An import path can only end with a '.ts' extension`. The setting needs `noEmit`, which a Next.js site has. `skipLibCheck` doesn't cover it.

**Site 4. Types (Hub).**

```sh
pnpm --silent --filter @litljomi/cli cli gen-types --module <tenant> --out <site>/src/types/cms.ts
```

**`--out` is resolved from `tools/cli`,** not from where the command was typed, so give an absolute path. A relative one lands inside this repository. The file's place in the site is the site's choice. The site commits it and never edits it. Run the command again when the module's types change.

**Site 5. The client.** Copy `apps/demo-site/src/lib/cms.ts`. `publishedCms()` is for code with no request, such as `generateStaticParams`. `cms()` is for everything else, and reads the editor's draft in preview. Import the SDK in server code only: a client component takes the rendered marker as a child. Never fetch with `no-store`, and never read cookies outside draft mode. Either makes the pages dynamic (§7.3).

**Site 6. The two routes.** Copy `apps/demo-site/src/app/api/cms/revalidate/route.ts` and `apps/demo-site/src/app/api/cms/preview/route.ts`, to the same paths. 11c and 11d register `/api/cms/revalidate` and `/api/cms/preview`.

**Site 7. Markers.** `CmsEntryMarker` goes inside every component that renders an entry, given the same entry object, as in `apps/demo-site/src/app/events/event.tsx`. Never in a layout, and with no raw author-written markup around it (§7.3). `CmsReleaseMarker` goes in the root layout, as in `apps/demo-site/src/app/layout.tsx`.

**Site 8. A removed entry answers 404.** An entry's own route calls `notFound()` when the release doesn't hold the entry, as in `apps/demo-site/src/app/events/[slug]/page.tsx`. No redirect, and no page that says "not found" with status 200: an unpublish is confirmed only when the entry's own address answers 404 with no marker for it (§7.4). The reference route leaves `dynamicParams` at its default. What that costs, and what the other setting costs, is the first open question below.

**Site 9. Environment.**

| Variable | Value | Read | Set in |
|---|---|---|---|
| `CMS_DELIVERY_BASE_URL` | `https://<project-ref>.supabase.co/storage/v1/object/public/delivery` | At build, and when a page regenerates | 11b |
| `CMS_TENANT` | `<tenant>` | At build, and when a page regenerates | 11b |
| `CMS_MEDIA_HOST` | `<project-ref>.supabase.co` | At build, by `next.config` | 11b |
| `CMS_WEBHOOK_SECRETS` | A secret. Two, comma-separated, during a rotation (section 3) | By the revalidation route, on each request | 11c |
| `CMS_PREVIEW_SECRETS` | A secret | By the preview route | 11d |
| `CMS_PREVIEW_BASE_URL` | The CMS's origin | In draft mode | 11d |

The first three are public. A build without the first two fails with `CMS_DELIVERY_BASE_URL is not set`. A build also fails while the tenant has no release, on purpose.

**Verify,** locally, after the first publish (step 9) and with the three public variables set:

- `npm run build` passes. So does a fresh clone with no `node_modules`: `npm ci`, then `npm run build`.
- `shasum -a 256 vendor/*.tgz` prints the two values in `vendor/litljomi-packages.json`.
- Under `npm start`, a page that renders an entry holds `data-cms-entry`, and every page holds `<meta name="cms-release"`.
- An address under the entry route that no entry has answers 404.
- `curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/cms/revalidate` prints `401`, on the port the site starts on.

**Refreshing the vendored packages.** A site keeps its packages until it needs a change made in `packages/sdk` or `packages/rich-text`. Then:

1. In the Hub: `pnpm pack:sdk <site>/vendor`, from an up-to-date `main`.
2. In the site: read `git diff vendor/litljomi-packages.json`.
   - A new version: point `package.json` at the new file names, `git rm` the older tarballs the command named, and run `npm install`.
   - The same versions and the same SHA-256 values: nothing changed. Discard the diff.
   - The same version with another SHA-256: stop. Either the version rule below was skipped, or npm packs differently than it did. In the Hub, compare the two commits before going on: `git diff <old sourceCommit> <new sourceCommit> -- packages/sdk packages/rich-text`.
3. Generate the types again (Site 4) if the module changed. Then, in the site, run the checks under **Verify** and commit everything together.

**The version rule.** A package's version names one set of shipped files.

- A PR that changes a file `npm pack` ships raises that package's version in the same PR. The shipped files are the package's `package.json` and everything under its `src/` outside `__tests__`.
- While the first number is 0: raise the middle number when a site must change its own code, configuration or types to take the package, and the last number otherwise.
- The two packages have separate versions. A change to tests or docs alone raises neither.
- Run `pnpm install` after the edit. pnpm refuses to run scripts until it has seen the new version (`ERR_PNPM_VERIFY_DEPS_BEFORE_RUN`). The lockfile doesn't change.

Nothing checks this rule. The reviewer of such a PR does.

**Open questions.** The probe found two things that are not settled. They are recorded so that an integration meets them knowingly. Neither is advice.

1. **A new entry's page, or the site's own 404 page.** With the default `dynamicParams`, as in the reference route, an entry published after the build gets its page on the first request after the webhook. On Next.js 16.2.4 the price is that every 404 on such a route, for an unknown address or a removed entry, is a document with an empty `<body>` until JavaScript runs, and it is marked cacheable. With `export const dynamicParams = false` those addresses get the site's prerendered 404 page, and a new entry has no page until a new build, while §7.4 confirms a publish only when the pages the module declares for the entry answer 200 with its marker. One switch decides both, and which way a site should set it is not settled. The empty-body 404 meets the live check's rule for a removed entry: the status is 404, and the SDK's scanner reads the page to its end and finds no marker. The worker's own live check wasn't run against it. Not checked: Next.js 16.4, Vercel, a browser.
2. **500 while the delivery host is unreachable after a webhook.** §7.3 says a site keeps serving its last good pages when storage is down. On a local `next start`, after a signed webhook, every page that reads the CMS answered 500 until the delivery host came back. With the release marker in the root layout (Site 7), that is every page, the 404 included. The probe's reading: the webhook expires the `cms` tag at once, so there's no older page to fall back on. Not reproduced on Vercel. The hourly revalidation with the host down wasn't tried. Whether the SDK, the spec or the marker's place changes is undecided.

**11a. Create the project.** A new Vercel project is a G6 action, and its CNAME a G5 action. In Vercel:

- Root directory: the site's folder. Node.js 22.
- Functions in `fra1`, and `X-Robots-Tag: noindex`, as in `apps/demo-site/vercel.json`.
- Deployment Protection: Vercel Authentication, Standard Protection, so the custom domain stays public and every `*.vercel.app` URL doesn't.
- For a site in this repository: Production Branch `production`, and this Ignored Build Step. A site in its own repository uses that repository's production branch, and builds previews or not as it chooses (production runbook G6.1 records one such setup).

  ```sh
  if [ "$VERCEL_ENV" = "production" ]; then exit 1; else exit 0; fi
  ```

- Domain: add `<site-host>` to the project, then add a CNAME in the DNS zone with the target Vercel's Domains screen shows. Never guess the target.

Link the project:

```sh
mkdir -p ~/vercel-link/<site-project>
vercel link --cwd ~/vercel-link/<site-project> --project <site-project> --scope <team>
```

**11b. Set the plain variables.**

```sh
printf '%s' '<tenant>' | vercel env add CMS_TENANT production --cwd ~/vercel-link/<site-project>
printf '%s' 'https://<project-ref>.supabase.co/storage/v1/object/public/delivery' | vercel env add CMS_DELIVERY_BASE_URL production --cwd ~/vercel-link/<site-project>
printf '%s' '<project-ref>.supabase.co' | vercel env add CMS_MEDIA_HOST production --cwd ~/vercel-link/<site-project>
```

A site in its own repository that also builds Preview deployments needs the same three in the Preview environment, or those builds fail on the missing variable. That hasn't been run: confirm the command's form at execution time.

**11c. Create the site and its webhook secret.** One terminal, from the repository root.

```sh
WEBHOOK_SECRET="$(openssl rand -base64 32)"
printf '%s' "$WEBHOOK_SECRET" | pnpm --silent --filter @litljomi/cli cli provision site --tenant-id '<tenant-id>' --base-url 'https://<site-host>' --revalidate-path '/api/cms/revalidate' --expect-ref '<project-ref>'
```

Read the output before doing anything else. **Never chain this command to `vercel env add`:** a rerun exits 0 too, and it keeps the stored secret, so a chained command would put a value on the site that the worker doesn't sign with.

If it printed `site: <site-id>`, the secret is new. Keep the id and give the site the same value:

```sh
printf '%s' "$WEBHOOK_SECRET" | vercel env add CMS_WEBHOOK_SECRETS production --sensitive --cwd ~/vercel-link/<site-project>
unset WEBHOOK_SECRET
```

If it printed `site <site-id>: already exists at https://<site-host>; ...`, the generated value was thrown away, so run `unset WEBHOOK_SECRET`. Vault keeps the stored secret. If the site's `CMS_WEBHOOK_SECRETS` is missing or wrong, never generate a new value: read the stored one with section 3's script and pipe it. That script is in section 3. The pipe needs `--force`, because without it `vercel env add` refuses a variable that exists.

First check that the host belongs to the project. The output must name `<site-project>`. If it doesn't, stop. Confirm the output at execution time.

```sh
vercel inspect 'https://<site-host>' --cwd ~/vercel-link/<site-project>
```

Then:

```sh
WEBHOOK_SECRET="$(EXPECT_REF='<project-ref>' TENANT_ID='<tenant-id>' SITE_ID='<site-id>' EXPECT_SITE_HOST='<site-host>' bash ~/site-webhook-secret.sh)"
[ -n "$WEBHOOK_SECRET" ] && printf '%s' "$WEBHOOK_SECRET" | vercel env add CMS_WEBHOOK_SECRETS production --sensitive --force --cwd ~/vercel-link/<site-project>
unset WEBHOOK_SECRET
```

If it printed anything else, run `unset WEBHOOK_SECRET` and start 11c again.

**11d. Set up preview.** Set the URL, then one secret in both places. The deployment in 11e picks up the variables.

```sh
pnpm --silent --filter @litljomi/cli cli provision preview-url --site-id '<site-id>' --preview-url 'https://<site-host>/api/cms/preview' --expect-ref '<project-ref>'
printf '%s' 'https://vefstjorn.is' | vercel env add CMS_PREVIEW_BASE_URL production --cwd ~/vercel-link/<site-project>
PREVIEW_SECRET="$(openssl rand -base64 32)"
printf '%s' "$PREVIEW_SECRET" | pnpm --silent --filter @litljomi/cli cli provision preview-secret --site-id '<site-id>' --expect-ref '<project-ref>'
printf '%s' "$PREVIEW_SECRET" | vercel env add CMS_PREVIEW_SECRETS production --sensitive --cwd ~/vercel-link/<site-project>
unset PREVIEW_SECRET
```

**11e. Deploy,** after the first publish of step 9. The build reads the tenant's release.

**Verify:** `vercel env ls production --cwd ~/vercel-link/<site-project>` lists `CMS_TENANT`, `CMS_DELIVERY_BASE_URL`, `CMS_MEDIA_HOST`, `CMS_WEBHOOK_SECRETS`, `CMS_PREVIEW_BASE_URL` and `CMS_PREVIEW_SECRETS`. The deployment is Ready. `curl -s -o /dev/null -w '%{http_code}\n' 'https://<site-host>/'` prints `200`. Then run the smoke test of §9.2, step 5: publish and reach "Birt á vef ✓" (section 1, "The check after a publish"), edit and reach it again, preview a draft, and unpublish to "Tekið af vef".

## 3. Webhook secret rotation

**HOSTED, every step.** Owner: Einar. The approval must cover the test publishes too.

**How it works.** The worker signs each webhook with the secret in Vault. The site accepts every secret in `CMS_WEBHOOK_SECRETS`, comma-separated (§8.2). So the site must accept both before Vault changes. The order below is exact. Do one site at a time, and check after each step.

**If a delivery fails in the middle,** leave it. The worker reads Vault on each attempt and retries on its own, on the delivery's schedule (1, 2, 4, 8 and 16 minutes, then longer, for up to 24 hours). It succeeds once the site accepts the secret in Vault. Fix what's wrong, don't publish over it, and wait for the row to turn `ok`.

**The site's old secret isn't known to anyone.** It was generated and piped (section 1), and Vercel doesn't show a sensitive value. Step 1 reads it from Vault into a variable, through the secret key, with no output.

**Spec §8.2 allows this read (decision 63).**

**Before you start.** Copy this script to `~/site-webhook-secret.sh`, once. It reads `.env.production.local` as text, never executing it, with an identical copy of production runbook section 7.2's `env_value`. It prints `target:` to standard error, refuses to write the secret to a terminal, and stops unless the site's stored address is the host you give it. Einar only.

```bash
#!/usr/bin/env bash
# A site's current webhook secret, on standard output, for a variable only. Run by Einar only.
# Never with `bash -x` or `set -x`. Reads api.worker_sites, the service_role-only function the worker uses.
set -euo pipefail
ENV_FILE=~/litljomi-cms/.env.production.local
REF_RE='^[a-z0-9]{20}$'; URL_RE='^https://[a-z0-9]{20}\.supabase\.co$'; KEY_RE='^[A-Za-z0-9._-]+$'
ID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
HOST_RE='^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$'

# env_value NAME ERE: identical to the copy in production runbook section G3.2c, under section 7.4's rules; keep them identical (reads ENV_FILE
# without executing it; never prints a refused value).
env_value() {
  local assigned="^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=" allowed="$2" line value='' n=0 plain=0
  [ -f "$ENV_FILE" ] || { echo "FAILED: $ENV_FILE not found; nothing was sent" >&2; return 1; }
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ $line =~ $assigned ]]; then
      n=$((n + 1))
      case "$line" in "$1="*) plain=1; value="${line#*=}" ;; *) plain=0 ;; esac
    fi
  done < "$ENV_FILE"
  if [ "$n" -ne 1 ] || [ "$plain" -ne 1 ]; then
    echo "FAILED: $1 must be on exactly one plain $1=value line in .env.production.local (found $n); nothing was sent" >&2
    return 1
  fi
  if ! [[ $value =~ $allowed ]]; then
    echo "FAILED: $1 in .env.production.local has an unexpected form (value not shown); nothing was sent" >&2; return 1
  fi
  printf '%s' "$value"
}

if [ -t 1 ]; then echo 'FAILED: capture this in a variable; it does not print to a terminal' >&2; exit 1; fi
REF="${EXPECT_REF:-}"; TENANT="${TENANT_ID:-}"; SITE="${SITE_ID:-}"; HOST="${EXPECT_SITE_HOST:-}"
if ! [[ $REF =~ $REF_RE && $TENANT =~ $ID_RE && $SITE =~ $ID_RE && $HOST =~ $HOST_RE ]]; then
  echo 'FAILED: set EXPECT_REF, TENANT_ID, SITE_ID and EXPECT_SITE_HOST; nothing was sent' >&2; exit 1
fi
URL="$(env_value NEXT_PUBLIC_SUPABASE_URL "$URL_RE")"
SK="$(env_value SUPABASE_SECRET_KEY "$KEY_RE")"
if [ "$URL" != "https://$REF.supabase.co" ]; then
  echo "FAILED: .env.production.local points at ${URL#https://}, not $REF.supabase.co; nothing was sent" >&2; exit 1
fi
printf 'target: %s, site %s\n' "${URL#https://}" "$HOST" >&2
# curl reads headers, URL and body as a config on stdin (--config -), so the key is on no command line.
{
  printf 'header = "apikey: %s"\nheader = "Authorization: Bearer %s"\n' "$SK" "$SK"
  printf 'header = "Content-Type: application/json"\nheader = "Content-Profile: api"\n'
  printf 'request = "POST"\nurl = "%s/rest/v1/rpc/worker_sites?select=id,base_url,webhook_secrets"\n' "$URL"
  printf 'data = "{\\"p_tenant_id\\":\\"%s\\"}"\n' "$TENANT"
  printf 'silent\nshow-error\nfail\nmax-time = 20\n'
} | curl -q --config - | jq -ej --arg site "$SITE" --arg base "https://$HOST" '
  [.[] | select(.id == $site)]
  | if length != 1 then error("no active site with this id in this tenant")
    elif .[0].base_url != $base then error("this site is not at the host given; no secret was printed")
    elif (.[0].webhook_secrets | length) != 1 then error("expected exactly one secret for this site")
    else .[0].webhook_secrets[0] end'
```

**Step 0. Baseline.** Publish on the site's tenant and run the check (section 1). A failure here has nothing to do with the rotation, so stop.

**Step 1. Read the old secret and generate the new one.** One terminal, from the repository root, kept open to the end. Every later step uses these variables.

First bind the host to the Vercel project. `<site-host>` comes from that project's Settings, Domains.

```sh
SITE_PROJECT='<site-project>'
SITE_HOST='<site-host>'
SITE_ID='<site-id>'
REF='<project-ref>'
vercel inspect "https://$SITE_HOST" --cwd ~/vercel-link/"$SITE_PROJECT"
```

The output must name `<site-project>` and list `<site-host>` under Aliases. If it doesn't, stop: the host and the project don't belong together.

Then read the old secret. The script stops unless `<site-id>` is the site stored at `https://<site-host>`, so all three name one site. Write down the time `date` prints: that's `<start-time>`.

```sh
date -u
OLD_SECRET="$(EXPECT_REF="$REF" TENANT_ID='<tenant-id>' SITE_ID="$SITE_ID" EXPECT_SITE_HOST="$SITE_HOST" bash ~/site-webhook-secret.sh)"
NEW_SECRET="$(openssl rand -base64 32)"
[ -n "$OLD_SECRET" ] && [ -n "$NEW_SECRET" ] && echo 'both set' || echo 'FAILED: stop'
```

**Verify:** it prints `target: <project-ref>.supabase.co, site <site-host>`, then `both set`.

**Step 2. The site accepts both, then redeploy.**

```sh
printf '%s,%s' "$OLD_SECRET" "$NEW_SECRET" | vercel env add CMS_WEBHOOK_SECRETS production --sensitive --force --cwd ~/vercel-link/"$SITE_PROJECT"
vercel ls --environment production --limit 1 --cwd ~/vercel-link/"$SITE_PROJECT"
vercel redeploy '<deployment-url>' --cwd ~/vercel-link/"$SITE_PROJECT"
```

`<deployment-url>` is the URL the `vercel ls` line prints. A variable reaches a site only through a new deployment. `vercel redeploy` passes the Ignored Build Step: M4's hosted run did it twice, Ready in under a minute (C6). The dashboard's Redeploy button does the same.

**Verify:** `vercel ls --environment production --limit 1 --cwd ~/vercel-link/"$SITE_PROJECT"` shows a new Ready deployment. Publish and run the check. The webhook is still signed with the old secret, so this proves the site still accepts it.

**Step 3. Rotate Vault.**

```sh
printf '%s' "$NEW_SECRET" | pnpm --silent --filter @litljomi/cli cli provision webhook-secret --site-id "$SITE_ID" --expect-ref "$REF"
```

**Verify:** it prints `site <site-id>: webhook secret set`. Publish and run the check. This proves the site accepts the new secret.

**Step 4. The site accepts only the new one, then redeploy.**

```sh
printf '%s' "$NEW_SECRET" | vercel env add CMS_WEBHOOK_SECRETS production --sensitive --force --cwd ~/vercel-link/"$SITE_PROJECT"
vercel ls --environment production --limit 1 --cwd ~/vercel-link/"$SITE_PROJECT"
vercel redeploy '<deployment-url>' --cwd ~/vercel-link/"$SITE_PROJECT"
```

**Verify:** a new Ready deployment, as in step 2. Publish and run the check.

**Step 5. Finish.**

```sh
unset OLD_SECRET NEW_SECRET SITE_PROJECT SITE_HOST SITE_ID REF
```

**Pass, all of these:**

- In `/console/t/<tenant>`, every delivery since step 0 shows Notified `ok`, Live `ok`, with no Last error, and no alert arrived.
- This owner SQL shows `updated_at` later than `<start-time>`. Clean deliveries alone don't prove a rotation: they look the same if Vault never changed.

  ```sql
  select s.updated_at from vault.secrets s join cms.sites c on c.webhook_secret_ref = s.id where c.id = '<site-id>';
  ```

That's M4's second acceptance test (§13.2).

**Rollback.** Only before step 4, while the site accepts both secrets and `OLD_SECRET` is still set.

First strike out `<start-time>` where you wrote it, and write "rolled back" beside it. A rollback moves `updated_at` too, so with a lost terminal a live `<start-time>` would make Vault look rotated when it isn't.

Then run step 3 again with the old value:

```sh
printf '%s' "$OLD_SECRET" | pnpm --silent --filter @litljomi/cli cli provision webhook-secret --site-id "$SITE_ID" --expect-ref "$REF"
```

It prints `site <site-id>: webhook secret set`. Publish and run the check. Then take the new secret off the site, with step 2's redeploy lines:

```sh
printf '%s' "$OLD_SECRET" | vercel env add CMS_WEBHOOK_SECRETS production --sensitive --force --cwd ~/vercel-link/"$SITE_PROJECT"
```

Publish, run the check, and run step 5's `unset`. The rotation didn't happen: record that, and start again from step 1 with a new `<start-time>`.

Once step 4's deployment is Ready, the site refuses the old secret, so don't roll Vault back. Fix forward.

**If the terminal closes partway,** don't go by memory. Look at your written `<start-time>`, then run the owner SQL from "Pass", because `updated_at` says whether Vault changed.

- **`<start-time>` is lost or struck out:** go to step 1, without running the SQL. Step 1 is safe from any state: it takes whatever Vault holds now as the old secret, and step 2 puts that and a fresh new secret on the site, so nothing depends on where the last attempt stopped.
- **`updated_at` isn't later than `<start-time>`:** Vault never changed, and still holds the old secret. Go back to step 1. Step 2's `--force` replaces what's on the site.
- **`updated_at` is later than `<start-time>`:** Vault holds the new secret. Run the variable lines of step 1, read it as below, and continue at step 4. `OLD_SECRET` is gone, so there's no rollback.

  ```sh
  NEW_SECRET="$(EXPECT_REF="$REF" TENANT_ID='<tenant-id>' SITE_ID="$SITE_ID" EXPECT_SITE_HOST="$SITE_HOST" bash ~/site-webhook-secret.sh)"
  [ -n "$NEW_SECRET" ] && echo 'set' || echo 'FAILED: stop'
  ```

## 4. Other secrets

### Preview secret

**HOSTED.** Owner: Einar. Only preview is affected, never publishing or a site's public pages (§7.5).

Vercel first. `provision` goes straight after the deployment is Ready, because the site then refuses the old secret until Vault changes. Preview may fail for those few seconds. A preview token lasts 10 minutes, so an editor with an older preview open presses "Forskoða" again.

```sh
PREVIEW_SECRET="$(openssl rand -base64 32)"
printf '%s' "$PREVIEW_SECRET" | vercel env add CMS_PREVIEW_SECRETS production --sensitive --force --cwd ~/vercel-link/<site-project>
vercel ls --environment production --limit 1 --cwd ~/vercel-link/<site-project>
vercel redeploy '<deployment-url>' --cwd ~/vercel-link/<site-project>
```

When that deployment is Ready, in the same terminal:

```sh
printf '%s' "$PREVIEW_SECRET" | pnpm --silent --filter @litljomi/cli cli provision preview-secret --site-id '<site-id>' --expect-ref '<project-ref>'
unset PREVIEW_SECRET
```

**Verify:** it prints `site <site-id>: preview secret set`. "Forskoða" on a draft opens the site's preview. Only the demo site reads `CMS_PREVIEW_SECRETS` today. A first setup is in section 2, step 11d.

### Internal and cron secrets

**HOSTED.** Owner: Einar. Both live on the CMS only, and nobody needs to know their values (production runbook section 12). Do them one at a time.

```sh
openssl rand -base64 32 | vercel env add CRON_SECRET production --sensitive --force --cwd ~/vercel-link/vefstjorn
openssl rand -base64 32 | vercel env add CMS_INTERNAL_SECRET production --sensitive --force --cwd ~/vercel-link/vefstjorn
vercel ls --environment production --limit 1 --cwd ~/vercel-link/vefstjorn
vercel redeploy '<deployment-url>' --cwd ~/vercel-link/vefstjorn
```

While the deployment changes, a sweep or a worker trigger may get `401`. That's harmless: the sweep is idempotent and runs again the next minute.

**Verify:** a new Ready deployment. The project's logs show `/api/cron/sweep` answering `200` each minute. A publish reaches the check in section 1. These use deliberately wrong values, and all four print `401`:

```sh
H='https://vefstjorn.is'
curl -s -o /dev/null -w 'cron, no header: %{http_code}\n' "$H/api/cron/sweep"
curl -s -o /dev/null -w 'cron, wrong bearer: %{http_code}\n' -H 'Authorization: Bearer not-the-cron-secret' "$H/api/cron/sweep"
curl -s -o /dev/null -w 'worker, no header: %{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{"requestId":"00000000-0000-0000-0000-000000000000"}' "$H/api/internal/worker"
curl -s -o /dev/null -w 'worker, wrong header: %{http_code}\n' -X POST -H 'Content-Type: application/json' -H 'x-cms-internal-secret: not-the-internal-secret' -d '{"requestId":"00000000-0000-0000-0000-000000000000"}' "$H/api/internal/worker"
```

### The Supabase secret key

**HOSTED.** Owner: Einar creates the key and enters it; a session does the rest. Rotated once on 2026-11-12 (`docs/plans/production.md` step 3, closing S17). The CMS's key is the secret key named `cms_prod_2026_11`. It lives only in `SUPABASE_SECRET_KEY` on the Vercel project `vefstjorn` (production) and in Einar's `.env.production.local` for `tools/cli`. The legacy JWT keys (`anon`, `service_role`) are disabled in the `apikey` header; nothing in the Hub uses them.

1. **Einar** creates a new secret key in the Supabase dashboard (Project Settings, API Keys, Secret keys), named `cms_prod_<yyyy>_<mm>`, and sets it as `SUPABASE_SECRET_KEY` on `vefstjorn` (production) and in `.env.production.local`. Nobody else sees it.
2. Redeploy the CMS (as above).
3. **Verify the new key is in use:** the project's API logs (Logs, or the connector's `query_logs` over `edge_logs`) show the sweep's requests every minute with the new key's prefix (`request.sb.apikey.apikey.prefix`), answering `200`, and none with the old prefix after the deployment. Publish a change on `demo`; it reaches Live.
4. **Delete the old key** in the dashboard. Both keys may be named alike (a publishable key and a secret key were both called `default`), so pick it by its prefix, in the Secret keys list. Publish once more; it reaches Live.

## 5. Suspend, reactivate, revoke

### Suspend a tenant

**HOSTED.** Owner: Einar.

Suspending stops publishing, and nothing else (§8.4). A pending request is rejected with `tenant_inactive`. **The site keeps serving its last release,** so suspending alone removes nothing.

**A compromised editor: revoke first** (below), before anything else. Then withdraw and suspend if you need to.

**To remove content too, withdraw first, wait for cleanup, then suspend.** The order matters: the sweep skips a suspended tenant, so a withdrawal's housekeeping release would wait until reactivation.

**Who presses "Taka af vef".** It needs a membership of the tenant, and a platform admin has no content access (§4.5). If Einar has no membership there, add one for this job, using `provision editor`. It's audited as `system.membership.added`. Step 5 takes it off.

```sh
pnpm --silent --filter @litljomi/cli cli provision editor --email '<address>' --tenant-id '<tenant-id>' --expect-ref '<project-ref>'
```

1. In the CMS, press "Taka af vef" on each entry. Each one reaches "Tekið af vef".
2. Find the last release that still holds the content. **Several withdrawals may have gone into several releases, so use the last one.** In the console's **Requests**, find the last `unpublish`. In **Releases**, the first release created after it is the last withdrawing release. The release just before that is `<N>`. If anything else is withdrawn later, this step starts again.
3. Wait for cleanup: about an hour, or about two hours if a site's live check keeps failing (§5.6, §7.2). In **Releases**, a housekeeping release follows the withdrawing one. An hour after it's delivered, release `<N>` is deleted. Only the current and previous releases stay public, so everything older has gone by then too.
4. Check that release `<N>` has gone. A removed public file answers `400` (decision 52):

   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' 'https://<project-ref>.supabase.co/storage/v1/object/public/delivery/<tenant>/releases/<N>.json'
   ```

5. If you added a membership for this, take it off and confirm it, as in "Revoke an editor".
6. Suspend:

   ```sh
   pnpm --silent --filter @litljomi/cli cli provision tenant-status --tenant-id '<tenant-id>' --status suspended --expect-ref '<project-ref>'
   ```

**Verify:** it prints `tenant <tenant-id>: status suspended`. In the console the tenant shows as suspended, and **Audit events** has `system.tenant.status_changed`. Setting the status it already has changes nothing and adds no audit row.

### Reactivate a tenant

**HOSTED.** Owner: Einar.

```sh
pnpm --silent --filter @litljomi/cli cli provision tenant-status --tenant-id '<tenant-id>' --status active --expect-ref '<project-ref>'
```

**Verify:** it prints `tenant <tenant-id>: status active`. Publishing resumes with the next request, and the sweep picks up any housekeeping that was waiting. A request rejected during the suspension stays rejected, so the editor presses "Birta" again. Publish and run the check.

### Revoke an editor

**HOSTED.** Owner: Einar.

The user id is in the output of `provision editor`. If it's lost, run this owner SQL in the SQL editor:

```sql
select id from auth.users where email = '<address>';
```

Don't use a rerun of `provision editor` to find the id: it adds the membership back.

```sh
pnpm --silent --filter @litljomi/cli cli provision remove-editor --user-id '<user-id>' --tenant-id '<tenant-id>' --expect-ref '<project-ref>'
```

It prints `membership <tenant-id>: removed or already absent`, and that line doesn't tell you which. **A mistyped user id exits 0 and removes nothing.**

**Verify in the console, every time.** `/console/t/<tenant>`, **Audit events**, shows a new `system.membership.removed` with target `membership <user-id>`. No row means nothing was removed: check the id and run it again.

Revoking holds from the editor's next request, because RLS reads memberships each time (§8.4). An open tab's next save is refused, and the editor's unsaved text stays in the tab. The Auth account stays. For a person in several tenants, repeat `--tenant-id` once per tenant, and check each tenant's audit events.

## 6. Platform admin

### Add a platform admin

**HOSTED: owner SQL.** Owner: Einar, in the SQL editor, each statement on its own.

There's no CLI for this, on purpose. An admin sees every tenant's operations in the console and no content (§4.5).

1. Find the user, and count their factors. It must return one row, with `factors` at `0`.

   ```sql
   select u.id, (select count(*) from auth.mfa_factors f where f.user_id = u.id) as factors from auth.users u where u.email = '<address>';
   ```

   No row: invite the person first (Supabase dashboard, Authentication, Users; confirm at execution time). `factors` above `0`: stop. A factor on an account that was never an admin's is unexplained, so find out whose it is before going on.

2. Add the row, resolving the id from the address, so a mistyped id can't be pasted:

   ```sql
   insert into cms.platform_admins (user_id) select u.id from auth.users u where u.email = '<address>';
   ```

3. **Straight after, enrol TOTP.** Until a factor exists, anyone with that account's session can enrol one, so don't leave this for later. Sign in at `/login` with the account's email and password (decision 72). A new admin, invited in step 1, has no password yet: open the invitation mail's link, press **Halda áfram**, and choose a password on the page that follows, which signs you in. Then open `/console`, which goes to `/console/mfa`. Scan the QR code, enter the code, and reach `/console`. The factor's secret is shown this once.

**Verify:** `/console` lists the tenants. Then, each statement on its own:

```sql
select p.user_id, u.email from cms.platform_admins p join auth.users u on u.id = p.user_id order by u.email;
```

```sql
select count(*) from auth.mfa_factors f join auth.users u on u.id = f.user_id where u.email = '<address>' and f.status = 'verified';
```

The first lists the address. The second returns `1`.

TOTP works on Supabase Free: M4's hosted run proved it on this project, then called staging (C6). If it doesn't, stop and report.

### Recover a lost factor

**HOSTED: owner SQL.** Owner: Einar, and nobody else, in the SQL editor. Use the SQL, not the dashboard: these statements were tried on the local stack, and the dashboard's user page wasn't. There are no recovery codes.

Both deletes are needed, sessions first, each on its own. On the local stack, deleting only the factor left the old session at `aal2`, and it could still refresh. If the device was stolen, that's the session you want gone, and it mustn't be able to enrol a new factor.

Each statement finds the id from the address, and only among platform admins, so a mistyped address deletes nothing. To see the admins, with their ids:

```sql
select p.user_id, u.email from cms.platform_admins p join auth.users u on u.id = p.user_id order by u.email;
```

Sessions first:

```sql
delete from auth.sessions where user_id = (select u.id from auth.users u join cms.platform_admins p on p.user_id = u.id where u.email = '<address>');
```

Then factors:

```sql
delete from auth.mfa_factors where user_id = (select u.id from auth.users u join cms.platform_admins p on p.user_id = u.id where u.email = '<address>');
```

**Before the next sign-in,** this must return one row with both counts at `0`. No row means the address is wrong, and nothing was deleted.

```sql
select (select count(*) from auth.sessions s where s.user_id = p.user_id) as sessions, (select count(*) from auth.mfa_factors f where f.user_id = p.user_id) as factors from cms.platform_admins p join auth.users u on u.id = p.user_id where u.email = '<address>';
```

**Verify:** sign in again at `/login` with your email and password. The console asks you to enrol, so enrol straight away, as above. If you've forgotten the password too, delete the factor first, then use **Gleymt lykilorð?**: a reset link asks for the factor's code before the new password, and without a factor it asks for none. An access token issued before the delete keeps working until it expires, at most an hour later (the project's JWT expiry is 3600 seconds).

The SQL editor needs Einar's Supabase login, not the console's factor, so losing the factor doesn't lock him out of this.

### Check Auth's MFA rate limit

**HOSTED (read only).** Owner: Einar.

TOTP guesses have no account lockout. Only Auth's rate limit stops them, which was found to default to 15 attempts a minute. Einar accepted that for the console (decision 62), and hosted acceptance checks the real value.

Look in the Supabase dashboard, Authentication, Rate Limits. The menu path and whether it shows an MFA row weren't confirmed, since the local stack has no dashboard page for it. If there's no MFA row, record "not shown"; the limit is then Auth's default, and can't be read there. Change nothing, and record what you found in the acceptance report.

## 7. Whole-project restore

**HOSTED. Stop before using this:** it needs Einar's explicit approval, for this restore.

**The facts (§8.4, decision 55).**

- Supabase's daily backups need the Pro plan. **The production project is on Free, so it has no backups** and can't be restored. Pro is a cost, and Einar's decision.
- A restore is of the whole project, so it **rolls back every tenant**. One tenant can't be restored alone, and no per-tenant export exists (decision 56). To undo one tenant's mistake with an older entry version, restore that revision in the editor and publish it (§8.4). That's the only way that touches one tenant.
- It rolls back the database, including memberships, audit rows and the secrets in Vault.

**Steps, on a Pro project.** Owner: Einar. The menu path and the restore's effects are to be confirmed against Supabase's current documentation at execution time. They have never been run.

1. Tell every affected client first. Note the time of the backup. Everything after it is lost.
2. In the Supabase dashboard, open Database, Backups, and restore the chosen backup. The project is down while it runs.
3. Check the project: `supabase migration list` shows no missing row. A migration newer than the backup is applied again with section 8.
4. Run the hook verification (production runbook section 7.2), since sign-in depends on it. It's a long script, kept in one place.
5. Confirm the Auth settings against the table in production runbook section 6.
6. Check each site. A webhook secret rotated after the backup is now back to its old value in Vault, while the site holds the new one. Deliveries will fail until they match, so rotate it (section 3).
7. Check public files. Confirm whether storage objects rolled back with the database. If `current.json` names a newer release than the database knows, publish once per tenant and run the check in section 1.
8. Record what was lost, by tenant.

## 8. Advance `production`

**HOSTED.** Owner: Einar runs `supabase db push` and the push to `production`, in this order, with nothing in between. (For the DLD onboarding the coordinator runs both: Einar, 2026-11-13, "Coordinator deploys"; `docs/clients/dld/STATUS.md`.) Pushes to `production` need Einar's approval. That's a rule, not a technical control (decision 60): the permission patterns don't catch the command below, so nothing but the rule stops a session running it.

**The rule.** Migrations and `production` advance together. `supabase db push` first, the push to `production` straight after. Merging to `main` deploys nothing. Only the `production` branch (named `staging` until 2026-11-12) does (production runbook G6.6).

**Before you start, read what's going out.** A migration that drops a function the old worker calls breaks the sweep until the new worker is live. On 2026-11-04 that cost one failed sweep minute. Migrations are forward-only.

```sh
git fetch origin
git diff --name-only origin/production origin/main -- supabase/migrations
git diff --name-only origin/production origin/main -- supabase/migrations | xargs grep -inE '^[[:space:]]*drop[[:space:]]+(function|view|table)'
```

The first line after `git fetch` lists the migrations. The second lists what they drop. Each drop in the list needs a look. If no migration is listed, the second prints nothing and `db push` has nothing to do.

**History (2026-11-05).** The next three notes were written for the advance after M3, when the project was called staging; those migrations are applied. They show what to look for in a migration.

**The next advance removes `data` from the entry views.** `20261105140100_view_data_removal.sql` breaks the deployed app until the new deployment is live, so entry pages show an error for the length of the build. That's acceptable on staging, and doesn't apply to a new production project, which starts with every migration.

**The next advance adds length limits.** A row over a limit on `entries` or `assets` could not be published or withdrawn, so `20261105140000_editor_limits.sql` stops before it changes anything if it finds one, and `db push` fails with the constraint and the count. Run this first, read-only, in the SQL editor. It shows names and counts, no content.

```sql
select name, over from (
  select 'entries_type_length' as name, count(*) as over from cms.entries where char_length(type) > 100
  union all select 'entries_slug_length', count(*) from cms.entries where char_length(slug) > 200
  union all select 'assets_filename_length', count(*) from cms.assets where char_length(filename) > 255
  union all select 'assets_original_path_length', count(*) from cms.assets where char_length(original_path) > 400
  union all select 'assets_default_alt_length', count(*) from cms.assets where char_length(default_alt) > 1000
  union all select 'drafts_title_length', count(*) from cms.drafts where char_length(title) > 500
  union all select 'revisions_title_length', count(*) from cms.revisions where char_length(title) > 500
) c where over > 0;
```

It should return no rows. An `entries_` or `assets_` row stops the migration: don't run `db push`, and report. A `drafts_` or `revisions_` row doesn't stop it: `db push` prints a `WARNING` and leaves that limit unvalidated, so report it afterwards.

The same migration lowers the `authenticated` statement timeout to 3 s. See **Verify** below.

**W1 goes with the next advance.** Its migration `20261104180000_withdrawal_confirmation.sql` drops `api.worker_deliveries_to_retry` and creates it again with the same arguments. It has no dedicated staging run (decision 54), so it arrives untested on staging.

**Confirm the link.** Einar's `supabase login` and `supabase link --project-ref <project-ref>` are already done; he types the database password only at the CLI's prompt. The next command must print the production project's reference:

```sh
cat supabase/.temp/project-ref
```

**The two pushes.**

```sh
supabase db push
supabase migration list
git push origin origin/main:refs/heads/production
```

`supabase db push` lists what it will apply and asks to confirm. `supabase migration list` must show no local version with an empty remote column. If `db push` fails, stop: don't push `production`, and report. One failure is the exception: a migration that fails on a lock timeout (`canceling statement due to lock timeout`) changed nothing, so run `supabase db push` again. Never `supabase config push` (production runbook G3.2b).

Never force the push to `production`. It must be a fast-forward.

**Verify:**

```sh
vercel ls --environment production --limit 1 --cwd ~/vercel-link/vefstjorn
vercel ls --environment production --limit 1 --cwd ~/vercel-link/vefstjorn-demo
```

Both show a new Ready deployment, of the commit you pushed.

The editor timeout took effect. In the SQL editor, `rolconfig` must contain `statement_timeout=3s`:

```sql
select rolconfig from pg_roles where rolname = 'authenticated';
```

If it doesn't, set it by hand with these two statements, each on its own, and check again. If the `alter role` is refused, stop and report.

```sql
alter role authenticated set statement_timeout = '3s';
notify pgrst, 'reload config';
```

The CMS project's logs show `/api/cron/sweep` answering `200` each minute. A failed minute or two while the new deployment comes up is expected if a migration dropped something. If it goes on after both are Ready, stop and report.

Then publish on `demo` and run the check in section 1.

`labak-hub` isn't affected: it builds `hub-integration`, and stays at its commit until M6.

## 9. Rehearsing a tenant locally

**Purpose.** Section 2's steps 7 to 11 for a new tenant, on a local stack, before anything reaches production: provision, the first publish with images, and a site reading the local bundle (enhancement A4). Nothing here is HOSTED. Owner: Einar or a session that holds the slot.

**Either stack slot.** Slot 1 is the stack with `CMS_STACK_SLOT` unset, at `http://127.0.0.1:54321`. Slot 2 is `CMS_STACK_SLOT=2`, at `http://127.0.0.1:54331`. Use only a slot nobody else is using. Every terminal below starts with the same `export`, and runs from the repository root:

```sh
export CMS_STACK_SLOT=2   # slot 2; for slot 1: unset CMS_STACK_SLOT
pnpm db:slot
```

`pnpm db:slot` prints the slot's `api_url`, `cms_port`, `cms_url` and `mailpit_url`. They stand for `<api-url>`, `<cms-port>`, `<cms-url>` and `<mailpit-url>` below. `<site-port>` is a free port of your choice for the site.

**What differs from production.** `provision --local` runs the same commands with the same checks, except that:

- the target is a local stack's own address and nothing else: slot 1's or slot 2's, never another port, `localhost` by name or a hosted project;
- the env file must be named, because the default is the production env file;
- a site's base URL may also be `http://localhost:<port>` or `http://127.0.0.1:<port>`.

A local bundle delivers images at the stack's own `http` address. A hosted project only ever delivers `https` addresses (§5.6).

**L1. The module.** Section 2, steps 1 to 4, on a branch, without the PR: the CMS started in L4 runs from this checkout, so the module only has to be registered here. Any registered module can be rehearsed. `m4-probe`, for one, has no local tenant.

**L2. The stack and its env file.**

```sh
pnpm db:start
LOCAL_ENV="$(mktemp -d)/local.env"
node tools/stack/supabase.ts status -o env | sed -n 's/^API_URL=/NEXT_PUBLIC_SUPABASE_URL=/p; s/^PUBLISHABLE_KEY=/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=/p; s/^SECRET_KEY=/SUPABASE_SECRET_KEY=/p' | tr -d '"' > "$LOCAL_ENV"
```

The file holds the local stack's URL, its publishable key and its local secret key, all three from the `API_URL`, `PUBLISHABLE_KEY` and `SECRET_KEY` lines of `supabase status -o env`; they reach nothing but this stack. `provision` reads the URL and the secret key. `import` (L5b) reads the URL and the publishable key only, and stops with `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` missing when the file has no such line. It is outside the repository, in a folder only you can read. `pnpm db:reset` instead of `db:start` gives an empty stack. It removes the tenants of earlier rehearsals on this slot.

**L3. Provision the tenant and invite the editor.**

```sh
pnpm --silent --filter @litljomi/cli cli provision tenant '<tenant>' --name '<Tenant name>' --local --env-file="$LOCAL_ENV"
pnpm --silent --filter @litljomi/cli cli provision editor --email '<address>' --tenant-id '<tenant-id>' --local --env-file="$LOCAL_ENV"
```

**Verify:** the first prints `target: 127.0.0.1:<port> (local stack)`, then `tenant <tenant>: <tenant-id>`. The second prints `invited <address>: user <user-id>` and `membership <tenant-id>: ok`. The invitation is in Mailpit, at `<mailpit-url>`.

**L4. The CMS.** In a second terminal, after the same `export`. The build takes a few minutes. The script refuses to run while an `apps/cms/.env*` file exists.

```sh
export CMS_PUBLIC_URL='<cms-url>' CMS_INTERNAL_SECRET="$(openssl rand -hex 24)" CRON_SECRET="$(openssl rand -hex 24)"
sh tests/integration/scripts/cms-next.sh build && sh tests/integration/scripts/cms-next.sh start -p '<cms-port>' -H 127.0.0.1
```

**Nothing calls the sweep locally.** On production, Vercel Cron calls `/api/cron/sweep` every minute (`apps/cms/vercel.json`). An editor's own publish starts the worker at once, but a request filed from the CLI (`import`, L5b) waits for the sweep. No script in the repository stands in for the cron: the browser suite doesn't run the sweep, and the import's integration test calls the worker's `sweep()` in its own process (`apps/cms/src/privileged/worker/__tests__/import-command.integration.test.ts`). So, for a rehearsal that publishes from the CLI, start this loop in the same terminal, before the command above, so that it uses the same `CRON_SECRET`:

```sh
(while sleep 60; do curl -s -o /dev/null -w 'sweep %{http_code}\n' -H "Authorization: Bearer $CRON_SECRET" '<cms-url>/api/cron/sweep'; done) &
```

**Verify:** once the CMS is up, a line `sweep 200` appears each minute (`sweep 000` while it is still building). A `401` means the loop has another `CRON_SECRET` than the CMS. Stop it with `kill %1` when the rehearsal ends.

**L5. Publish once.** Open the invitation in Mailpit, choose a password, and publish an entry as in section 2, step 9, with an image. With no site yet, the editor ends at "Enginn vefur tengdur", as on production. Then, in the first terminal:

```sh
curl -s '<api-url>/storage/v1/object/public/delivery/<tenant>/current.json'
curl -s '<api-url>/storage/v1/object/public/delivery/<tenant>/releases/1.json' | grep -oE '"(url|src)":"[^"]*"'
```

**Verify:** the pointer names `releases/1.json`. Each image address, `url` in an image field and `src` in rich text, starts with `<api-url>/storage/v1/object/public/media-public/<tenant>/`, and `curl -s -o /dev/null -w '%{http_code}\n' '<address>'` prints `200` for it. A `url` without `/media-public/` is a link or a video's address, not an image. An image delivered as `null` means the CMS is not running against this stack's own address: stop and report.

**L5b. Import (optional).** In the first terminal, the tenant's content from a manifest (`docs/plans/import.md`), as the editor invited in L3, once that editor has chosen a password. It needs the sweep loop from L4. The dry run is offline; the real run reads the password from standard input and never the secret key.

```sh
pnpm --silent --filter @litljomi/cli cli import --tenant '<tenant>' --manifest '<manifest>' --media '<media-folder>' --dry-run
pnpm --silent --filter @litljomi/cli cli import --tenant '<tenant>' --manifest '<manifest>' --media '<media-folder>' --email '<address>' --local --env-file="$LOCAL_ENV"
```

Both paths are absolute. **Verify:** the run ends with `differences: 0`, exit code 0. Each type the module orders by hand prints `order <type>: … move(s), before anything of this run is published` on the first run, and `already in the manifest's order; nothing moved` on a second one. `thumbnails: <n> made` counts the files given a thumbnail. Requests go through the sweep at most three a minute, so expect about one minute per three entries.

**L6. The site.** In the first terminal, with both secrets kept in this terminal for the site:

```sh
WEBHOOK_SECRET="$(openssl rand -base64 32)"
printf '%s' "$WEBHOOK_SECRET" | pnpm --silent --filter @litljomi/cli cli provision site --tenant-id '<tenant-id>' --base-url 'http://localhost:<site-port>' --revalidate-path '/api/cms/revalidate' --preview-url 'http://localhost:<site-port>/api/cms/preview' --local --env-file="$LOCAL_ENV"
PREVIEW_SECRET="$(openssl rand -base64 32)"
printf '%s' "$PREVIEW_SECRET" | pnpm --silent --filter @litljomi/cli cli provision preview-secret --site-id '<site-id>' --local --env-file="$LOCAL_ENV"
```

Then build and start the site against the local bundle: `apps/demo-site` from `apps/demo-site`, or a site in its own repository from its folder, with `npm run build` and `npm start -- -p '<site-port>'` in place of the two `next` commands.

```sh
export CMS_TENANT='<tenant>' CMS_DELIVERY_BASE_URL='<api-url>/storage/v1/object/public/delivery' CMS_MEDIA_HOST='127.0.0.1'
export CMS_WEBHOOK_SECRETS="$WEBHOOK_SECRET" CMS_PREVIEW_SECRETS="$PREVIEW_SECRET" CMS_PREVIEW_BASE_URL='<cms-url>'
rm -rf .next && pnpm exec next build && pnpm exec next start -p '<site-port>' -H 127.0.0.1
```

`rm -rf .next` drops a pointer an earlier build cached. Images inside rich text are plain `<img>` tags and load from the stack as they are. A site that shows images through `next/image` needs, for the rehearsal only, a remote pattern for `protocol: 'http'`, `hostname: '127.0.0.1'` and the stack's port, and either `images.unoptimized: true` or `images.dangerouslyAllowLocalIP: true`: Next.js 16 refuses to optimise an image from a local address. Neither belongs in the configuration that goes to production.

**Verify:** a page that renders an entry holds `data-cms-entry` and its images load. Edit the entry and publish again: the editor reaches "Birt á vef ✓". Preview a draft from the editor. Unpublish, and it reaches "Tekið af vef".

**Clean up.** `unset WEBHOOK_SECRET PREVIEW_SECRET`, `rm -r "$(dirname "$LOCAL_ENV")"`, stop the CMS and the site, and delete the `.next` folders the builds wrote. The tenant stays on the slot until its next `pnpm db:reset`.
