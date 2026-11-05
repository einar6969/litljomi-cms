import 'server-only';
import { createEditorClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@/lib/supabase/types';

// The console's reads (§8.4). Only the `api.console_*` views, through the signed-in admin's client:
// no secret key. The views have no order, so every read sets its own, and a limit. A failed read is
// `ok: false`, never an empty list.

/** How many rows of each list one page asks for. */
export const LIMIT = 50;

export type Read<T> = { ok: true; rows: T[] } | { ok: false };

export type Tenant = { id: string; slug: string; name: string; status: string; created_at: string };
export type Release = {
  id: string;
  tenant_id: string;
  number: number;
  status: string;
  created_at: string;
  delivered_at: string | null;
  error_code: string | null;
  error_step: string | null;
};
export type Request = {
  id: string;
  tenant_id: string;
  action: string;
  status: string;
  requested_at: string;
  claimed_at: string | null;
  error_code: string | null;
};
export type Delivery = {
  release_id: string;
  site_id: string;
  tenant_id: string;
  notify_status: string;
  notify_attempts: number;
  notified_at: string | null;
  live_status: string;
  live_confirmed_at: string | null;
  last_error_code: string | null;
  last_error_status: string | null;
  first_failed_at: string | null;
  next_attempt_at: string | null;
};
export type Site = { id: string; tenant_id: string; base_url: string; active: boolean };
export type AuditEvent = {
  id: string | number;
  tenant_id: string | null;
  at: string;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
};

async function read<T>(
  query: PromiseLike<{ data: unknown[] | null; error: { code?: string } | null }>,
  view: string,
): Promise<Read<T>> {
  try {
    const { data, error } = await query;
    if (error || !data) {
      console.error(`console read failed: ${view}: ${error?.code ?? 'no data'}`);
      return { ok: false };
    }
    return { ok: true, rows: data as T[] };
  } catch {
    console.error(`console read failed: ${view}`);
    return { ok: false };
  }
}

/** The tenants, by slug (a name list, not a history). */
export async function listTenants(client?: SupabaseClient): Promise<Read<Tenant>> {
  const c = client ?? (await createEditorClient());
  return read(c.from('console_tenants').select('*').order('slug', { ascending: true }).limit(LIMIT), 'console_tenants');
}

/** A tenant by slug: `null` when there is none. */
export async function findTenant(slug: string, client?: SupabaseClient): Promise<{ ok: true; tenant: Tenant | null } | { ok: false }> {
  const c = client ?? (await createEditorClient());
  const result = await read<Tenant>(c.from('console_tenants').select('*').eq('slug', slug).order('slug').limit(1), 'console_tenants');
  return result.ok ? { ok: true, tenant: result.rows[0] ?? null } : { ok: false };
}

/** The newest release of each tenant, by release number. A failed read for any tenant fails all. */
export async function latestReleases(tenantIds: string[], client?: SupabaseClient): Promise<Read<Release>> {
  const c = client ?? (await createEditorClient());
  const reads = await Promise.all(
    tenantIds.map((id) =>
      read<Release>(c.from('console_releases').select('*').eq('tenant_id', id).order('number', { ascending: false }).limit(1), 'console_releases'),
    ),
  );
  const rows: Release[] = [];
  for (const result of reads) {
    if (!result.ok) return { ok: false };
    rows.push(...result.rows);
  }
  return { ok: true, rows };
}

export type TenantDetail = {
  requests: Read<Request>;
  releases: Read<Release>;
  deliveries: Read<Delivery>;
  sites: Read<Site>;
  audit: Read<AuditEvent>;
};

/** One tenant's latest requests, releases, deliveries and audit events (50 each), and its sites. */
export async function tenantDetail(tenantId: string, client?: SupabaseClient): Promise<TenantDetail> {
  const c = client ?? (await createEditorClient());
  const [requests, releases, deliveries, sites, audit] = await Promise.all([
    read<Request>(
      c.from('console_requests').select('*').eq('tenant_id', tenantId).order('requested_at', { ascending: false }).order('id').limit(LIMIT),
      'console_requests',
    ),
    read<Release>(
      c.from('console_releases').select('*').eq('tenant_id', tenantId).order('number', { ascending: false }).limit(LIMIT),
      'console_releases',
    ),
    // No delivery has a creation time: not yet notified (null) comes first, then the latest notified.
    read<Delivery>(
      c.from('console_deliveries').select('*').eq('tenant_id', tenantId)
        .order('notified_at', { ascending: false, nullsFirst: true }).order('release_id', { ascending: false }).order('site_id').limit(LIMIT),
      'console_deliveries',
    ),
    read<Site>(c.from('console_sites').select('*').eq('tenant_id', tenantId).order('base_url', { ascending: true }).limit(LIMIT), 'console_sites'),
    read<AuditEvent>(
      c.from('console_audit').select('*').eq('tenant_id', tenantId).order('at', { ascending: false }).order('id', { ascending: false }).limit(LIMIT),
      'console_audit',
    ),
  ]);
  return { requests, releases, deliveries, sites, audit };
}
