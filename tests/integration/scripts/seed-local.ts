// `pnpm seed:local` (decision 37.5): seeds the fixed test identities on the LOCAL stack, so they
// exist after `pnpm db:reset` for the CMS's Playwright tests (its global setup runs this file with
// `node`) and for Einar's walkthrough. It reuses seedIntegration(); env.ts reads the stack's URLs
// and keys from `supabase status` and refuses any host that is not loopback. Local only.
import { seedIntegration } from '../src/seed.ts';
import { closeAll } from '../src/sql.ts';

try {
  await seedIntegration();
  console.log('seed:local: the fixed test identities are seeded on the local stack');
} catch (error) {
  console.error('seed:local failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeAll();
}
