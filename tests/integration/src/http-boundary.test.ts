// The Data API boundary over real HTTP (spec §4.2, §4.5, §4.6, §8.1, §11.1;
// plan Task 12, gates A1, A2 and A3; decision 1). Every request goes through
// the local stack's gateway with a real session, the publishable key or the
// secret key, never through a database connection, except where a test reads
// the result back as the owner.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anonClient, authHeaders, editorClient, secretClient } from './clients.ts';
import { env } from './env.ts';
import { PERSONAS, TENANT, type PersonaName } from './fixtures.ts';
import { closeAll, countDraftRefs, ownerQuery } from './sql.ts';

const registerAsset = async (persona: PersonaName, tenantId: string, assetId = randomUUID()) => {
  const c = await editorClient(persona);
  const { data, error } = await c.schema('api').rpc('register_asset', {
    p_asset_id: assetId,
    p_tenant_id: tenantId,
    p_original_path: `${tenantId}/${assetId}/a.jpg`,
    p_filename: 'a.jpg',
    p_mime: 'image/jpeg',
    p_bytes: 1024,
    p_width: 10,
    p_height: 10,
    p_sha256: 'a'.repeat(64),
  });
  expect(error).toBeNull();
  expect(data).toBe(assetId);
  return assetId;
};

afterAll(closeAll);

describe('A1: cms, private and public are not reachable over the Data API', () => {
  it('A1: cms tables are not reachable over REST', async () => {
    const c = await editorClient('editor_labak');
    // The cast only satisfies the client's types; the request names schema cms.
    const { error } = await c.schema('cms' as 'api').from('entries').select('*');
    expect(error?.code).toBe('PGRST106'); // schema not exposed
  });

  it.each(['cms', 'private', 'public'])('A1: schema %s is refused for anon, an editor and the secret key', async (schema) => {
    for (const client of [anonClient(), await editorClient('editor_labak'), secretClient()]) {
      const tables = await client.schema(schema as 'api').from('entries').select('*');
      expect(tables.error?.code).toBe('PGRST106');
      const rpc = await client.schema(schema as 'api').rpc('extract_refs', { p_data: {} });
      expect(rpc.error?.code).toBe('PGRST106');
    }
  });

  it('A1: the raw Accept-Profile and Content-Profile headers cannot select cms', async () => {
    const read = await fetch(`${env.apiUrl}/rest/v1/entries?select=*`, {
      headers: { ...(await authHeaders('editor_labak')), 'accept-profile': 'cms' },
    });
    expect(read.status).toBe(406);
    expect((await read.json()).code).toBe('PGRST106');
    const write = await fetch(`${env.apiUrl}/rest/v1/entries`, {
      method: 'POST',
      headers: { ...(await authHeaders('editor_labak')), 'content-profile': 'cms', 'content-type': 'application/json' },
      body: JSON.stringify({ tenant_id: TENANT.labak, type: 'news' }),
    });
    expect(write.status).toBe(406);
    expect((await write.json()).code).toBe('PGRST106');
  });

  it('A1: the api schema has no cms tables of its own name', async () => {
    const c = await editorClient('editor_labak');
    const { error } = await c.schema('api').from('entries').select('*');
    expect(error?.code).toBe('PGRST205'); // relation not found in the schema cache
  });

  it('A1: GraphQL endpoint is unavailable', async () => {
    for (const headers of [await authHeaders('editor_labak'), await authHeaders('anon')]) {
      const res = await fetch(`${env.apiUrl}/graphql/v1`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: '{"query":"{__typename}"}',
      });
      expect(res.ok).toBe(false);
    }
  });
});

describe('A2: invoker api functions write cms under RLS and column grants', () => {
  let assetId: string;
  beforeAll(async () => {
    assetId = await registerAsset('editor_labak', TENANT.labak);
  });

  it('A2: create_entry and save_draft work over REST, and refs are written by trigger', async () => {
    const c = await editorClient('editor_labak');
    const { data: id, error: createError } = await c.schema('api').rpc('create_entry', {
      p_tenant_id: TENANT.labak,
      p_type: 'news',
    });
    expect(createError).toBeNull();
    const { data: v, error: saveError } = await c.schema('api').rpc('save_draft', {
      p_entry_id: id,
      p_expected_version: 1,
      p_data: { image: { _ref: assetId, _kind: 'asset', alt: 'x' } },
      p_schema_version: 1,
      p_title: 'T',
      p_sort_at: null,
    });
    expect(saveError).toBeNull();
    expect(v).toBe(2);
    expect(await countDraftRefs(id)).toBe(1);
  });

  it('A2: the actor triggers record the caller, whatever the payload says', async () => {
    const c = await editorClient('editor_labak');
    const { data: id } = await c.schema('api').rpc('create_entry', { p_tenant_id: TENANT.labak, p_type: 'news' });
    const rows = await ownerQuery<{ created_by: string; updated_by: string; actions: string[] }>(
      `select e.created_by, d.updated_by,
              (select array_agg(a.action order by a.at) from cms.audit_log a where a.target_id = e.id) as actions
       from cms.entries e join cms.drafts d on d.entry_id = e.id where e.id = $1`,
      [id],
    );
    expect(rows[0]).toMatchObject({ created_by: PERSONAS.editor_labak.id, updated_by: PERSONAS.editor_labak.id });
    expect(rows[0]?.actions).toContain('entry.created');
  });

  it('A2: the api views show the caller its own tenant only', async () => {
    const labak = await (await editorClient('editor_labak')).schema('api').from('entry_list').select('tenant_id');
    expect(labak.error).toBeNull();
    expect(new Set(labak.data?.map((r) => r.tenant_id))).toEqual(new Set([TENANT.labak]));
    const demo = await (await editorClient('editor_demo')).schema('api').from('my_tenants').select('id');
    expect(demo.data?.map((r) => r.id)).toEqual([TENANT.demo]);
  });

  it('A2: an editor of another tenant, an outsider and a revoked member are refused', async () => {
    const c = await editorClient('editor_labak');
    const { data: id } = await c.schema('api').rpc('create_entry', { p_tenant_id: TENANT.labak, p_type: 'news' });
    for (const persona of ['editor_demo', 'outsider', 'revoked'] as const) {
      const other = await editorClient(persona);
      const save = await other.schema('api').rpc('save_draft', {
        p_entry_id: id, p_expected_version: 1, p_data: { title: 'x' }, p_schema_version: 1, p_title: 'x', p_sort_at: null,
      });
      expect(save.error).toMatchObject({ code: 'P0001', message: 'not_found' });
      const create = await other.schema('api').rpc('create_entry', { p_tenant_id: TENANT.labak, p_type: 'news' });
      expect(create.error).toMatchObject({ code: 'P0001', message: 'not_found' });
    }
    expect((await ownerQuery<{ version: number }>('select version from cms.drafts where entry_id = $1', [id]))[0]?.version).toBe(1);
  });

  it('A2: a reference to another tenant\'s asset fails the write', async () => {
    const demoAsset = await registerAsset('editor_demo', TENANT.demo);
    const c = await editorClient('editor_labak');
    const { data: id } = await c.schema('api').rpc('create_entry', { p_tenant_id: TENANT.labak, p_type: 'news' });
    const { error } = await c.schema('api').rpc('save_draft', {
      p_entry_id: id, p_expected_version: 1, p_data: { image: { _ref: demoAsset, _kind: 'asset' } },
      p_schema_version: 1, p_title: 'T', p_sort_at: null,
    });
    expect(error).not.toBeNull();
    expect(await countDraftRefs(id)).toBe(0);
  });

  it('A2: anon cannot call editor functions or read the views', async () => {
    const a = anonClient();
    expect((await a.schema('api').rpc('create_entry', { p_tenant_id: TENANT.labak, p_type: 'news' })).error?.code).toBe('42501');
    expect((await a.schema('api').from('entry_list').select('*')).error?.code).toBe('42501');
  });
});

describe('A3: worker and admin functions are for the secret key only', () => {
  it('A3: worker functions refuse editors and accept the secret key', async () => {
    const e = await editorClient('editor_labak');
    expect((await e.schema('api').rpc('worker_claim_requests', { p_limit: 1 })).error?.code).toBe('42501');
    expect((await secretClient().schema('api').rpc('worker_claim_requests', { p_limit: 1 })).error).toBeNull();
  });

  it.each([
    ['worker_claim_requests', { p_limit: 1 }],
    ['worker_read_request', { p_request_id: randomUUID() }],
    ['worker_commit_publish', { p_request_id: randomUUID(), p_validated_draft_version: 1, p_validated_schema_version: 1, p_title: 'T', p_sort_at: null }],
    ['worker_commit_unpublish', { p_request_id: randomUUID() }],
    ['worker_reject_request', { p_request_id: randomUUID(), p_status: 'failed', p_error: {} }],
    ['worker_begin_release', { p_tenant_id: TENANT.labak }],
    ['worker_release_snapshot', { p_release_id: randomUUID() }],
    ['worker_finish_release', { p_release_id: randomUUID(), p_status: 'failed', p_bundle_path: null, p_error: {}, p_request_ids: [], p_public_assets: [] }],
    ['worker_previous_release', { p_tenant_id: TENANT.labak }],
    ['worker_sites', { p_tenant_id: TENANT.labak }],
    ['worker_record_delivery', { p_release_id: randomUUID(), p_site_id: randomUUID(), p_notify_status: 'sent', p_live_status: 'pending', p_error: null }],
    ['admin_create_tenant', { p_slug: 'x-a3', p_name: 'x' }],
    ['admin_create_site', { p_tenant_id: TENANT.labak, p_base_url: 'http://x', p_revalidate_url: 'http://x', p_preview_url: null, p_webhook_secret: 's' }],
    ['admin_add_membership', { p_tenant_id: TENANT.labak, p_user_id: PERSONAS.outsider.id }],
  ] as const)('A3: %s is refused for anon and every editor persona (42501)', async (fn, args) => {
    for (const persona of ['anon', 'editor_labak', 'editor_demo', 'outsider', 'revoked', 'platform_admin'] as const) {
      const c = persona === 'anon' ? anonClient() : await editorClient(persona);
      const { error } = await c.schema('api').rpc(fn, args);
      expect(error?.code, `${fn} as ${persona}`).toBe('42501');
    }
  });

  it('A3: the secret key reaches the worker read functions', async () => {
    const s = secretClient().schema('api');
    expect((await s.rpc('worker_previous_release', { p_tenant_id: TENANT.labak })).error).toBeNull();
    const sites = await s.rpc('worker_sites', { p_tenant_id: TENANT.demo });
    expect(sites.error).toBeNull();
    expect(sites.data?.length).toBeGreaterThan(0);
  });

  it('A3: the secret key is refused the editor functions (no EXECUTE for service_role)', async () => {
    const { error } = await secretClient().schema('api').rpc('create_entry', { p_tenant_id: TENANT.labak, p_type: 'news' });
    expect(error?.code).toBe('42501');
  });
});

// Deferred Minor (Task 10): deleting an auth user who holds memberships through
// the Auth admin API. Supabase Auth deletes as supabase_auth_admin; the foreign
// key cascades to cms.memberships, but the memberships AFTER DELETE audit
// trigger is SECURITY INVOKER and runs as supabase_auth_admin, which has no
// USAGE on cms (spec §4.5), so its insert into cms.audit_log fails with 42501
// and the whole deletion rolls back (observed 2026-11-02: Auth 500 "Database
// error deleting user"; database log "permission denied for schema cms" on the
// membership.removed insert). It fails closed: nothing is deleted and nothing
// goes unaudited. Removing the memberships first, then the user, works. Pinned
// as observed; the triggers are not changed here (reported to the controller).
describe('Auth admin user deletion with memberships (Task 10 deferred Minor)', () => {
  it('deleting a user who holds a membership fails closed; after the membership is removed it succeeds', async () => {
    const s = secretClient();
    const email = `delete-${randomUUID()}@test.local`;
    const created = await s.auth.admin.createUser({ email, email_confirm: true });
    expect(created.error).toBeNull();
    const userId = created.data.user!.id;
    expect((await s.schema('api').rpc('admin_add_membership', { p_tenant_id: TENANT.labak, p_user_id: userId })).error).toBeNull();

    const refused = await s.auth.admin.deleteUser(userId);
    expect(refused.error).toMatchObject({ status: 500, message: 'Database error deleting user' });
    expect(await ownerQuery('select 1 from auth.users where id = $1', [userId])).toHaveLength(1);
    expect(await ownerQuery('select 1 from cms.memberships where user_id = $1', [userId])).toHaveLength(1);

    // As an operator would: remove the membership first (audited), then the user.
    await ownerQuery('delete from cms.memberships where user_id = $1', [userId]);
    const deleted = await s.auth.admin.deleteUser(userId);
    expect(deleted.error).toBeNull();
    expect(await ownerQuery('select 1 from auth.users where id = $1', [userId])).toEqual([]);
    const audit = await ownerQuery<{ action: string; actor_id: string | null; tenant_id: string }>(
      `select action, actor_id, tenant_id from cms.audit_log
       where target_type = 'membership' and target_id = $1 order by at, id`,
      [userId],
    );
    expect(audit).toEqual([
      { action: 'system.membership.added', actor_id: null, tenant_id: TENANT.labak },
      { action: 'system.membership.removed', actor_id: null, tenant_id: TENANT.labak },
    ]);
  });
});
