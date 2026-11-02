// `pnpm seed:labak-site`: by hand, on the LOCAL stack only, gives the seeded labak tenant an active
// site that points at the LABAK site running locally (LABAK_LOCAL_SITE), so the worker notifies it
// and live-checks it. Not run by any suite; `pnpm db:reset` removes the site. Like seed-local.ts it
// reads the stack's keys through env.ts (decisions 36.6 and 37.5, local tests only), which refuses
// any host that is not loopback. Run `pnpm seed:local` first so the labak tenant exists. Idempotent.
import { secretClient } from '../src/clients.ts';
import { LABAK_LOCAL_SITE, TENANT } from '../src/fixtures.ts';
import { closeAll, ownerQuery } from '../src/sql.ts';

try {
  const tenant = await ownerQuery('select 1 from cms.tenants where id = $1', [TENANT.labak]);
  if (tenant.length === 0) throw new Error('the labak tenant is not seeded; run `pnpm seed:local` first');
  const sites = await ownerQuery('select 1 from cms.sites where tenant_id = $1 and base_url = $2', [TENANT.labak, LABAK_LOCAL_SITE.baseUrl]);
  if (sites.length > 0) {
    console.log(`seed:labak-site: labak already has the site ${LABAK_LOCAL_SITE.baseUrl}`);
  } else {
    const { error } = await secretClient().schema('api').rpc('admin_create_site', {
      p_tenant_id: TENANT.labak,
      p_base_url: LABAK_LOCAL_SITE.baseUrl,
      p_revalidate_url: LABAK_LOCAL_SITE.revalidateUrl,
      p_preview_url: null,
      p_webhook_secret: LABAK_LOCAL_SITE.webhookSecret,
    });
    if (error) throw new Error(`admin_create_site: ${error.code} ${error.message}`);
    console.log(`seed:labak-site: labak now has the site ${LABAK_LOCAL_SITE.baseUrl}`);
  }
} catch (error) {
  console.error('seed:labak-site failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeAll();
}
