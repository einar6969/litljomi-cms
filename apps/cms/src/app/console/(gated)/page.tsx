import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { consoleAccess } from '@/lib/console-access';
import { latestReleases, listTenants, type Release, type Tenant } from '@/console/data';
import { Notice } from '@/ui/Notice';
import { ConsoleFrame } from '../_components/ConsoleFrame';
import { ReleaseStatus } from '../_components/ReleaseStatus';
import { Section } from '../_components/Section';
import { TenantStatus } from '../_components/TenantStatus';

// A layout is not the boundary and may not rerun on soft navigation: the page checks access itself
// before it reads (§4.4). The views return nothing below aal2 in any case (§4.5).
export default async function ConsolePage() {
  const access = await consoleAccess();
  if (access === 'none') notFound();
  if (access === 'needs_mfa') redirect('/console/mfa');

  const tenants = await listTenants();
  const releases = tenants.ok ? await latestReleases(tenants.rows.map((tenant) => tenant.id)) : null;
  const latest = new Map<string, Release>(releases?.ok ? releases.rows.map((release) => [release.tenant_id, release]) : []);

  return (
    <ConsoleFrame>
    <main className="page">
      <h1>Console</h1>
      {releases && !releases.ok ? (
        <Notice tone="error" role="alert">
          The latest releases could not be read. Reload the page to try again.
        </Notice>
      ) : null}
      <Section<Tenant>
        id="tenants"
        title="Tenants"
        noun="tenants"
        read={tenants}
        rowKey={(tenant) => tenant.id}
        columns={[
          {
            header: 'Tenant',
            cell: (tenant) => (
              <Link href={`/console/t/${encodeURIComponent(tenant.slug)}`} prefetch={false} className="inline-flex min-h-[36px] items-center">
                {tenant.name}
              </Link>
            ),
          },
          { header: 'Slug', cell: (tenant) => <span className="mono">{tenant.slug}</span> },
          { header: 'Status', cell: (tenant) => <TenantStatus status={tenant.status} /> },
          {
            header: 'Latest release',
            cell: (tenant) => {
              if (!releases?.ok) return '–';
              const release = latest.get(tenant.id);
              return release ? (
                <span className="stack">
                  <span>Release {release.number}</span>
                  <ReleaseStatus status={release.status} code={release.error_code} step={release.error_step} />
                </span>
              ) : (
                <span className="text-muted">No release yet</span>
              );
            },
          },
        ]}
      />
    </main>
    </ConsoleFrame>
  );
}
