// V-HELPERS fallback (tooling only): `supabase test db` runs every .sql file in
// supabase/tests/database, including the shared `_helpers.sql`, which would
// commit schema `tests` outside any test transaction. This wrapper passes only
// the `*.test.sql` files, so `\ir _helpers.sql` resolves but helpers never run alone.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const dir = 'supabase/tests/database';
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.test.sql'))
  .sort()
  .map((f) => `${dir}/${f}`);

const result = spawnSync('supabase', ['test', 'db', ...files], {
  stdio: 'inherit',
  env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' },
});
if (result.error) {
  console.error(`db:test: could not run the Supabase CLI (${result.error.message}). Is \`supabase\` installed and on PATH?`);
  process.exit(1);
}
process.exit(result.status ?? 1);
