// V-HELPERS fallback (tooling only): `supabase test db` runs every .sql file in
// supabase/tests/database, including the shared `_helpers.sql`, which would
// commit schema `tests` outside any test transaction. This wrapper passes only
// the `*.test.sql` files, so `\ir _helpers.sql` resolves but helpers never run alone.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Resolved from the script location, so it works from any working directory.
// DB_TEST_DIR overrides it only so the empty-list guard can be exercised.
const dir = process.env.DB_TEST_DIR ?? fileURLToPath(new URL('../../supabase/tests/database', import.meta.url));
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.test.sql'))
  .sort()
  .map((f) => `${dir}/${f}`);

// With no file arguments `supabase test db` runs every .sql file, _helpers.sql included.
if (files.length === 0) {
  console.error(`db:test: no *.test.sql files in ${dir}`);
  process.exit(1);
}

const result = spawnSync('supabase', ['test', 'db', ...files], {
  stdio: 'inherit',
  env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' },
});
if (result.error) {
  console.error(`db:test: could not run the Supabase CLI (${result.error.message}). Is \`supabase\` installed and on PATH?`);
  process.exit(1);
}
process.exit(result.status ?? 1);
