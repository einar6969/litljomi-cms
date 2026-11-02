import type { ReactNode } from 'react';
import { requireUserId } from '@/lib/auth/session';
import { createEditorClient } from '@/lib/supabase/server';
import { listMyTenants } from '@/lib/tenant';
import { AppHeader } from '@/ui/AppHeader';
import { signOut } from '../login/actions';

// The editor shell: every page in it needs a signed-in editor. The header shows the name of the
// tenant in the URL, looked up among the editor's own tenants (api.my_tenants, under RLS).
export default async function EditorLayout({ children }: { children: ReactNode }) {
  const client = await createEditorClient();
  await requireUserId(client);
  const tenants = await listMyTenants(client);
  return (
    <>
      <AppHeader tenants={tenants.map(({ slug, name }) => ({ slug, name }))} signOut={signOut} />
      {children}
    </>
  );
}
