#!/bin/sh
# Runs `next <args>` for apps/cms against the LOCAL Supabase stack, for the opt-in local end to end
# (pnpm test:e2e-local; plan Task 21). The CMS app's Supabase URL and keys are read here, at run
# time, from `supabase status -o env`, and exist only in this process's environment: nothing is
# written to a file, and the TypeScript test that starts this script never reads or names the
# secret key (the secret-key lint rule, spec §3.1, §8.1). Refuses a stack that is not on loopback.
# The caller passes CMS_INTERNAL_SECRET, CRON_SECRET and CMS_PUBLIC_URL in the environment.
set -eu
root=$(cd "$(dirname "$0")/../../.." && pwd)
status=$(cd "$root" && SUPABASE_TELEMETRY_DISABLED=1 supabase status -o env 2>/dev/null)
value() { printf '%s\n' "$status" | sed -n "s/^$1=//p" | head -n 1 | tr -d '"'; }
api_url=$(value API_URL)
publishable=$(value PUBLISHABLE_KEY)
secret=$(value SECRET_KEY)
case "$api_url" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *) echo "cms-next.sh: refusing a non-local stack: '$api_url'" >&2; exit 1 ;;
esac
if [ -z "$publishable" ] || [ -z "$secret" ]; then
  echo "cms-next.sh: supabase status gave no keys; is the local stack running (pnpm db:start)?" >&2
  exit 1
fi
export NEXT_PUBLIC_SUPABASE_URL="$api_url"
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$publishable"
export SUPABASE_SECRET_KEY="$secret"
export NEXT_TELEMETRY_DISABLED=1
cd "$root/apps/cms"
exec node node_modules/next/dist/bin/next "$@"
