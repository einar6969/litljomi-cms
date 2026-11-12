// M4-03 over the Data API (spec §4.5, §4.6, §8.4, §8.5): the persona matrix of the console views
// with real sessions, the way the console will read them. Two tenants of the file's own hold one
// row of each kind. The aal2 sessions are throwaway users with a TOTP factor, so no fixed persona
// gains one. 114_console_views.test.sql pins the catalog and the rest of the matrix.
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, brief, claims, deleteThrowawayUsers, newUser, passwordSession, totp, type TestUser } from './auth-api.ts';
import { anonClient, editorApiClient, secretClient } from './clients.ts';
import { env } from './env.ts';
import { PERSONAS, TENANT, type PersonaName } from './fixtures.ts';
import { closeAll, ownerQuery } from './sql.ts';

const OPERATIONAL = ['console_tenants', 'console_requests', 'console_releases', 'console_sites', 'console_deliveries', 'console_audit'] as const;
const VIEWS = ['console_admin', ...OPERATIONAL] as const;

const RUN = randomUUID().slice(0, 8);
/** In the free-text parts of each fixture error; no view may show it. */
const LEAKED = 'leaked-payload-text';
const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await secretClient().schema('api').rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.code} ${error.message}`);
  return data as T;
};

/** One tenant's fixture rows: a site, an entry, a failed request, a failed release and delivery. */
async function arrangeTenant(label: string) {
  const tenantId = await rpc<string>('admin_create_tenant', { p_slug: `console-${label}-${RUN}`, p_name: `Console ${label}` });
  const siteId = await rpc<string>('admin_create_site', {
    p_tenant_id: tenantId,
    p_base_url: `http://localhost:3299/${label}`,
    p_revalidate_url: `http://localhost:3299/${label}/revalidate`,
    p_preview_url: null,
    p_webhook_secret: `console-webhook-${label}-0123456789abcdef0123456789`,
  });
  const entryId = randomUUID();
  const releaseId = randomUUID();
  const requester = PERSONAS.editor_labak.id;
  await ownerQuery('insert into cms.entries (id, tenant_id, type, created_by) values ($1, $2, $3, $4)', [entryId, tenantId, 'news', requester]);
  await ownerQuery(
    `insert into cms.releases (id, tenant_id, number, status, error) values ($1, $2, 1, 'failed', $3)`,
    [releaseId, tenantId, { code: 'build_failed', step: 'previous_bundle', message: LEAKED, omitted: [{ entryId, error: { message: LEAKED } }] }],
  );
  await ownerQuery(
    `insert into cms.publish_requests (tenant_id, entry_id, action, draft_version, requested_by, status, error)
     values ($1, $2, 'publish', 1, $3, 'failed', $4)`,
    [tenantId, entryId, requester, { code: 'invalid_data', issues: [{ message: LEAKED }] }],
  );
  await ownerQuery(
    `insert into cms.site_deliveries (release_id, site_id, tenant_id, notify_status, notify_attempts, last_error)
     values ($1, $2, $3, 'failed', 4, $4)`,
    [releaseId, siteId, tenantId, { code: 'notify_failed', status: 500, withdrawals: [{ ownPath: `/${LEAKED}` }] }],
  );
  return { tenantId, siteId, releaseId };
}

/** A real aal2 session: a password sign-in, then TOTP enrolment and step-up. */
async function aal2Token(user: TestUser): Promise<string> {
  const session = await passwordSession(user);
  const token: string = session.json.access_token;
  const enrol = await auth('/factors', { token, body: { factor_type: 'totp', friendly_name: 'console-views' } });
  if (enrol.status !== 200) throw new Error(`enrol: ${brief(enrol)}`);
  const challenge = await auth(`/factors/${enrol.json.id}/challenge`, { token, body: {} });
  const verified = await auth(`/factors/${enrol.json.id}/verify`, {
    token, body: { challenge_id: challenge.json.id, code: totp(enrol.json.totp.secret) },
  });
  if (verified.status !== 200) throw new Error(`verify: ${brief(verified)}`);
  expect(claims(verified.json.access_token).aal).toBe('aal2');
  return verified.json.access_token;
}

const clientFor = (token: string): SupabaseClient<any, 'api'> =>
  createClient<any, 'api'>(env.apiUrl, env.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    db: { schema: 'api' },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

async function rows(client: SupabaseClient<any, 'api'>, view: string): Promise<Record<string, unknown>[]> {
  const { data, error } = await client.from(view).select('*');
  if (error) throw new Error(`${view}: ${error.code} ${error.message}`);
  return data;
}

let a: Awaited<ReturnType<typeof arrangeTenant>>;
let b: Awaited<ReturnType<typeof arrangeTenant>>;
let adminUser: TestUser;
let editorUser: TestUser;
let adminAal2: SupabaseClient<any, 'api'>;
let editorAal2: SupabaseClient<any, 'api'>;

beforeAll(async () => {
  a = await arrangeTenant('a');
  b = await arrangeTenant('b');
  adminUser = await newUser('console-admin');
  editorUser = await newUser('console-editor');
  await ownerQuery('insert into cms.platform_admins (user_id) values ($1)', [adminUser.id]);
  await rpc('admin_add_membership', { p_tenant_id: a.tenantId, p_user_id: editorUser.id });
  adminAal2 = clientFor(await aal2Token(adminUser));
  editorAal2 = clientFor(await aal2Token(editorUser));
});

afterAll(async () => {
  const tenants = [a?.tenantId, b?.tenantId].filter(Boolean);
  await ownerQuery('delete from cms.platform_admins where user_id = $1', [adminUser?.id]);
  await ownerQuery('delete from cms.memberships where tenant_id = any($1::uuid[])', [tenants]);
  for (const table of ['site_deliveries', 'publish_requests', 'releases', 'entries', 'sites']) {
    await ownerQuery(`delete from cms.${table} where tenant_id = any($1::uuid[])`, [tenants]);
  }
  await ownerQuery('delete from cms.tenants where id = any($1::uuid[])', [tenants]);
  await deleteThrowawayUsers();
  await closeAll();
});

describe('console views over the Data API (M4-03)', () => {
  it.each(VIEWS)('%s refuses anon and the secret key (42501)', async (view) => {
    expect((await anonClient().schema('api').from(view).select('*')).error?.code).toBe('42501');
    expect((await secretClient().schema('api').from(view).select('*')).error?.code).toBe('42501');
  });

  it.each(['editor_labak', 'editor_demo', 'outsider', 'revoked'] as const satisfies readonly PersonaName[])(
    '%s at aal1 gets no rows from any view',
    async (persona) => {
      const client = await editorApiClient(persona);
      for (const view of VIEWS) expect(await rows(client, view), `${view} as ${persona}`).toEqual([]);
    },
  );

  it('an editor at aal2, with rows of their own in the tenant, gets no rows from any view', async () => {
    for (const view of VIEWS) expect(await rows(editorAal2, view), view).toEqual([]);
    expect((await editorAal2.from('my_tenants').select('id')).data).toEqual([{ id: a.tenantId }]);
    expect((await editorAal2.from('tenant_sites').select('id')).data).toEqual([{ id: a.siteId }]);
  });

  it('the seeded admin at aal1 gets only their console_admin row', async () => {
    const client = await editorApiClient('platform_admin');
    expect(await rows(client, 'console_admin')).toEqual([{ user_id: PERSONAS.platform_admin.id }]);
    for (const view of OPERATIONAL) expect(await rows(client, view), view).toEqual([]);
  });

  it('an admin at aal2 sees every tenant, in the non-secret columns', async () => {
    expect(await rows(adminAal2, 'console_admin')).toEqual([{ user_id: adminUser.id }]);

    const tenantIds = (await rows(adminAal2, 'console_tenants')).map((t) => t.id);
    expect(tenantIds).toEqual(expect.arrayContaining([TENANT.labak, TENANT.demo, a.tenantId, b.tenantId]));

    for (const view of ['console_requests', 'console_releases', 'console_sites', 'console_deliveries', 'console_audit']) {
      const seen = new Set((await rows(adminAal2, view)).map((r) => r.tenant_id));
      expect(seen.has(a.tenantId) && seen.has(b.tenantId), view).toBe(true);
    }

    const sites = (await rows(adminAal2, 'console_sites')).filter((s) => s.tenant_id === a.tenantId);
    expect(sites).toEqual([{ id: a.siteId, tenant_id: a.tenantId, base_url: 'http://localhost:3299/a', active: true }]);
    const delivery = (await rows(adminAal2, 'console_deliveries')).find((d) => d.tenant_id === b.tenantId);
    expect(delivery).toMatchObject({ release_id: b.releaseId, site_id: b.siteId, notify_status: 'failed', notify_attempts: 4, last_error_code: 'notify_failed', last_error_status: '500', release_number: 1 });
    const release = (await rows(adminAal2, 'console_releases')).find((r) => r.tenant_id === b.tenantId);
    expect(release).toMatchObject({ id: b.releaseId, error_code: 'build_failed', error_step: 'previous_bundle' });
    const request = (await rows(adminAal2, 'console_requests')).find((r) => r.tenant_id === b.tenantId);
    expect(request).toMatchObject({ status: 'failed', error_code: 'invalid_data' });
    const audit = (await rows(adminAal2, 'console_audit')).find((e) => e.tenant_id === b.tenantId && e.action === 'publish_request.created');
    expect(audit).toMatchObject({ actor_id: PERSONAS.editor_labak.id, target_type: expect.any(String) });
    expect(audit).not.toHaveProperty('details');
  });

  it('no view hands a secret reference to an admin at aal2', async () => {
    const { error } = await adminAal2.from('console_sites').select('webhook_secret_ref');
    expect(error?.code).toBe('42703');
    for (const view of VIEWS) {
      const keys = (await rows(adminAal2, view)).flatMap((r) => Object.keys(r));
      expect(keys.filter((k) => k.includes('secret')), view).toEqual([]);
    }
  });

  it('no view hands the free text of an error to an admin at aal2', async () => {
    for (const view of VIEWS) expect(JSON.stringify(await rows(adminAal2, view)), view).not.toContain(LEAKED);
  });

  it('the views are read-only for an admin at aal2 (42501)', async () => {
    const update = await adminAal2.from('console_tenants').update({ status: 'suspended' }).eq('id', a.tenantId);
    expect(update.error?.code).toBe('42501');
    const del = await adminAal2.from('console_audit').delete().eq('tenant_id', a.tenantId);
    expect(del.error?.code).toBe('42501');
    expect(await ownerQuery('select status from cms.tenants where id = $1', [a.tenantId])).toEqual([{ status: 'active' }]);
  });
});
