import { notFound } from 'next/navigation';
import { t } from '@/i18n/is';
import { getModule } from '@/modules/registry';
import { currentTenant } from '@/lib/tenant';

type Props = { params: Promise<{ tenant: string }> };

// A tenant's start page: its name and content types (the entry lists come with Task 23). The
// layout shows the "Vefur óvirkur" notice for an inactive tenant; this page renders nothing then.
export default async function TenantHome({ params }: Props) {
  const { tenant: slug } = await params;
  const tenant = await currentTenant(slug);
  if (!tenant) notFound();
  if (tenant.status !== 'active') return null;
  const structure = getModule(tenant.slug)?.structure ?? [];
  return (
    <main>
      <h1>{tenant.name}</h1>
      {structure.length > 0 ? (
        <section>
          <h2>{t.tenant.contentTypes}</h2>
          <ul>
            {structure.map((item) => (
              <li key={item.type}>{item.label}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
