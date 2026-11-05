// The platform_admin persona's steps for apps/cms/e2e/console.spec.ts, on the LOCAL stack only
// (env.ts refuses any host that is not loopback). They need the secret key, which the browser tests
// never hold, so the spec starts this file with `node`. Each step prints one line of JSON and no
// secret:
//   reset             removes the persona's MFA factors and sessions, so a rerun enrols from nothing;
//   factors           counts its verified and unverified factors;
//   password-sign-in  gives it a random password, tries it on Auth and reports the answer.
import { randomBytes } from 'node:crypto';
import { adminAuth, auth } from '../src/auth-api.ts';
import { PERSONAS } from '../src/fixtures.ts';
import { closeAll, ownerQuery } from '../src/sql.ts';
// Also: arrange-pages and clean-pages, the fixtures of console-pages.spec.ts (M4-05).

const { id, email } = PERSONAS.platform_admin;

type Factor = { id: string; status: string };

async function listFactors(): Promise<Factor[]> {
  const user = await adminAuth(`/admin/users/${id}`, { method: 'GET' });
  if (user.status !== 200) throw new Error(`reading the admin answered ${user.status}`);
  return (user.json.factors ?? []) as Factor[];
}

const steps: Record<string, () => Promise<unknown>> = {
  async reset() {
    for (const factor of await listFactors()) {
      const removed = await adminAuth(`/admin/users/${id}/factors/${factor.id}`, { method: 'DELETE' });
      if (removed.status !== 200) throw new Error(`removing a factor answered ${removed.status}`);
    }
    await ownerQuery('delete from auth.sessions where user_id = $1', [id]);
    return { reset: true };
  },

  async factors() {
    const factors = await listFactors();
    const verified = factors.filter((factor) => factor.status === 'verified').length;
    return { verified, unverified: factors.length - verified };
  },

  // The fixtures of console-pages.spec.ts (M4-05): an active tenant with a site, a failed request,
  // a failed release and a failed delivery, and a suspended tenant with nothing. Rows of their own,
  // so no seeded tenant changes state. Rerunnable: it clears first.
  async 'arrange-pages'() {
    await steps['clean-pages']!();
    const [active] = await ownerQuery<{ id: string }>(
      `insert into cms.tenants (slug, name) values ('console-fixture', 'Console fixture') returning id`,
    );
    await ownerQuery(`insert into cms.tenants (slug, name, status) values ('console-suspended', 'Console suspended', 'suspended')`);
    const tenantId = active!.id;
    const [site] = await ownerQuery<{ id: string }>(
      `insert into cms.sites (tenant_id, base_url, revalidate_url, webhook_secret_ref)
       values ($1, 'http://localhost:3299/fixture', 'http://localhost:3299/fixture/revalidate', gen_random_uuid()) returning id`,
      [tenantId],
    );
    const [entry] = await ownerQuery<{ id: string }>(
      `insert into cms.entries (tenant_id, type, created_by) values ($1, 'news', $2) returning id`,
      [tenantId, PERSONAS.editor_labak.id],
    );
    const [release] = await ownerQuery<{ id: string }>(
      `insert into cms.releases (tenant_id, number, status, error) values ($1, 1, 'failed', $2) returning id`,
      [tenantId, { code: 'build_failed', step: 'previous_bundle' }],
    );
    await ownerQuery(
      `insert into cms.publish_requests (tenant_id, entry_id, action, draft_version, requested_by, status, error)
       values ($1, $2, 'publish', 1, $3, 'failed', $4)`,
      [tenantId, entry!.id, PERSONAS.editor_labak.id, { code: 'invalid_data' }],
    );
    await ownerQuery(
      `insert into cms.site_deliveries (release_id, site_id, tenant_id, notify_status, notify_attempts, last_error)
       values ($1, $2, $3, 'failed', 4, $4)`,
      [release!.id, site!.id, tenantId, { code: 'notify_failed', status: 500 }],
    );
    return { arranged: true };
  },

  async 'clean-pages'() {
    const ids = `(select id from cms.tenants where slug in ('console-fixture', 'console-suspended'))`;
    for (const table of ['site_deliveries', 'publish_requests', 'releases', 'entries', 'sites']) {
      await ownerQuery(`delete from cms.${table} where tenant_id in ${ids}`);
    }
    await ownerQuery(`delete from cms.tenants where slug in ('console-fixture', 'console-suspended')`);
    return { cleaned: true };
  },

  async 'password-sign-in'() {
    const password = randomBytes(24).toString('hex');
    const set = await adminAuth(`/admin/users/${id}`, { method: 'PUT', body: { password } });
    if (set.status !== 200) throw new Error(`setting the password answered ${set.status}`);
    const attempt = await auth('/token?grant_type=password', { body: { email, password } });
    return { status: attempt.status, signedIn: typeof attempt.json.access_token === 'string' };
  },
};

try {
  const step = steps[process.argv[2] ?? ''];
  if (!step) throw new Error(`unknown step: ${process.argv[2]}`);
  console.log(JSON.stringify(await step()));
} catch (error) {
  console.error('console-admin failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeAll();
}
