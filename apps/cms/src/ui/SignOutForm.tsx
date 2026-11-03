'use client';

import { clearUnsavedCopies } from '@/editor/unsaved';
import { t } from '@/i18n/is';
import { Button } from './Button';

/**
 * "Skrá út". Before the server action ends the session, the tab's copies of unsaved changes are
 * removed (M2-17), so nothing of the editor's work stays in the tab after they sign out.
 */
export function SignOutForm({ signOut }: { signOut: () => Promise<void> }) {
  return (
    <form action={signOut} onSubmit={() => clearUnsavedCopies()}>
      <Button type="submit">{t.app.signOut}</Button>
    </form>
  );
}
