import { notFound } from 'next/navigation';
import { getModule } from '@/modules/registry';
import { currentTenant, isActive } from '@/lib/tenant';
import { StructureNav } from '@/editor/StructureNav';

type Props = { params: Promise<{ tenant: string }> };

// A tenant's start page: its name and the module's navigation (groups and content types in order). The
// layout shows the "Vefur óvirkur" notice for an inactive tenant; this page renders nothing then.
export default async function TenantHome({ params }: Props) {
  const { tenant: slug } = await params;
  const tenant = await currentTenant(slug);
  if (!tenant) notFound();
  if (!isActive(tenant)) return null;
  const structure = getModule(tenant.slug)?.structure ?? [];
  return (
    <main>
      <h1>{tenant.name}</h1>
      {structure.length > 0 ? <StructureNav tenantSlug={tenant.slug} structure={structure} /> : null}
    </main>
  );
}
