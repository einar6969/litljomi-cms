// V-HELPERS fallback (tooling only): `supabase test db` runs every .sql file in
// supabase/tests/database, including the shared `_helpers.sql`, which would
// commit schema `tests` outside any test transaction. This wrapper passes only
// the `*.test.sql` files, so `\ir _helpers.sql` resolves but helpers never run alone.
// It runs on the stack CMS_STACK_SLOT names (tools/stack/slot.ts).
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { supabaseCliEnv } from '../stack/slot.ts';

// Resolved from the script location, so it works from any working directory.
const dir = fileURLToPath(new URL('../../supabase/tests/database', import.meta.url));
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.test.sql'))
  .sort()
  .map((f) => `${dir}/${f}`);

// With no file arguments `supabase test db` runs every .sql file, _helpers.sql included.
if (files.length === 0) {
  console.error(`db:test: no *.test.sql files in ${dir}`);
  process.exit(1);
}

let env;
try {
  env = { ...supabaseCliEnv(process.env), SUPABASE_TELEMETRY_DISABLED: '1' };
} catch (error) {
  console.error(`db:test: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
const result = spawnSync('supabase', ['test', 'db', ...files], { stdio: 'inherit', env });
if (result.error) {
  console.error(`db:test: could not run the Supabase CLI (${result.error.message}). Is \`supabase\` installed and on PATH?`);
  process.exit(1);
}
process.exit(result.status ?? 1);
