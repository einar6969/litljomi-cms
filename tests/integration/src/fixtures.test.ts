// The fixed test identities are written twice, in supabase/tests/database/_helpers.sql
// and in fixtures.ts (plan, "Fixed test identities": they must agree). This test
// reads the SQL file and compares, so the two copies cannot drift (Task 5
// quality r1, Minor 5). It needs no database.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PERSONAS, PERSONA_NAMES, TENANT } from './fixtures.ts';

const helpers = readFileSync(new URL('../../../supabase/tests/database/_helpers.sql', import.meta.url), 'utf8');
const UUID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';

// tests.persona(): when '<name>' then return '<uuid>'::uuid;
const sqlPersonas = Object.fromEntries(
  [...helpers.matchAll(new RegExp(`when '([a-z_]+)'\\s+then return '${UUID}'::uuid`, 'g'))].map((m) => [m[1], m[2]]),
);
// tests.tenant(): p_slug = '<slug>' then return '<uuid>'::uuid;
const sqlTenants = Object.fromEntries(
  [...helpers.matchAll(new RegExp(`p_slug = '([a-z]+)' then\\s+return '${UUID}'::uuid`, 'g'))].map((m) => [m[1], m[2]]),
);
// tests.seed(): ('<name>', '<email>')
const sqlEmails = Object.fromEntries(
  [...helpers.matchAll(/\('([a-z_]+)', '([^']+@test\.local)'\)/g)].map((m) => [m[1], m[2]]),
);

describe('fixtures.ts agrees with _helpers.sql', () => {
  it('persona UUIDs', () => {
    expect(Object.keys(sqlPersonas).sort()).toEqual([...PERSONA_NAMES].sort());
    expect(sqlPersonas).toEqual(Object.fromEntries(PERSONA_NAMES.map((n) => [n, PERSONAS[n].id])));
  });

  it('persona emails', () => {
    expect(sqlEmails).toEqual(Object.fromEntries(PERSONA_NAMES.map((n) => [n, PERSONAS[n].email])));
  });

  it('tenant UUIDs', () => {
    expect(sqlTenants).toEqual(TENANT);
  });

  it('the plan\'s identities table', () => {
    expect(TENANT).toEqual({ labak: '00000000-0000-4000-8000-00000000a001', demo: '00000000-0000-4000-8000-00000000a002' });
    expect(PERSONAS).toEqual({
      editor_labak: { id: '00000000-0000-4000-8000-00000000b001', email: 'editor-labak@test.local', membership: 'labak' },
      editor_demo: { id: '00000000-0000-4000-8000-00000000b002', email: 'editor-demo@test.local', membership: 'demo' },
      outsider: { id: '00000000-0000-4000-8000-00000000b003', email: 'outsider@test.local', membership: null },
      revoked: { id: '00000000-0000-4000-8000-00000000b004', email: 'revoked@test.local', membership: null, revokedFrom: 'labak' },
      platform_admin: { id: '00000000-0000-4000-8000-00000000b005', email: 'admin@test.local', membership: null, platformAdmin: true },
    });
  });
});
