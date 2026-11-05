// M4-01 over the Data API (spec §4.6, §4.7, §8.2, §8.4): the admin functions run for the secret key
// as the CLI calls them, on a tenant of their own. http-boundary.test.ts refuses them for anon and
// every editor persona; 113_m4_admin.test.sql pins the rest of their behaviour.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { editorClient, secretClient } from './clients.ts';
import { PERSONAS } from './fixtures.ts';
import { closeAll, ownerQuery, withTx } from './sql.ts';

const SLUG = `m4-admin-${randomUUID().slice(0, 8)}`;
const NAME = 'Fyrirtæki M4';
const OLD_SECRET = 'm4-webhook-old-0123456789abcdef0123456789';
const NEW_SECRET = 'm4-webhook-new-0123456789abcdef0123456789';

const admin = (fn: string, args: Record<string, unknown>) => secretClient().schema('api').rpc(fn, args);
async function ok<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin(fn, args);
  if (error) throw new Error(`${fn}: ${error.code} ${error.message}`);
  return data as T;
}

const secrets = () =>
  withTx('service', async (w) => (await w.query<{ webhook_secrets: string[] }>('select webhook_secrets from api.worker_sites($1)', [tenantId])).rows[0]!.webhook_secrets);
const webhookRef = async () => (await ownerQuery<{ ref: string }>('select webhook_secret_ref as ref from cms.sites where id = $1', [siteId]))[0]!.ref;
const events = (action: string, targetId: string) =>
  ownerQuery<{ tenant_id: string; actor_id: string | null; details: unknown }>('select tenant_id, actor_id, details from cms.audit_log where action = $1 and target_id = $2 order by id', [action, targetId]);

let tenantId: string;
let siteId: string;

beforeAll(async () => {
  tenantId = await ok<string>('admin_create_tenant', { p_slug: SLUG, p_name: NAME });
  siteId = await ok<string>('admin_create_site', {
    p_tenant_id: tenantId,
    p_base_url: 'http://localhost:3299',
    p_revalidate_url: 'http://localhost:3299/api/cms/revalidate',
    p_preview_url: null,
    p_webhook_secret: OLD_SECRET,
  });
});
afterAll(async () => {
  await ownerQuery('delete from cms.memberships where tenant_id = $1', [tenantId]);
  await ownerQuery('delete from cms.sites where tenant_id = $1', [tenantId]);
  await ownerQuery('delete from cms.tenants where id = $1', [tenantId]);
  await closeAll();
});

describe('admin functions for the secret key (M4-01)', () => {
  it('admin_create_tenant: a rerun with the same name gives the same id and one row; another name is slug_taken', async () => {
    expect(await ok('admin_create_tenant', { p_slug: SLUG, p_name: NAME })).toBe(tenantId);
    const { error } = await admin('admin_create_tenant', { p_slug: SLUG, p_name: 'Annað nafn' });
    expect(error).toMatchObject({ code: 'P0001', message: 'slug_taken' });
    expect(await ownerQuery('select name from cms.tenants where slug = $1', [SLUG])).toEqual([{ name: NAME }]);
  });

  it('admin_set_webhook_secret: worker_sites returns the new secret and the reference is unchanged; a short secret or an unknown site changes nothing', async () => {
    const ref = await webhookRef();
    expect(await secrets()).toEqual([OLD_SECRET]);

    expect((await admin('admin_set_webhook_secret', { p_site_id: siteId, p_webhook_secret: 'short' })).error).toMatchObject({ code: '22023' });
    expect((await admin('admin_set_webhook_secret', { p_site_id: randomUUID(), p_webhook_secret: NEW_SECRET })).error).toMatchObject({ code: 'P0001', message: 'not_found' });
    expect(await secrets()).toEqual([OLD_SECRET]);

    await ok('admin_set_webhook_secret', { p_site_id: siteId, p_webhook_secret: NEW_SECRET });
    expect(await secrets()).toEqual([NEW_SECRET]);
    expect(await webhookRef()).toBe(ref);
  });

  it('admin_set_tenant_status: each change writes one audit row; a name change writes none', async () => {
    await ok('admin_set_tenant_status', { p_tenant_id: tenantId, p_status: 'suspended' });
    expect(await ownerQuery('select status from cms.tenants where id = $1', [tenantId])).toEqual([{ status: 'suspended' }]);
    await withTx('service', (w) => w.query('update cms.tenants set name = $2 where id = $1', [tenantId, 'Nýtt nafn']));
    await ok('admin_set_tenant_status', { p_tenant_id: tenantId, p_status: 'active' });
    expect(await events('system.tenant.status_changed', tenantId)).toEqual([
      { tenant_id: tenantId, actor_id: null, details: { from: 'active', to: 'suspended' } },
      { tenant_id: tenantId, actor_id: null, details: { from: 'suspended', to: 'active' } },
    ]);
    expect((await admin('admin_set_tenant_status', { p_tenant_id: tenantId, p_status: 'closed' })).error).toMatchObject({ code: '22023' });
    expect((await admin('admin_set_tenant_status', { p_tenant_id: randomUUID(), p_status: 'active' })).error).toMatchObject({ code: 'P0001', message: 'not_found' });
  });

  it('admin_remove_membership: revocation is immediate for a live session and audited; removing it again is a no-op', async () => {
    const user = PERSONAS.outsider.id;
    const tenants = async () => (await (await editorClient('outsider')).schema('api').from('my_tenants').select('id').eq('id', tenantId)).data;
    await ok('admin_add_membership', { p_tenant_id: tenantId, p_user_id: user });
    expect(await tenants()).toEqual([{ id: tenantId }]);

    await ok('admin_remove_membership', { p_tenant_id: tenantId, p_user_id: user });
    expect(await tenants()).toEqual([]);
    await ok('admin_remove_membership', { p_tenant_id: tenantId, p_user_id: user });
    const removals = (await events('system.membership.removed', user)).filter((e) => e.tenant_id === tenantId);
    expect(removals).toHaveLength(1);
    expect((await admin('admin_remove_membership', { p_tenant_id: randomUUID(), p_user_id: user })).error).toMatchObject({ code: 'P0001', message: 'not_found' });
  });
});
