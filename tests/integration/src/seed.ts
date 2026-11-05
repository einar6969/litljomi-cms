// Idempotent seed of the fixed test identities on the local stack (plan Task 12,
// "Fixed test identities").
//
// Deviation from the plan's wording, accepted by the controller (2026-11-02):
// the plan has seedIntegration create tenants through api.admin_*, but
// api.admin_create_tenant(p_slug, p_name) always generates the id, and every
// test layer needs the fixed tenant UUIDs. So:
//   - users: the Auth admin API, with their fixed ids;
//   - tenants: inserted as the owner over the direct connection, as tests.seed() does;
//   - memberships and the demo site: api.admin_add_membership and api.admin_create_site
//     with the secret key, as the provisioning CLI will;
//   - revoked's membership deletion and the cms.platform_admins row: owner SQL,
//     since no admin function covers them.
import { secretClient } from './clients.ts';
import { DEMO_SITE, PERSONAS, PERSONA_NAMES, TENANT } from './fixtures.ts';
import { ownerQuery } from './sql.ts';

export async function seedIntegration(): Promise<void> {
  const secret = secretClient();

  for (const name of PERSONA_NAMES) {
    const { id, email } = PERSONAS[name];
    const exists = await ownerQuery('select 1 from auth.users where id = $1', [id]);
    if (exists.length > 0) continue;
    const { error } = await secret.auth.admin.createUser({ id, email, email_confirm: true });
    if (error) throw new Error(`createUser ${name}: ${error.message}`);
  }

  await ownerQuery(
    // A run killed while a test had suspended labak is healed here (M4-01).
    `insert into cms.tenants (id, slug, name) values ($1, 'labak', 'Landssamband bakarameistara'), ($2, 'demo', 'Demo')
     on conflict (id) do update set status = 'active' where cms.tenants.status <> 'active'`,
    [TENANT.labak, TENANT.demo],
  );

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { error } = await secret.schema('api').rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.code} ${error.message}`);
  };
  for (const name of PERSONA_NAMES) {
    const p: { id: string; membership: keyof typeof TENANT | null } = PERSONAS[name];
    if (p.membership) await rpc('admin_add_membership', { p_tenant_id: TENANT[p.membership], p_user_id: p.id });
  }
  // revoked: a membership that existed and was deleted (once; the audit log keeps both events).
  const revoked = PERSONAS.revoked;
  const removed = await ownerQuery(
    `select 1 from cms.audit_log where action = 'system.membership.removed' and target_id = $1 and tenant_id = $2`,
    [revoked.id, TENANT[revoked.revokedFrom]],
  );
  if (removed.length === 0) {
    await rpc('admin_add_membership', { p_tenant_id: TENANT[revoked.revokedFrom], p_user_id: revoked.id });
  }
  await ownerQuery('delete from cms.memberships where user_id = $1', [revoked.id]);

  await ownerQuery('insert into cms.platform_admins (user_id) values ($1) on conflict do nothing', [PERSONAS.platform_admin.id]);

  const sites = await ownerQuery<{ id: string; preview_url: string | null; preview_secret_ref: string | null }>(
    'select id, preview_url, preview_secret_ref from cms.sites where tenant_id = $1 and base_url = $2',
    [TENANT.demo, DEMO_SITE.baseUrl],
  );
  const site = sites[0];
  if (!site) {
    await rpc('admin_create_site', {
      p_tenant_id: TENANT.demo,
      p_base_url: DEMO_SITE.baseUrl,
      p_revalidate_url: DEMO_SITE.revalidateUrl,
      p_preview_url: DEMO_SITE.previewUrl,
      p_webhook_secret: DEMO_SITE.webhookSecret,
      p_preview_secret: DEMO_SITE.previewSecret,
    });
  } else if (site.preview_url !== DEMO_SITE.previewUrl || site.preview_secret_ref === null) {
    // A stack seeded before M3-12: the demo site gets its preview route and secret.
    await ownerQuery('update cms.sites set preview_url = $2 where id = $1', [site.id, DEMO_SITE.previewUrl]);
    await rpc('admin_set_preview_secret', { p_site_id: site.id, p_preview_secret: DEMO_SITE.previewSecret });
  }
}
