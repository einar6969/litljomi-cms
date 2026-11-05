import { redirect } from 'next/navigation';
import { t } from '@/i18n/is';
import { requireUserId } from '@/lib/auth/session';
import { createEditorClient } from '@/lib/supabase/server';
import { listMyTenants } from '@/lib/tenant';
import { Shell } from '@/ui/Shell';
import { Sidebar } from '@/ui/Sidebar';
import { TopBar } from '@/ui/TopBar';
import { Cloud } from '@/ui/Wordmark';
import { signOut } from '../login/actions';

// A client has one tenant and goes straight to it. Only someone with no tenant stays here, and
// someone with several (Litljómi's own staff) gets a plain list.
export default async function TenantPicker() {
  const client = await createEditorClient();
  await requireUserId(client);
  const tenants = await listMyTenants(client);
  if (tenants.length === 1) redirect(`/t/${encodeURIComponent(tenants[0]!.slug)}`);
  return (
    <Shell sidebar={<Sidebar signOut={signOut} />}>
      <TopBar title={t.app.title} crumbs={[{ label: t.tenants.title }]} />
      <main className="page">
        <h1>{t.tenants.title}</h1>
        {tenants.length === 0 ? (
          <div className="card empty">
            <Cloud />
            <p>{t.tenants.none}</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {tenants.map((tenant) => (
              <li key={tenant.id}>
                <a href={`/t/${encodeURIComponent(tenant.slug)}`} className="card tr">
                  {tenant.name}
                </a>
              </li>
            ))}
          </ul>
        )}
      </main>
    </Shell>
  );
}
