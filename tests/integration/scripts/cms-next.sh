#!/bin/sh
# Runs `next <args>` for apps/cms against the LOCAL Supabase stack, for the opt-in local end to end
# (pnpm test:e2e-local; plan Task 21). The CMS app's Supabase URL and keys are read here, at run
# time, from `supabase status -o env`, and exist only in this process's environment: nothing is
# written to a file, and the TypeScript test that starts this script never reads or names the
# secret key (the secret-key lint rule, spec §3.1, §8.1). Refuses a stack that is not on loopback.
# The caller passes CMS_INTERNAL_SECRET, CRON_SECRET and CMS_PUBLIC_URL in the environment.
#
# The CMS's Playwright run starts this script outside the Bash sandbox, on the condition that it
# reaches only loopback and this repository (decision 37.3). So the CLIs' own network calls are off
# (the Supabase CLI's GitHub release check, its telemetry, Next.js telemetry), and the script refuses
# to run when an apps/cms/.env* file exists: Next.js would load it, and outside the sandbox the .env
# read denial does not apply. Checked by tools/checks/__tests__/e2e-loopback.test.ts.
set -eu
root=$(cd "$(dirname "$0")/../../.." && pwd)
# An unmatched glob stays the literal pattern, so a file is reported when the name is not the pattern
# itself, or when it is but such a file really exists (a file literally named `.env*`).
for f in "$root"/apps/cms/.env*; do
  if [ "$f" != "$root/apps/cms/.env*" ] || [ -e "$f" ]; then
    echo "cms-next.sh: refusing to run: apps/cms/${f##*/} exists, and Next.js would load it; remove it (the stack's values come from supabase status)" >&2
    exit 1
  fi
done
export SUPABASE_NO_UPDATE_NOTIFIER=1
export SUPABASE_TELEMETRY_DISABLED=1
export NEXT_TELEMETRY_DISABLED=1
# stdout (the keys) is captured and never printed; stderr is left alone so a failure of
# `supabase status` (no Docker, no stack, a CLI error) is shown, not hidden. The CLI writes the keys
# to stdout only: with CLI 2.121.0 its stderr carries status lines and warnings ("Stopped services:
# …", a deprecation notice) or the error, never a key (checked 2026-11-03, M2-02).
status=$(cd "$root" && supabase status -o env) || {
  echo "cms-next.sh: 'supabase status -o env' failed (see its message above); is the local stack running (pnpm db:start)?" >&2
  exit 1
}
value() { printf '%s\n' "$status" | sed -n "s/^$1=//p" | head -n 1 | tr -d '"'; }
api_url=$(value API_URL)
publishable=$(value PUBLISHABLE_KEY)
secret=$(value SECRET_KEY)
# Loopback host and a port of digits only, so userinfo (`http://localhost:x@host`) or a path cannot
# name another host.
case "$api_url" in
  http://127.0.0.1:*|http://localhost:*) port=${api_url#http://*:} ;;
  *) port= ;;
esac
case "$port" in
  ''|*[!0-9]*) echo "cms-next.sh: refusing a non-local stack: '$api_url'" >&2; exit 1 ;;
esac
if [ -z "$publishable" ] || [ -z "$secret" ]; then
  echo "cms-next.sh: supabase status gave no keys; is the local stack running (pnpm db:start)?" >&2
  exit 1
fi
export NEXT_PUBLIC_SUPABASE_URL="$api_url"
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$publishable"
export SUPABASE_SECRET_KEY="$secret"
cd "$root/apps/cms"
exec node node_modules/next/dist/bin/next "$@"
