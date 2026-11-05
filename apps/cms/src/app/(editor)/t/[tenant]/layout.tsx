import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { signOut } from '@/app/login/actions';
import { navSections } from '@/editor/structure';
import { t } from '@/i18n/is';
import { requireUserId } from '@/lib/auth/session';
import { createEditorClient } from '@/lib/supabase/server';
import { currentTenant, isActive } from '@/lib/tenant';
import { getModule } from '@/modules/registry';
import { Notice } from '@/ui/Notice';
import { Shell } from '@/ui/Shell';
import { Sidebar } from '@/ui/Sidebar';
import { TopBar } from '@/ui/TopBar';

type Props = { children: ReactNode; params: Promise<{ tenant: string }> };

// A tenant's editor: the slug is resolved only through api.my_tenants with the editor's session.
// A tenant the editor is not a member of answers 404, like one that does not exist; a suspended
// tenant shows a notice instead of its content. Pages below render in parallel with this layout,
// so each resolves the tenant itself (currentTenant) and renders nothing for an inactive one.
export default async function TenantLayout({ children, params }: Props) {
  const { tenant: slug } = await params;
  await requireUserId(await createEditorClient());
  const tenant = await currentTenant(slug);
  if (!tenant) notFound();
  const active = isActive(tenant);
  const sections = active ? navSections(getModule(tenant.slug)?.structure ?? []) : [];
  const sidebar = <Sidebar tenant={{ slug: tenant.slug, name: tenant.name }} sections={sections} signOut={signOut} />;
  return (
    <Shell sidebar={sidebar}>
      {active ? (
        children
      ) : (
        <>
          <TopBar title={tenant.name} home />
          <main className="page page-home">
            <Notice as="div" tone="warning">
              <h1 className="text-xl">{t.tenant.inactive}</h1>
              <p>{t.tenant.inactiveBody}</p>
            </Notice>
          </main>
        </>
      )}
    </Shell>
  );
}
