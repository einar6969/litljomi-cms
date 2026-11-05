import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { requireUserId } from '@/lib/auth/session';
import { consoleAccess } from '@/lib/console-access';
import { createEditorClient } from '@/lib/supabase/server';

// The console (§2.1): anyone who is not a platform admin gets 404, as for an unknown tenant. Pages
// below render in parallel with this layout, so one that acts on the user checks consoleAccess
// itself. Console copy is English, unlike the rest of the CMS.
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  await requireUserId(await createEditorClient());
  if ((await consoleAccess()) === 'none') notFound();
  return <div lang="en">{children}</div>;
}
