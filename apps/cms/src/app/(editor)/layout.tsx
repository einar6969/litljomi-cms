import type { ReactNode } from 'react';
import { requireUserId } from '@/lib/auth/session';
import { createEditorClient } from '@/lib/supabase/server';

// Every page in the editor needs a signed-in editor. The shell is drawn further down, where the
// tenant is known.
export default async function EditorLayout({ children }: { children: ReactNode }) {
  await requireUserId(await createEditorClient());
  return <>{children}</>;
}
