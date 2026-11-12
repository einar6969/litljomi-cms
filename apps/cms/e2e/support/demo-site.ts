// The demo tenant's site as the publish e2e runs it (plan Task 25): the seeded demo site's URL and
// webhook secret (copied from tests/integration/src/fixtures.ts DEMO_SITE, which app code may not
// import), and the local stack's public delivery bucket it reads. Loopback only. The port is the
// stack slot's (tools/stack/slot.ts; 3101 on slot 1), as is fixtures.ts DEMO_SITE's.
import { STACK, SUPABASE_URL } from './local.ts';

export const DEMO_SITE_PORT = STACK.ports.demoSite;
/** The seeded `cms.sites.base_url` of the demo tenant; the worker notifies and live-checks it. */
export const DEMO_SITE_URL = STACK.demoSiteUrl;
/** The seeded webhook secret (local test value; seedIntegration stores it in the local Vault). */
export const DEMO_SITE_WEBHOOK_SECRET = 's3cr3t';
/** The seeded preview secret (M3-12; DEMO_SITE.previewSecret, a local test value in the local Vault). */
export const DEMO_SITE_PREVIEW_SECRET = 'demo-preview-s3cr3t-local-test-value-0123';
export const DEMO_DELIVERY_BASE_URL = `${SUPABASE_URL}/storage/v1/object/public/delivery`;
/** next.config.ts needs an https media host; the demo events published here have no images. */
export const DEMO_SITE_MEDIA_HOST = 'media.example.test';
/** The line demo-site-server.ts prints once its checks pass; Playwright's webServer waits for it. */
export const DEMO_SITE_READY_LINE = 'demo-site: waiting for the demo tenant’s current release';
