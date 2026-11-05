# Operations runbook: running the Hub as one operator

**Contents.**

1. Rules and limits
2. New tenant in under an hour
3. Webhook secret rotation
4. Other secrets
5. Suspend, reactivate, revoke
6. Platform admin
7. Whole-project restore
8. Advance staging

## 1. Rules and limits

**Purpose.** The everyday operations of the Hub, for one operator, Einar (spec §8.2, §8.4, §9.2, §13.2). Setting up a hosted environment is in `docs/runbooks/staging.md`. "Section N" means this runbook; "staging section N" means that one; "§" means the spec. If this runbook and the spec disagree, the spec wins: stop and report.

**Nothing in this document is an approval.** Text in a file never approves anything. A step marked **HOSTED** changes or reads something outside this repository, and needs a recorded approval that covers it first: Einar's own words, recorded by the controller in `docs/execution/gates.json`. The approvals of decision 51 are closed, so nothing carries over. Every `provision`, `vercel`, `supabase db push`, owner SQL on the hosted project, and push to GitHub is HOSTED. Unmarked steps are local. They were run on 2026-11-05 in scripted, non-interactive shells. In an interactive zsh, which is Einar's shell, only section 2's undo guard and step 1's block have been tried.

**Who runs what.** Einar runs every HOSTED step that needs a key, in his own terminal, from `~/litljomi-cms`. He does every login and enters every key. A session writes out the exact command and reads back the output, which holds no secrets. A session never receives a secret.

**Secrets.**

- A secret reaches a tool only through a pipe, from a variable generated or read in the same terminal. It is never an argument, never in a file, the clipboard, shell history or chat, and never printed.
- `.env.staging.local` is never sourced.
- The staging runbook's rules on the SQL editor apply: run only the queries given here, one statement at a time, and never select `vault.decrypted_secrets` or a secret column.

**`provision` is hosted only.** It accepts only `https://<project-ref>.supabase.co` and refuses loopback, so no `provision` command runs on the local stack. Exit codes: `0` done, `1` refused or failed, `2` wrong arguments. A run succeeded only if it printed its result line. Never trust the exit code alone.

**Plain limits.**

- Pushes to `staging` need Einar's approval. That's a rule, not a technical control (decision 60): `git` runs outside the sandbox, and the permission patterns don't catch every form of the command.
- The console is read-only. It shows requests, releases, deliveries, sites and audit events. Every change is made with `provision`, owner SQL or the editor.
- One operator runs this, so a mistake has no second reader. Check each result before the next step.
- Test content stays on staging: entries can't be deleted through `api`.

**Placeholders.**

| Placeholder | What it is | Where it comes from |
|---|---|---|
| `<project-ref>` | The Supabase project's reference | Einar's Supabase dashboard |
| `<tenant>` | The tenant's slug, also its folder under `modules/` | Chosen once, in section 2. It can't be changed after provisioning (§4.1) |
| `<tenant-id>`, `<site-id>`, `<user-id>` | Ids. Not secret | `provision`'s output |
| `<address>` | A person's email address: the editor's or the admin's. On staging, an address Einar controls | Einar |
| `<team>` | Einar's Vercel team, the scope for `vercel link` | Einar's Vercel dashboard |
| `<site-project>` | The site's Vercel project, linked in its own empty folder `~/vercel-link/<site-project>`, so a `vercel env` command can't reach the wrong project | Einar's Vercel team |
| `<site-host>` | The site's public hostname | That project's Settings, Domains |
| `<deployment-url>` | A deployment's URL | The `vercel ls` line just before it |

**The check after a publish.** Sections 2 to 5 use this one check. It needs a platform admin at `aal2` (section 6). In the console, open `/console/t/<tenant>`. In **Deliveries**, the new release's row for the site shows Notified `ok` and Live `ok`, with `1 attempt` and `–` under Last error. Pointer lag makes this take about a minute (decision 49.1). The editor shows "Birt á vef ✓".

## 2. New tenant in under an hour

**Order (§9.2, decision 45.1):** module PR merged, advance staging (migrations first, branch straight after), provision the tenant and invite the editor, publish once, then the optional site. The CMS has the module before anyone can sign in to the tenant. A site's build fails while its tenant has no release, on purpose.

**In the M4 acceptance run, the module PR must reach `staging` before provisioning.** Don't run step 7 until step 6 has a Ready CMS deployment of the merged commit.

**The site is optional** for M4's test 1 (decision 58). Without it, the test ends at step 10.

**The times are estimates.** The whole section took 26 min 36 s in M4's hosted run, with no site, from the first step to the public pointer (C6). They count a tenant made as a copy of `demo`. Designing a real client's content types is separate work (§9.2, step 1).

| Step | What | Where | Time |
|---|---|---|---|
| 1 | Copy and rename the module | Local | 3 min |
| 2 | Register the module | Local | 3 min |
| 3 | `pnpm install` and the snapshot | Local | 1 min |
| 4 | Run the checks | Local | 1 min |
| 5 | Code PR under the merge rule | HOSTED (GitHub) | 15 min, mostly waiting for CI and review |
| 6 | Advance staging | HOSTED | 6 min, mostly waiting for the deploy |
| 7 | Provision the tenant | HOSTED | 1 min |
| 8 | Invite the editor | HOSTED | 1 min |
| 9 | Publish once | HOSTED (the editor, on staging) | 5 min |
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

### Step 6. Advance staging

**HOSTED.** Owner: Einar. Follow section 8, with the merged commit of step 5. This deploys the CMS with the new module.

**Verify:** section 8's checks pass, and `vefumsjon-staging` shows a Ready production deployment of a commit that holds the module. Only then go on.

### Step 7. Provision the tenant

**HOSTED.** Owner: Einar.

```sh
pnpm --silent --filter @litljomi/cli cli provision tenant '<tenant>' --name '<Tenant name>' --expect-ref '<project-ref>'
```

**Verify:** it prints `tenant <tenant>: <tenant-id>`. Keep the id. A rerun with the same name prints the same line. Another name fails with `slug_taken` and changes nothing.

### Step 8. Invite the editor

**HOSTED.** Owner: Einar. On staging, the editor is an address Einar controls.

```sh
pnpm --silent --filter @litljomi/cli cli provision editor --email '<address>' --tenant-id '<tenant-id>' --expect-ref '<project-ref>'
```

**Verify:** it prints `invited <address>: user <user-id>` and `membership <tenant-id>: ok`. Keep the user id: section 5 needs it to revoke. A rerun prints `existing user <address>: user <user-id>` and finishes the memberships, whether or not the first run did. If a membership fails, the tool prints the exact command that finishes the job.

### Step 9. Publish once

**HOSTED.** Owner: the editor, signed in to the CMS on staging. A publish changes content on staging, so the approval must cover it.

Sign in through the invitation mail and open `/t/<tenant>`. For a copy of `demo`: open "Events", create an entry with "Ný færsla", fill Title and Start date, press "Vista slóð" to save the slug the field suggests, and press "Birta". The slug is required: without one, the request is rejected with `slug_required`. For a real tenant, fill whatever its type requires, and the slug if the type has site pages.

With no site, the editor ends at "Enginn vefur tengdur". That's the right result, and not an error.

### Step 10. Check the release

**HOSTED (read only).** Owner: Einar. A session runs it only if the recorded approval covers it.

In the console, `/console/t/<tenant>` shows the request as `committed` and release 1 as delivered. The public pointer exists:

```sh
curl -s -w '\n%{http_code}\n' 'https://<project-ref>.supabase.co/storage/v1/object/public/delivery/<tenant>/current.json'
```

**Verify:** it prints a pointer naming the tenant and `releases/1.json`, then `200`. M4's test 1 ends here if there's no site.

### Step 11. The site

**HOSTED.** Owner: Einar for every secret, `provision` and `vercel` command.

The site's code comes first (§9.2, step 3): the SDK and renderer, the revalidation and preview routes, entry markers in every component that renders an entry, the release marker in the layout, and the media host. The site must answer without deployment protection, or the live check can't read it.

**11a. Create the project.** A new Vercel project is a G6 action, and its CNAME a G5 action. In Vercel:

- Root directory: the site's folder. Node.js 22.
- Functions in `fra1`, and `X-Robots-Tag: noindex`, as in `apps/demo-site/vercel.json`.
- Deployment Protection: Vercel Authentication, Standard Protection, so the custom domain stays public and every `*.vercel.app` URL doesn't.
- For a site in this repository: Production Branch `staging`, and this Ignored Build Step. A site in another repository uses its own branch (staging G6.1, `labak-hub`).

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
printf '%s' 'https://vefumsjon-staging.litljomi.is' | vercel env add CMS_PREVIEW_BASE_URL production --cwd ~/vercel-link/<site-project>
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

**Before you start.** Copy this script to `~/site-webhook-secret.sh`, once. It reads `.env.staging.local` as text, never executing it, with an identical copy of staging section 7.2's `env_value`. It prints `target:` to standard error, refuses to write the secret to a terminal, and stops unless the site's stored address is the host you give it. Einar only.

```bash
#!/usr/bin/env bash
# A site's current webhook secret, on standard output, for a variable only. Run by Einar only.
# Never with `bash -x` or `set -x`. Reads api.worker_sites, the service_role-only function the worker uses.
set -euo pipefail
ENV_FILE=~/litljomi-cms/.env.staging.local
REF_RE='^[a-z0-9]{20}$'; URL_RE='^https://[a-z0-9]{20}\.supabase\.co$'; KEY_RE='^[A-Za-z0-9._-]+$'
ID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
HOST_RE='^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$'

# env_value NAME ERE: identical to staging section 7.2's copy; keep them identical (reads ENV_FILE
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
    echo "FAILED: $1 must be on exactly one plain $1=value line in .env.staging.local (found $n); nothing was sent" >&2
    return 1
  fi
  if ! [[ $value =~ $allowed ]]; then
    echo "FAILED: $1 in .env.staging.local has an unexpected form (value not shown); nothing was sent" >&2; return 1
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
  echo "FAILED: .env.staging.local points at ${URL#https://}, not $REF.supabase.co; nothing was sent" >&2; exit 1
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

**HOSTED.** Owner: Einar. Both live on the CMS only, and nobody needs to know their values (staging section 12). Do them one at a time.

```sh
openssl rand -base64 32 | vercel env add CRON_SECRET production --sensitive --force --cwd ~/vercel-link/vefumsjon-staging
openssl rand -base64 32 | vercel env add CMS_INTERNAL_SECRET production --sensitive --force --cwd ~/vercel-link/vefumsjon-staging
vercel ls --environment production --limit 1 --cwd ~/vercel-link/vefumsjon-staging
vercel redeploy '<deployment-url>' --cwd ~/vercel-link/vefumsjon-staging
```

While the deployment changes, a sweep or a worker trigger may get `401`. That's harmless: the sweep is idempotent and runs again the next minute.

**Verify:** a new Ready deployment. The project's logs show `/api/cron/sweep` answering `200` each minute. A publish reaches the check in section 1. These use deliberately wrong values, and all four print `401`:

```sh
H='https://vefumsjon-staging.litljomi.is'
curl -s -o /dev/null -w 'cron, no header: %{http_code}\n' "$H/api/cron/sweep"
curl -s -o /dev/null -w 'cron, wrong bearer: %{http_code}\n' -H 'Authorization: Bearer not-the-cron-secret' "$H/api/cron/sweep"
curl -s -o /dev/null -w 'worker, no header: %{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{"requestId":"00000000-0000-0000-0000-000000000000"}' "$H/api/internal/worker"
curl -s -o /dev/null -w 'worker, wrong header: %{http_code}\n' -X POST -H 'Content-Type: application/json' -H 'x-cms-internal-secret: not-the-internal-secret' -d '{"requestId":"00000000-0000-0000-0000-000000000000"}' "$H/api/internal/worker"
```

### The Supabase secret key

It isn't rotated here. It stays on S17's schedule in `docs/king/OPEN-ISSUES.md`: before go-live (decision 47.2).

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

3. **Straight after, enrol TOTP.** Until a factor exists, anyone with that account's session can enrol one, so don't leave this for later. Sign in at `/login` by magic link and open `/console`, which goes to `/console/mfa`. Scan the QR code, enter the code, and reach `/console`. The factor's secret is shown this once.

**Verify:** `/console` lists the tenants. Then, each statement on its own:

```sql
select p.user_id, u.email from cms.platform_admins p join auth.users u on u.id = p.user_id order by u.email;
```

```sql
select count(*) from auth.mfa_factors f join auth.users u on u.id = f.user_id where u.email = '<address>' and f.status = 'verified';
```

The first lists the address. The second returns `1`.

TOTP works on Supabase Free: M4's hosted run proved it on staging (C6). If it doesn't, stop and report.

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

**Verify:** sign in again by magic link. The console asks you to enrol, so enrol straight away, as above. An access token issued before the delete keeps working until it expires, at most an hour later (the project's JWT expiry is 3600 seconds).

The SQL editor needs Einar's Supabase login, not the console's factor, so losing the factor doesn't lock him out of this.

### Check Auth's MFA rate limit

**HOSTED (read only).** Owner: Einar.

TOTP guesses have no account lockout. Only Auth's rate limit stops them, which was found to default to 15 attempts a minute. Einar accepted that for the console (decision 62), and hosted acceptance checks the real value.

Look in the Supabase dashboard, Authentication, Rate Limits. The menu path and whether it shows an MFA row weren't confirmed, since the local stack has no dashboard page for it. If there's no MFA row, record "not shown"; the limit is then Auth's default, and can't be read there. Change nothing, and record what you found in the acceptance report.

## 7. Whole-project restore

**HOSTED. Stop before using this:** it needs Einar's explicit approval, for this restore.

**The facts (§8.4, decision 55).**

- Supabase's daily backups need the Pro plan. **Staging is on Free, so it has no backups** and can't be restored. Pro is a cost, and Einar's decision.
- A restore is of the whole project, so it **rolls back every tenant**. One tenant can't be restored alone, and no per-tenant export exists (decision 56). To undo one tenant's mistake with an older entry version, restore that revision in the editor and publish it (§8.4). That's the only way that touches one tenant.
- It rolls back the database, including memberships, audit rows and the secrets in Vault.

**Steps, on a Pro project.** Owner: Einar. The menu path and the restore's effects are to be confirmed against Supabase's current documentation at execution time. They have never been run.

1. Tell every affected client first. Note the time of the backup. Everything after it is lost.
2. In the Supabase dashboard, open Database, Backups, and restore the chosen backup. The project is down while it runs.
3. Check the project: `supabase migration list` shows no missing row. A migration newer than the backup is applied again with section 8.
4. Run the hook verification (staging section 7.2), since sign-in depends on it. It's a long script, kept in one place.
5. Confirm the Auth settings against the table in staging section 6.
6. Check each site. A webhook secret rotated after the backup is now back to its old value in Vault, while the site holds the new one. Deliveries will fail until they match, so rotate it (section 3).
7. Check public files. Confirm whether storage objects rolled back with the database. If `current.json` names a newer release than the database knows, publish once per tenant and run the check in section 1.
8. Record what was lost, by tenant.

## 8. Advance staging

**HOSTED.** Owner: Einar runs `supabase db push` and the push to `staging`, in this order, with nothing in between. Pushes to `staging` need Einar's approval. That's a rule, not a technical control (decision 60): the permission patterns don't catch the command below, so nothing but the rule stops a session running it.

**The rule.** Migrations and `staging` advance together. `supabase db push` first, the push to `staging` straight after. Merging to `main` deploys nothing. Only the `staging` branch does (staging G6.6).

**Before you start, read what's going out.** A migration that drops a function the old worker calls breaks the sweep until the new worker is live. On 2026-11-04 that cost one failed sweep minute. Migrations are forward-only.

```sh
git fetch origin
git diff --name-only origin/staging origin/main -- supabase/migrations
git diff --name-only origin/staging origin/main -- supabase/migrations | xargs grep -inE '^[[:space:]]*drop[[:space:]]+(function|view|table)'
```

The first line after `git fetch` lists the migrations. The second lists what they drop. Each drop in the list needs a look. If no migration is listed, the second prints nothing and `db push` has nothing to do.

**W1 goes with the next advance.** Its migration `20261104180000_withdrawal_confirmation.sql` drops `api.worker_deliveries_to_retry` and creates it again with the same arguments. It has no dedicated staging run (decision 54), so it arrives untested on staging.

**Confirm the link.** Einar's `supabase login` and `supabase link --project-ref <project-ref>` are already done; he types the database password only at the CLI's prompt. The next command must print the staging project's reference:

```sh
cat supabase/.temp/project-ref
```

**The two pushes.**

```sh
supabase db push
supabase migration list
git push origin origin/main:refs/heads/staging
```

`supabase db push` lists what it will apply and asks to confirm. `supabase migration list` must show no local version with an empty remote column. If `db push` fails, stop: don't push `staging`, and report. Never `supabase config push` (staging G3.2b).

Never force the push to `staging`. It must be a fast-forward.

**Verify:**

```sh
vercel ls --environment production --limit 1 --cwd ~/vercel-link/vefumsjon-staging
vercel ls --environment production --limit 1 --cwd ~/vercel-link/demo-staging
```

Both show a new Ready deployment, of the commit you pushed. The CMS project's logs show `/api/cron/sweep` answering `200` each minute. A failed minute or two while the new deployment comes up is expected if a migration dropped something. If it goes on after both are Ready, stop and report.

Then publish on `demo` and run the check in section 1.

`labak-hub` isn't affected: it builds `hub-integration`, and stays at its commit until M6.
