'use client';

import { useParams } from 'next/navigation';

/** The name of the tenant whose pages are open (`/t/[tenant]/…`), from the editor's own tenants. */
export function HeaderTenant({ tenants }: { tenants: ReadonlyArray<{ slug: string; name: string }> }) {
  const { tenant } = useParams<{ tenant?: string }>();
  const current = tenants.find((candidate) => candidate.slug === tenant);
  if (!current) return null;
  return (
    <span data-testid="header-tenant" className="rounded-lg bg-recessed px-3 py-1.5 text-[15px] font-semibold max-md:order-last max-md:basis-full">
      {current.name}
    </span>
  );
}
