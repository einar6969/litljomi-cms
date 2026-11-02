import { notFound } from 'next/navigation';
import { t } from '@/i18n/is';
import { getModule } from '@/modules/registry';
import { currentTenant, isActive } from '@/lib/tenant';
import { LinkCard, LinkCardList } from '@/ui/LinkCard';

type Props = { params: Promise<{ tenant: string }> };

// A tenant's start page: its name and content types (each links to its entry list). The
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
      {structure.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-xs font-semibold uppercase leading-4 tracking-wider text-muted">{t.tenant.contentTypes}</h2>
          <LinkCardList>
            {structure.map((item) => (
              <LinkCard key={item.type} href={`/t/${encodeURIComponent(tenant.slug)}/${encodeURIComponent(item.type)}`}>
                {item.label}
              </LinkCard>
            ))}
          </LinkCardList>
        </section>
      ) : null}
    </main>
  );
}
