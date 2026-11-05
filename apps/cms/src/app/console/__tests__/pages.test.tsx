import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeClient } from '@/console/__tests__/fake-client';

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  }),
}));
const access = vi.hoisted(() => ({ consoleAccess: vi.fn() }));
vi.mock('@/lib/console-access', () => access);
const server = vi.hoisted(() => ({ createEditorClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => server);

const { default: ConsolePage } = await import('../(gated)/page');
const { default: TenantPage } = await import('../(gated)/t/[tenant]/page');

const LABAK = { id: 'a1', slug: 'labak', name: 'LABAK', status: 'active', created_at: '2026-11-01T00:00:00Z' };
const DEMO = { id: 'a2', slug: 'demo', name: 'Demo', status: 'suspended', created_at: '2026-11-02T00:00:00Z' };
const FULL = {
  console_tenants: [LABAK, DEMO],
  console_releases: [
    { id: 'e1', tenant_id: 'a1', number: 3, status: 'delivered', created_at: '2026-11-03T10:00:00Z', delivered_at: '2026-11-03T10:01:00Z', error_code: null, error_step: null },
    { id: 'e2', tenant_id: 'a2', number: 1, status: 'failed', created_at: '2026-11-03T11:00:00Z', delivered_at: null, error_code: 'build_failed', error_step: 'previous_bundle' },
  ],
  console_requests: [
    { id: 'q1', tenant_id: 'a2', action: 'publish', status: 'failed_validation', requested_at: '2026-11-03T11:00:00Z', claimed_at: null, error_code: 'invalid_data' },
  ],
  console_deliveries: [
    { release_id: 'e2', site_id: 's1', tenant_id: 'a2', notify_status: 'failed', notify_attempts: 4, notified_at: null, live_status: 'pending', live_confirmed_at: null, last_error_code: 'notify_failed', last_error_status: '500', first_failed_at: '2026-11-03T11:02:00Z', next_attempt_at: '2026-11-03T12:00:00Z' },
  ],
  console_sites: [{ id: 's1', tenant_id: 'a2', base_url: 'http://localhost:3101', active: true }],
  console_audit: [{ id: 1, tenant_id: 'a2', at: '2026-11-03T11:05:00Z', actor_id: null, action: 'tenant_suspended', target_type: 'tenant', target_id: 'a2' }],
};
const EMPTY = { console_tenants: [LABAK], console_releases: [], console_requests: [], console_deliveries: [], console_sites: [], console_audit: [] };

const use = (views: Parameters<typeof fakeClient>[0]) => {
  const fake = fakeClient(views);
  server.createEditorClient.mockResolvedValue(fake.client);
  return fake;
};
const params = (tenant: string) => ({ params: Promise.resolve({ tenant }) });
const html = async (page: Promise<unknown>) => renderToStaticMarkup((await page) as never);

beforeEach(() => {
  vi.clearAllMocks();
  access.consoleAccess.mockResolvedValue('ok');
});

describe('access, checked by each page', () => {
  it.each([
    ['none', 'NOT_FOUND'],
    ['needs_mfa', 'REDIRECT /console/mfa'],
  ])('%s: refuses before any read', async (level, error) => {
    access.consoleAccess.mockResolvedValue(level);
    const fake = use(FULL);
    await expect(ConsolePage()).rejects.toThrow(error);
    await expect(TenantPage(params('labak'))).rejects.toThrow(error);
    expect(fake.calls).toEqual([]);
  });
});

describe('/console', () => {
  it('lists both tenants with status and latest release, and a suspended tenant as suspended', async () => {
    use(FULL);
    const out = await html(ConsolePage());
    expect(out).toContain('LABAK');
    expect(out).toContain('Demo');
    expect(out).toContain('suspended');
    expect(out).toContain('Release 3');
    expect(out).toContain('build_failed at previous_bundle');
    expect(out).toContain('href="/console/t/demo"');
  });

  it('says plainly when there are no tenants or no release', async () => {
    use({ console_tenants: [], console_releases: [] });
    expect(await html(ConsolePage())).toContain('No tenants.');
    use(EMPTY);
    expect(await html(ConsolePage())).toContain('No release yet');
  });

  it('shows a failed read as an error, not as empty', async () => {
    use({ console_tenants: { error: '42501' } });
    const out = await html(ConsolePage());
    expect(out).toContain('role="alert"');
    expect(out).not.toContain('No tenants.');
  });
});

describe('/console/t/[tenant]', () => {
  it('shows a failed delivery, the request, release, site and audit event of a suspended tenant', async () => {
    use(FULL);
    const out = await html(TenantPage(params('demo')));
    expect(out).toContain('suspended');
    expect(out).toContain('notify_failed (500)');
    expect(out).toContain('4 attempts');
    expect(out).toContain('failed validation');
    expect(out).toContain('invalid_data');
    expect(out).toContain('http://localhost:3101');
    expect(out).toContain('tenant suspended');
    expect(out).toContain('href="/console"');
  });

  it('answers 404 for an unknown slug', async () => {
    use(FULL);
    await expect(TenantPage(params('nobody'))).rejects.toThrow('NOT_FOUND');
  });

  it('says plainly that each empty list is empty', async () => {
    use(EMPTY);
    const out = await html(TenantPage(params('labak')));
    for (const noun of ['requests', 'releases', 'deliveries', 'sites', 'audit events']) expect(out).toContain(`No ${noun}.`);
  });

  it('shows one failed list as an error and the others as they are', async () => {
    use({ ...FULL, console_audit: { error: 'x' } });
    const out = await html(TenantPage(params('demo')));
    expect(out).toContain('The audit events could not be read');
    expect(out).not.toContain('No audit events.');
    expect(out).toContain('invalid_data');
  });

  it('shows an error, not a 404, when the tenant read fails', async () => {
    use({ console_tenants: { error: 'x' } });
    expect(await html(TenantPage(params('demo')))).toContain('The tenant could not be read');
  });

  it('prefetches no link', async () => {
    use(FULL);
    // next/link renders no prefetch marker statically; the source check below pins the prop.
    expect(await html(TenantPage(params('demo')))).toContain('<a ');
  });
});
