// Vitest global setup: seed the fixed identities once per run (plan Task 12).
import { seedIntegration } from './seed.ts';
import { closeAll } from './sql.ts';

export default async function setup() {
  await seedIntegration();
  await closeAll();
}
