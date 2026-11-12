'use client';

import { useEffect } from 'react';
import { createBrowserEditorClient } from '@/lib/supabase/browser';

/**
 * Starts the browser's Supabase client on a signed-in page, so the session is refreshed in the
 * browser, from the editor's own address, while the tab is open (R7): auth-js refreshes it shortly
 * before it expires, and again when a tab left in the background comes back. The CMS server never
 * refreshes one (lib/supabase/no-refresh-fetch.ts).
 *
 * Once per page load: the effect runs when the shell mounts, and @supabase/ssr keeps one browser
 * client per tab, the one the editor's forms use too.
 */
export function KeepSessionFresh(): null {
  useEffect(() => {
    createBrowserEditorClient();
  }, []);
  return null;
}
