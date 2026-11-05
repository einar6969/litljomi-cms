import { notFound } from 'next/navigation';
import { parseChangesParam } from '@/editor/overview';
import { loadTenantOverview } from '@/editor/server/tenant-overview';
import { structureLabel } from '@/editor/structure';
import { TenantOverview } from '@/editor/TenantOverview';
import { t } from '@/i18n/is';
import { createEditorClient } from '@/lib/supabase/server';
import { currentTenant, isActive } from '@/lib/tenant';
import { getModule, getType } from '@/modules/registry';
import { TopBar } from '@/ui/TopBar';

type Props = {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// A tenant's start page: its name over a greeting, and the overview of its site and content, read
// under the editor's session. There is no top bar here from 1024 px up. The layout shows the "Vefur
// óvirkur" notice for an inactive tenant; this page renders nothing then and reads nothing.
export default async function TenantHome({ params, searchParams }: Props) {
  const { tenant: slug } = await params;
  const { breytingar } = await searchParams;
  const tenant = await currentTenant(slug);
  if (!tenant) notFound();
  if (!isActive(tenant)) return null;
  const structure = getModule(tenant.slug)?.structure ?? [];
  const overview = await loadTenantOverview(await createEditorClient(), {
    tenantId: tenant.id,
    structure,
    showWaiting: parseChangesParam(breytingar),
  });
  // A waiting entry can be of a type outside the structure, so the module has the last word.
  const typeLabel = (type: string) => structureLabel(structure, type) ?? getType(tenant.slug, type)?.label;
  return (
    <>
      <TopBar title={t.app.title} home />
      <main className="page page-home">
        <TenantOverview tenantSlug={tenant.slug} tenantName={tenant.name} structure={structure} typeLabel={typeLabel} overview={overview} now={new Date()} />
      </main>
    </>
  );
}
