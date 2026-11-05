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
  console_deliveries: rows(60, (i) => ({ release_id: `u${59 - i}`, release_number: i + 1, site_id: 's', tenant_id: T1, notified_at: i === 0 ? null : `2026-11-01T00:${String(i).padStart(2, '0')}:00Z` })),
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
    expect(calls.map((c) => c.view).sort()).toEqual(['console_audit', 'console_deliveries', 'console_releases', 'console_releases', 'console_requests', 'console_sites', 'console_tenants', 'console_tenants']);
    // In call order: tenants, tenant by slug, latest release, then the detail's five.
    expect(calls.map((c) => c.limit)).toEqual([LIMIT, 1, 1, LIMIT, LIMIT, LIMIT, LIMIT, LIMIT]);
    for (const call of calls) {
      expect(call.view).toMatch(/^console_(tenants|requests|releases|sites|deliveries|audit)$/);
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

  it('order each list as pinned', async () => {
    const { client, calls } = fakeClient(ALL);
    await tenantDetail(T1, asClient(client));
    const orders = Object.fromEntries(calls.map((c) => [c.view, c.orders]));
    expect(orders.console_requests).toEqual([{ column: 'requested_at', ascending: false }, { column: 'id', ascending: true }].map((o) => ({ ...o, nullsFirst: undefined })));
    expect(orders.console_releases).toEqual([{ column: 'number', ascending: false, nullsFirst: undefined }]);
    expect(orders.console_sites).toEqual([{ column: 'base_url', ascending: true, nullsFirst: undefined }]);
    expect(orders.console_audit?.[0]).toEqual({ column: 'at', ascending: false, nullsFirst: undefined });
    expect(orders.console_deliveries?.[0]).toEqual({ column: 'release_number', ascending: false, nullsFirst: undefined });
    expect(orders.console_deliveries?.[1]).toEqual({ column: 'site_id', ascending: true, nullsFirst: undefined });
  });

  it('read the 50 newest deliveries by release number in one query, never-notified ones included', async () => {
    // Release ids run opposite to numbers, so ordering by id would return the oldest.
    const { client, calls } = fakeClient(ALL);
    const detail = await tenantDetail(T1, asClient(client));
    if (!detail.deliveries.ok) throw new Error('read failed');
    expect(detail.deliveries.rows).toHaveLength(50);
    expect(detail.deliveries.rows[0]?.release_number).toBe(60);
    expect(detail.deliveries.rows.at(-1)?.release_number).toBe(11);
    expect(calls.filter((c) => c.view === 'console_deliveries')).toHaveLength(1);
  });

  it('do not let an old never-notified delivery hide a newer one', async () => {
    const views = {
      ...ALL,
      console_deliveries: [
        { release_id: 'z', release_number: 1, site_id: 's', tenant_id: T1, notified_at: null },
        { release_id: 'a', release_number: 2, site_id: 's', tenant_id: T1, notified_at: '2026-11-01T00:00:00Z' },
      ],
    };
    const detail = await tenantDetail(T1, asClient(fakeClient(views).client));
    expect(detail.deliveries.ok && detail.deliveries.rows.map((r) => r.release_number)).toEqual([2, 1]);
  });

  it('latestReleases returns the newest release, not the first or the oldest', async () => {
    const views = { console_releases: [{ id: 'a', tenant_id: T1, number: 2 }, { id: 'b', tenant_id: T1, number: 1 }, { id: 'c', tenant_id: T1, number: 3 }] };
    const result = await latestReleases([T1], asClient(fakeClient(views).client));
    expect(result.ok && result.rows.map((r) => r.number)).toEqual([3]);
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
