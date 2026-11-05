// The platform_admin persona's steps for apps/cms/e2e/console.spec.ts, and a throwaway account's for
// sign-in-sessions.spec.ts, on the LOCAL stack only
// (env.ts refuses any host that is not loopback). They need the secret key, which the browser tests
// never hold, so the spec starts this file with `node`. Each step prints one line of JSON and no
// secret:
//   reset             removes the persona's MFA factors and sessions, so a rerun enrols from nothing;
//   factors           counts its verified and unverified factors;
//   password-sign-in  gives it a random password, tries it on Auth and reports the answer.
import { randomBytes } from 'node:crypto';
import { adminAuth, auth, generateLinkSession } from '../src/auth-api.ts';
import { PERSONAS } from '../src/fixtures.ts';
import { closeAll, ownerQuery } from '../src/sql.ts';
// Also: arrange-pages and clean-pages, the fixtures of console-pages.spec.ts (M4-05);
// arrange-email-change, address-of <id> and remove-user <id>, those of sign-in-sessions.spec.ts (M5-03);
// arrange-overview <state>, clean-overview, revoke-status-read and grant-status-read, those of the
// tenant overview's screenshots in design.spec.ts.

const { id, email } = PERSONAS.platform_admin;
/** The module tenant of the overview's fixture; nothing seeds it, so the slug is free. */
const OVERVIEW_TENANT = 'm4-probe';

type Factor = { id: string; status: string };

async function listFactors(): Promise<Factor[]> {
  const user = await adminAuth(`/admin/users/${id}`, { method: 'GET' });
  if (user.status !== 200) throw new Error(`reading the admin answered ${user.status}`);
  return (user.json.factors ?? []) as Factor[];
}

const steps: Record<string, (arg?: string) => Promise<unknown>> = {
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
  // a failed release and a failed delivery, and a suspended tenant with nothing. The suspended one is
  // named "paused", so only its status says "suspended". Rows of their own, so no seeded tenant
  // changes state. Rerunnable: it clears first.
  async 'arrange-pages'() {
    await steps['clean-pages']!();
    const [active] = await ownerQuery<{ id: string }>(
      `insert into cms.tenants (slug, name) values ('console-fixture', 'Console fixture') returning id`,
    );
    await ownerQuery(`insert into cms.tenants (slug, name, status) values ('console-paused', 'Console paused', 'suspended')`);
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
    const ids = `(select id from cms.tenants where slug in ('console-fixture', 'console-paused'))`;
    for (const table of ['site_deliveries', 'publish_requests', 'releases', 'entries', 'sites']) {
      await ownerQuery(`delete from cms.${table} where tenant_id in ${ids}`);
    }
    // The audit events the fixture's inserts caused (triggers write them, §4.7).
    await ownerQuery(`delete from cms.audit_log where tenant_id in ${ids}`);
    await ownerQuery(`delete from cms.tenants where slug in ('console-fixture', 'console-paused')`);
    return { cleaned: true };
  },

  // The tenant overview's states (design.spec.ts) that no seeded tenant can hold on demand: its demo
  // tenant has changes and old failures from every run. A tenant of the m4-probe module, so the page
  // has a real structure; no seeded tenant changes. editor_demo is a member only while it exists.
  // `nothing-proven`: an active site and two drafts. `proven`: one of them published, every site
  // confirmed. `no-site`: the same with its site inactive. Rerunnable: it clears first.
  async 'arrange-overview'(state) {
    if (state !== 'nothing-proven' && state !== 'proven' && state !== 'no-site') throw new Error(`unknown state: ${state}`);
    await steps['clean-overview']!();
    const editor = PERSONAS.editor_demo.id;
    const [tenant] = await ownerQuery<{ id: string }>(`insert into cms.tenants (slug, name) values ($1, 'M4 probe') returning id`, [OVERVIEW_TENANT]);
    const tenantId = tenant!.id;
    await ownerQuery('insert into cms.memberships (tenant_id, user_id) values ($1, $2)', [tenantId, editor]);
    const [site] = await ownerQuery<{ id: string }>(
      `insert into cms.sites (tenant_id, base_url, revalidate_url, webhook_secret_ref, active)
       values ($1, 'http://localhost:3299/overview', 'http://localhost:3299/overview/revalidate', gen_random_uuid(), $2) returning id`,
      [tenantId, state !== 'no-site'],
    );
    const entry = async (type: string, title: string, singleton: boolean): Promise<string> => {
      const [row] = await ownerQuery<{ id: string }>(
        `insert into cms.entries (tenant_id, type, slug, singleton, created_by) values ($1, $2, $3, $4, $5) returning id`,
        [tenantId, type, singleton ? null : `overview-${randomBytes(4).toString('hex')}`, singleton, editor],
      );
      await ownerQuery(
        `insert into cms.drafts (entry_id, tenant_id, schema_version, data, title, updated_by) values ($1, $2, 1, $3, $4, $5)`,
        [row!.id, tenantId, { title }, title, editor],
      );
      return row!.id;
    };
    const event = await entry('event', 'Opnunarhátíð vorsins', false);
    await entry('event', 'Sumarhátíð', false);
    await entry('site-info', 'Upplýsingar', true);
    if (state === 'nothing-proven') return { arranged: state };
    const [revision] = await ownerQuery<{ id: string }>(
      `insert into cms.revisions (tenant_id, entry_id, draft_version, schema_version, data, title, requested_by)
       values ($1, $2, 1, 1, $3, 'Opnunarhátíð vorsins', $4) returning id`,
      [tenantId, event, { title: 'Opnunarhátíð vorsins' }, editor],
    );
    await ownerQuery(
      `update cms.entries set published_rev_id = $2, published_draft_version = 1, first_published_at = now(), last_published_at = now() where id = $1`,
      [event, revision!.id],
    );
    const [release] = await ownerQuery<{ id: string }>(
      `insert into cms.releases (tenant_id, number, status, delivered_at) values ($1, 1, 'delivered', now()) returning id`,
      [tenantId],
    );
    await ownerQuery(
      `insert into cms.publish_requests (tenant_id, entry_id, action, draft_version, requested_by, status, revision_id, release_id)
       values ($1, $2, 'publish', 1, $3, 'committed', $4, $5)`,
      [tenantId, event, editor, revision!.id, release!.id],
    );
    await ownerQuery(
      `insert into cms.site_deliveries (release_id, site_id, tenant_id, notify_status, live_status, live_confirmed_at)
       values ($1, $2, $3, 'ok', 'ok', now())`,
      [release!.id, site!.id, tenantId],
    );
    return { arranged: state };
  },

  async 'clean-overview'() {
    const ids = `(select id from cms.tenants where slug = '${OVERVIEW_TENANT}')`;
    await ownerQuery(`update cms.entries set published_rev_id = null where tenant_id in ${ids}`);
    for (const table of ['site_deliveries', 'publish_requests', 'releases', 'revisions', 'drafts', 'entries', 'sites', 'memberships']) {
      await ownerQuery(`delete from cms.${table} where tenant_id in ${ids}`);
    }
    await ownerQuery(`delete from cms.audit_log where tenant_id in ${ids}`);
    await ownerQuery(`delete from cms.tenants where slug = '${OVERVIEW_TENANT}'`);
    return { cleaned: true };
  },

  // A real failed read for the overview, which reads on the server, where a browser route cannot
  // reach. The seed heals a run killed in between (tests/integration/src/seed.ts).
  async 'revoke-status-read'() {
    await ownerQuery('revoke select on api.publication_status from authenticated');
    return { revoked: true };
  },

  async 'grant-status-read'() {
    await ownerQuery('grant select on api.publication_status to authenticated');
    return { granted: true };
  },

  // M5-03: a throwaway account, because an email change moves the address, with a change requested.
  // Auth has mailed both addresses; the spec answers the mails. The session used here is not printed.
  async 'arrange-email-change'() {
    const stamp = randomBytes(6).toString('hex');
    const [oldAddress, newAddress] = [`m503-old-${stamp}@test.local`, `m503-new-${stamp}@test.local`];
    const created = await adminAuth('/admin/users', { body: { email: oldAddress, email_confirm: true } });
    if (created.status !== 200) throw new Error(`creating the account answered ${created.status}`);
    const session = await generateLinkSession(oldAddress, 'magiclink');
    const change = await auth('/user', { method: 'PUT', token: session.json.access_token, body: { email: newAddress } });
    if (change.status !== 200) throw new Error(`requesting the change answered ${change.status}`);
    return { id: created.json.id as string, oldAddress, newAddress };
  },

  async 'address-of'(userId) {
    const user = await adminAuth(`/admin/users/${userId}`, { method: 'GET' });
    if (user.status !== 200) throw new Error(`reading the account answered ${user.status}`);
    return { email: user.json.email as string };
  },

  async 'remove-user'(userId) {
    const removed = await adminAuth(`/admin/users/${userId}`, { method: 'DELETE' });
    if (removed.status !== 200) throw new Error(`removing the account answered ${removed.status}`);
    return { removed: true };
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
  console.log(JSON.stringify(await step(process.argv[3])));
} catch (error) {
  console.error('console-admin failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeAll();
}
