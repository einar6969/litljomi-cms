import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { consoleAccess } from '@/lib/console-access';
import { findTenant, tenantDetail, LIMIT } from '@/console/data';
import { statusText, when } from '@/console/format';
import { Notice } from '@/ui/Notice';
import { StatusBadge } from '@/ui/StatusBadge';
import { ReleaseStatus } from '../../../_components/ReleaseStatus';
import { Section } from '../../../_components/Section';
import { TenantStatus } from '../../../_components/TenantStatus';

// A layout is not the boundary: the page checks access itself before it reads (§4.4). An unknown
// slug is a 404, as for anyone who may not see the tenant.
export default async function ConsoleTenantPage({ params }: { params: Promise<{ tenant: string }> }) {
  const access = await consoleAccess();
  if (access === 'none') notFound();
  if (access === 'needs_mfa') redirect('/console/mfa');

  const { tenant: slug } = await params;
  const found = await findTenant(slug);
  if (!found.ok) {
    return (
      <main className="flex flex-col gap-6 py-8">
        <BackLink />
        <Notice tone="error" role="alert">
          The tenant could not be read. Reload the page to try again.
        </Notice>
      </main>
    );
  }
  if (!found.tenant) notFound();
  const { tenant } = found;
  const detail = await tenantDetail(tenant.id);
  // Release numbers for the deliveries, from the releases already read.
  const numbers = new Map(detail.releases.ok ? detail.releases.rows.map((release) => [release.id, release.number]) : []);

  return (
    <main className="flex flex-col gap-8 py-8">
      <BackLink />
      <div className="flex flex-col gap-2">
        <h1>{tenant.name}</h1>
        <p className="flex flex-wrap items-center gap-3 text-muted">
          <span>{tenant.slug}</span>
          <TenantStatus status={tenant.status} />
        </p>
        <p className="text-muted">The latest {LIMIT} rows of each list, newest first.</p>
      </div>

      <Section
        id="requests"
        title="Requests"
        noun="requests"
        read={detail.requests}
        rowKey={(row) => row.id}
        columns={[
          { header: 'Requested', cell: (row) => when(row.requested_at) },
          { header: 'Action', cell: (row) => statusText(row.action) },
          { header: 'Status', cell: (row) => statusText(row.status) },
          { header: 'Claimed', cell: (row) => when(row.claimed_at) },
          { header: 'Error', cell: (row) => row.error_code ?? '–' },
        ]}
      />
      <Section
        id="releases"
        title="Releases"
        noun="releases"
        read={detail.releases}
        rowKey={(row) => row.id}
        columns={[
          { header: 'Release', cell: (row) => row.number },
          { header: 'Status', cell: (row) => <ReleaseStatus status={row.status} code={row.error_code} step={row.error_step} /> },
          { header: 'Created', cell: (row) => when(row.created_at) },
          { header: 'Delivered', cell: (row) => when(row.delivered_at) },
        ]}
      />
      <Section
        id="deliveries"
        title="Deliveries"
        noun="deliveries"
        read={detail.deliveries}
        rowKey={(row) => `${row.release_id}:${row.site_id}`}
        columns={[
          { header: 'Release', cell: (row) => numbers.get(row.release_id) ?? 'older' },
          {
            header: 'Notified',
            cell: (row) => (
              <span className="flex flex-col gap-1">
                <StatusBadge as="span" tone={row.notify_status === 'failed' ? 'error' : row.notify_status === 'pending' ? 'pending' : 'ok'}>
                  {statusText(row.notify_status)}
                </StatusBadge>
                <span className="text-muted">
                  {row.notify_attempts} {row.notify_attempts === 1 ? 'attempt' : 'attempts'}, {when(row.notified_at)}
                </span>
              </span>
            ),
          },
          {
            header: 'Live',
            cell: (row) => (
              <span className="flex flex-col gap-1">
                <span>{statusText(row.live_status)}</span>
                <span className="text-muted">{when(row.live_confirmed_at)}</span>
              </span>
            ),
          },
          {
            header: 'Last error',
            cell: (row) =>
              row.last_error_code
                ? `${row.last_error_code}${row.last_error_status ? ` (${row.last_error_status})` : ''}, first failed ${when(row.first_failed_at)}, next attempt ${when(row.next_attempt_at)}`
                : '–',
          },
        ]}
      />
      <Section
        id="sites"
        title="Sites"
        noun="sites"
        read={detail.sites}
        rowKey={(row) => row.id}
        columns={[
          { header: 'Address', cell: (row) => <span className="break-all">{row.base_url}</span> },
          { header: 'State', cell: (row) => (row.active ? 'active' : 'inactive') },
        ]}
      />
      <Section
        id="audit"
        title="Audit events"
        noun="audit events"
        read={detail.audit}
        rowKey={(row) => String(row.id)}
        columns={[
          { header: 'When', cell: (row) => when(row.at) },
          { header: 'Action', cell: (row) => statusText(row.action) },
          { header: 'Target', cell: (row) => (row.target_type ? `${row.target_type} ${row.target_id ?? ''}`.trim() : '–') },
          { header: 'Actor', cell: (row) => <span className="break-all">{row.actor_id ?? 'system'}</span> },
        ]}
      />
    </main>
  );
}

function BackLink() {
  return (
    <Link href="/console" prefetch={false} className="inline-flex min-h-[44px] w-fit items-center">
      ← All tenants
    </Link>
  );
}
