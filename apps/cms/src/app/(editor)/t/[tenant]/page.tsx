import { notFound } from 'next/navigation';
import { StructureNav } from '@/editor/StructureNav';
import { t } from '@/i18n/is';
import { currentTenant, isActive } from '@/lib/tenant';
import { getModule } from '@/modules/registry';
import { TopBar } from '@/ui/TopBar';

type Props = { params: Promise<{ tenant: string }> };

// A tenant's start page: its name over a greeting, and the module's navigation (groups and content
// types in order). There is no top bar here from 1024 px up. The layout shows the "Vefur óvirkur"
// notice for an inactive tenant; this page renders nothing then.
export default async function TenantHome({ params }: Props) {
  const { tenant: slug } = await params;
  const tenant = await currentTenant(slug);
  if (!tenant) notFound();
  if (!isActive(tenant)) return null;
  const structure = getModule(tenant.slug)?.structure ?? [];
  return (
    <>
      <TopBar title={t.app.title} home />
      <main className="page page-home">
        <div className="hello">
          <h1>{tenant.name}</h1>
          <p>{t.tenant.greeting}</p>
        </div>
        {structure.length > 0 ? <StructureNav tenantSlug={tenant.slug} structure={structure} /> : null}
      </main>
    </>
  );
}
