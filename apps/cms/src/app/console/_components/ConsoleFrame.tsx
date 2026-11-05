import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon } from '@/ui/Icon';
import { Cloud } from '@/ui/Wordmark';

/** The sections of a tenant's page, in page order. */
const TENANT_SECTIONS = [
  ['requests', 'Requests'],
  ['releases', 'Releases'],
  ['deliveries', 'Deliveries'],
  ['sites', 'Sites'],
  ['audit', 'Audit events'],
] as const;

type Tenant = { slug: string; name: string };

function ConsoleNav({ tenant }: { tenant?: Tenant | undefined }) {
  return (
    <nav aria-label="Console">
      <ul className="nav">
        <li>
          <Link href="/console" prefetch={false} aria-current={tenant ? undefined : 'page'}>
            Tenants
          </Link>
        </li>
        {tenant ? (
          <>
            <li>
              <Link href={`/console/t/${encodeURIComponent(tenant.slug)}`} prefetch={false} aria-current="page">
                {tenant.name}
              </Link>
            </li>
            <li>
              <ul className="nav subnav">
                {TENANT_SECTIONS.map(([id, label]) => (
                  <li key={id}>
                    <a href={`#${id}`}>{label}</a>
                  </li>
                ))}
              </ul>
            </li>
          </>
        ) : null}
      </ul>
    </nav>
  );
}

function Mark() {
  return (
    <span className="wm">
      <Cloud />
      <span>Litljómi</span>
      <span className="wm-tag">console</span>
    </span>
  );
}

/**
 * A console page's frame. The console has no client code and no forms (read-only.test.ts), so this
 * is server markup only: a sidebar from 1024 px up, and below it a <details> that needs no script.
 */
export function ConsoleFrame({ tenant, children }: { tenant?: Tenant; children: ReactNode }) {
  return (
    <div className="app">
      <aside className="side csl-side">
        <Mark />
        <div className="mt-3">
          <ConsoleNav tenant={tenant} />
        </div>
      </aside>
      <div className="work">
        <details className="csl-menu">
          <summary>
            <span className="icbtn">
              <Icon name="menu" size={20} />
            </span>
            Console
          </summary>
          <div className="csl-menu-body">
            <ConsoleNav tenant={tenant} />
          </div>
        </details>
        {children}
      </div>
    </div>
  );
}
