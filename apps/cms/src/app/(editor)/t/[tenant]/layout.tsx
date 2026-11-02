import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { t } from '@/i18n/is';
import { requireUserId } from '@/lib/auth/session';
import { createEditorClient } from '@/lib/supabase/server';
import { currentTenant } from '@/lib/tenant';

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
  if (tenant.status !== 'active') {
    return (
      <main>
        <h1>{t.tenant.inactive}</h1>
        <p>{t.tenant.inactiveBody}</p>
      </main>
    );
  }
  return <>{children}</>;
}
