// The fixed test identities (plan, "Fixed test identities"). They must agree
// with supabase/tests/database/_helpers.sql; fixtures.test.ts checks that.
import { stackSlot } from '../../../tools/stack/slot.ts';

/** The stack slot's site ports (CMS_STACK_SLOT, tools/stack/slot.ts; slot 1: 3101 and 3200). */
const stack = stackSlot();

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

/**
 * The password every fixed persona signs in with on the local stack (spec §4.4; PW-01). A local
 * test value, never a real one; seedIntegration sets it.
 */
export const PERSONA_PASSWORD = 'local-test-password-0123';

/** The demo tenant's site, created by seedIntegration (the fixture site's port, plan Task 26). */
export const DEMO_SITE = {
  baseUrl: stack.demoSiteUrl,
  revalidateUrl: `${stack.demoSiteUrl}/api/cms/revalidate`,
  webhookSecret: 's3cr3t',
  /** The demo site's preview route and secret (M3-12; a local test value, stored in the local Vault). */
  previewUrl: `${stack.demoSiteUrl}/api/cms/preview`,
  previewSecret: 'demo-preview-s3cr3t-local-test-value-0123',
} as const;

/**
 * The site `pnpm seed:labak-site` gives the labak tenant, by hand, on the local stack only: the
 * LABAK site running locally. A local test secret, never a real one. Not part of seedIntegration:
 * the design e2e expects labak to have no site after a reset.
 */
export const LABAK_LOCAL_SITE = {
  baseUrl: stack.labakSiteUrl,
  revalidateUrl: `${stack.labakSiteUrl}/api/cms/revalidate`,
  webhookSecret: 'labak-local-secret',
} as const;
