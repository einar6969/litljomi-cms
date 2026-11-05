'use client';

import { useEffect } from 'react';
import { announceSignOut, onSignOut } from '@/editor/unsaved';
import { t } from '@/i18n/is';
import { Icon } from './Icon';

/**
 * "Skrá út". Before the server action ends the session, the tab's copies of unsaved changes are
 * removed and every form in it drops its unsaved changes (M2-17), and the browser's other tabs are
 * told to do the same, so nothing of the editor's work stays behind after they sign out.
 */
export function SignOutForm({ signOut, label = t.app.signOut }: { signOut: () => Promise<void>; label?: string }) {
  // While an editor page is open the tab listens for a sign-out in another tab; the tab's copies are
  // removed then (unsaved.ts), whether or not a form is open.
  useEffect(() => onSignOut(() => undefined), []);
  return (
    <form action={signOut} onSubmit={() => announceSignOut()}>
      <button type="submit">
        <Icon name="signOut" />
        {label}
      </button>
    </form>
  );
}
