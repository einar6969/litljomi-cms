import { describe, expect, it, vi } from 'vitest';
import { LIMIT, findTenant, latestReleases, listTenants, tenantDetail } from '../data';
import { fakeClient } from './fake-client';

vi.mock('@/lib/supabase/server', () => ({ createEditorClient: vi.fn() }));

const T1 = 't1';
const rows = (n: number, make: (i: number) => Record<string, unknown>) => Array.from({ length: n }, (_, i) => make(i));
const asClient = (client: unknown) => client as Parameters<typeof listTenants>[0];

const ALL = {
  console_requests: rows(60, (i) => ({ id: `r${i}`, tenant_id: T1, requested_at: `2026-11-01T00:${String(i).padStart(2, '0')}:00Z` })),
  console_releases: rows(60, (i) => ({ id: `e${i}`, tenant_id: T1, number: i + 1 })),
  console_deliveries: rows(60, (i) => ({ release_id: `e${i}`, site_id: 's', tenant_id: T1, notified_at: `2026-11-01T00:${String(i).padStart(2, '0')}:00Z` })),
  console_sites: [{ id: 's', tenant_id: T1, base_url: 'http://x' }],
  console_audit: rows(60, (i) => ({ id: i, tenant_id: T1, at: `2026-11-01T00:${String(i).padStart(2, '0')}:00Z` })),
  console_tenants: [{ id: T1, slug: 'one' }],
};

describe('the console reads', () => {
  it('read only console_* views, each with an order and a limit', async () => {
    const { client, calls } = fakeClient(ALL);
    await listTenants(asClient(client));
    await findTenant('one', asClient(client));
    await latestReleases([T1], asClient(client));
    await tenantDetail(T1, asClient(client));
    expect(calls.length).toBe(8);
    for (const call of calls) {
      expect(call.view).toMatch(/^console_(tenants|requests|releases|sites|deliveries|audit)$/);
      expect(call.limit, call.view).toBeLessThanOrEqual(LIMIT);
      expect(call.orders.length, call.view).toBeGreaterThan(0);
    }
  });

  it('return the latest 50, newest first', async () => {
    const { client } = fakeClient(ALL);
    const detail = await tenantDetail(T1, asClient(client));
    if (!detail.requests.ok || !detail.releases.ok || !detail.audit.ok) throw new Error('read failed');
    expect(detail.requests.rows).toHaveLength(50);
    expect(detail.requests.rows[0]?.id).toBe('r59');
    expect(detail.releases.rows[0]?.number).toBe(60);
    expect(detail.audit.rows[0]?.id).toBe(59);
  });

  it('say a failed read failed, not empty', async () => {
    const { client } = fakeClient({ ...ALL, console_deliveries: { error: '42501' } });
    const detail = await tenantDetail(T1, asClient(client));
    expect(detail.deliveries).toEqual({ ok: false });
    expect(detail.requests.ok).toBe(true);
    expect(await listTenants(asClient(fakeClient({ console_tenants: { error: 'x' } }).client))).toEqual({ ok: false });
  });

  it('fail the latest releases when any tenant read fails', async () => {
    const { client } = fakeClient({ console_releases: { error: 'x' } });
    expect(await latestReleases([T1], asClient(client))).toEqual({ ok: false });
  });

  it('tell an unknown slug from a failed read', async () => {
    expect(await findTenant('nope', asClient(fakeClient(ALL).client))).toEqual({ ok: true, tenant: null });
    expect(await findTenant('one', asClient(fakeClient({ console_tenants: { error: 'x' } }).client))).toEqual({ ok: false });
  });
});
