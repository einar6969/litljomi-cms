// The fixed test identities the e2e tests sign in as (plan, "Fixed test identities"; seeded by
// `pnpm seed:local`). Copied from tests/integration/src/fixtures.ts, which app code may not import.
export const PERSONA_EMAILS = {
  editor_labak: 'editor-labak@test.local',
  editor_demo: 'editor-demo@test.local',
} as const;

export type E2ePersona = keyof typeof PERSONA_EMAILS;
