import Link from 'next/link';
import { redirect } from 'next/navigation';
import { t } from '@/i18n/is';
import { requireUserId } from '@/lib/auth/session';
import { createEditorClient } from '@/lib/supabase/server';
import { listMyTenants } from '@/lib/tenant';

// The tenant picker: the editor's tenants from api.my_tenants. With exactly one, go straight to it.
export default async function TenantPicker() {
  const client = await createEditorClient();
  await requireUserId(client);
  const tenants = await listMyTenants(client);
  if (tenants.length === 1) redirect(`/t/${encodeURIComponent(tenants[0]!.slug)}`);
  return (
    <main>
      <h1>{t.tenants.title}</h1>
      {tenants.length === 0 ? (
        <p>{t.tenants.none}</p>
      ) : (
        <ul>
          {tenants.map((tenant) => (
            <li key={tenant.id}>
              <Link href={`/t/${encodeURIComponent(tenant.slug)}`}>{tenant.name}</Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
