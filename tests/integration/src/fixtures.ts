// The fixed test identities (plan, "Fixed test identities"). They must agree
// with supabase/tests/database/_helpers.sql; fixtures.test.ts checks that.
export const TENANT = {
  labak: '00000000-0000-4000-8000-00000000a001',
  demo: '00000000-0000-4000-8000-00000000a002',
} as const;

export type TenantSlug = keyof typeof TENANT;
export type Persona = {
  id: string;
  email: string;
  /** The tenant the persona is an editor of, if any. */
  membership: TenantSlug | null;
  /** revoked: a membership in this tenant is added and then deleted when seeding. */
  revokedFrom?: TenantSlug;
  /** platform_admin: a row in cms.platform_admins, no membership. */
  platformAdmin?: true;
};

export const PERSONAS = {
  editor_labak: { id: '00000000-0000-4000-8000-00000000b001', email: 'editor-labak@test.local', membership: 'labak' },
  editor_demo: { id: '00000000-0000-4000-8000-00000000b002', email: 'editor-demo@test.local', membership: 'demo' },
  outsider: { id: '00000000-0000-4000-8000-00000000b003', email: 'outsider@test.local', membership: null },
  revoked: { id: '00000000-0000-4000-8000-00000000b004', email: 'revoked@test.local', membership: null, revokedFrom: 'labak' },
  platform_admin: { id: '00000000-0000-4000-8000-00000000b005', email: 'admin@test.local', membership: null, platformAdmin: true },
} as const satisfies Record<string, Persona>;

export type PersonaName = keyof typeof PERSONAS;
export const PERSONA_NAMES = Object.keys(PERSONAS) as PersonaName[];

/** The demo tenant's site, created by seedIntegration (the fixture site's port, plan Task 26). */
export const DEMO_SITE = {
  baseUrl: 'http://localhost:3101',
  revalidateUrl: 'http://localhost:3101/api/cms/revalidate',
  webhookSecret: 's3cr3t',
} as const;
