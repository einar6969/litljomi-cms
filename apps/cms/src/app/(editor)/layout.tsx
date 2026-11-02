import Link from 'next/link';
import type { ReactNode } from 'react';
import { t } from '@/i18n/is';
import { requireUserId } from '@/lib/auth/session';
import { createEditorClient } from '@/lib/supabase/server';
import { signOut } from '../login/actions';

// The editor shell: every page in it needs a signed-in editor.
export default async function EditorLayout({ children }: { children: ReactNode }) {
  await requireUserId(await createEditorClient());
  return (
    <>
      <header>
        <Link href="/">{t.app.title}</Link>
        <form action={signOut}>
          <button type="submit">{t.app.signOut}</button>
        </form>
      </header>
      {children}
    </>
  );
}
