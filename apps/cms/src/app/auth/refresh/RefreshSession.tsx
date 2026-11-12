'use client';

import { useEffect } from 'react';
import { replaceTo } from '@/app/login/navigate';
import { safeRedirectPath } from '@/lib/auth/routing';
import { createBrowserEditorClient } from '@/lib/supabase/browser';

/**
 * Refreshes an expired session in the browser, from the editor's own address (R7), and goes back to
 * `next` on this origin; without a session after that, to /login. Shows nothing.
 *
 * Creating the browser client is what refreshes: auth-js recovers the session from the cookies when
 * it starts and refreshes one that has expired, and getSession waits for that and gives the result.
 * refreshSession would send a second refresh after it, against the same per-address limit.
 */
export function RefreshSession({ next }: { next: string | undefined }) {
  useEffect(() => {
    void refreshed().then((ok) => replaceTo(ok ? safeRedirectPath(next) : '/login'));
  }, [next]);
  return null;
}

async function refreshed(): Promise<boolean> {
  try {
    const { data, error } = await createBrowserEditorClient().auth.getSession();
    return !error && data.session !== null;
  } catch {
    return false;
  }
}
