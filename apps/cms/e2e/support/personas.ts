// The fixed test identities the e2e tests sign in as (plan, "Fixed test identities"; seeded by
// `pnpm seed:local`). Copied from tests/integration/src/fixtures.ts, which app code may not import.
export const PERSONA_EMAILS = {
  editor_labak: 'editor-labak@test.local',
  editor_demo: 'editor-demo@test.local',
  platform_admin: 'admin@test.local',
} as const;

export type E2ePersona = keyof typeof PERSONA_EMAILS;

/**
 * The password every fixed persona signs in with on the local stack, copied from PERSONA_PASSWORD in
 * tests/integration/src/fixtures.ts (the seed sets it). A local test value, never a real one.
 */
export const PERSONA_PASSWORD = 'local-test-password-0123';
