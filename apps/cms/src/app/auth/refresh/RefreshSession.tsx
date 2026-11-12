'use client';

import { useEffect } from 'react';
import { replaceTo } from '@/app/login/navigate';
import { safeRedirectPath } from '@/lib/auth/routing';
import { createBrowserEditorClient } from '@/lib/supabase/browser';
import { accessTokenExpiry } from '@/lib/supabase/session-expiry';

/** How close to its `exp`, by the server's clock, an access token counts as expired here. */
const EXPIRY_MARGIN_MS = 30_000;

/** Coming back here within this long of going back counts as a loop, and ends on /login. */
export const LOOP_WINDOW_MS = 30_000;

/** Where the tab notes when this page last sent it back (sessionStorage: this tab only). */
const WENT_BACK_KEY = 'litljomi-cms:refresh:went-back';

/**
 * Refreshes an expired session in the browser, from the editor's own address (R7), and goes back to
 * `next` on this origin; without a session after that, to /login. Shows nothing.
 *
 * Creating the browser client is what refreshes: auth-js recovers the session from the cookies when
 * it starts and refreshes one that has expired, and getSession waits for that and gives the result.
 * auth-js decides by the browser's clock, though, and the proxy sent the tab here by the server's
 * (`serverTime`, when the server rendered this page). So the page reads the access token's `exp`
 * against the server's time too, and refreshes a session auth-js kept itself (refreshSession), once:
 * at most one refresh per expired navigation, against the same per-address limit.
 *
 * Should the tab still come back here soon after going back, it would only go round through the
 * proxy again; it goes to /login instead.
 */
export function RefreshSession({ next, serverTime }: { next: string | undefined; serverTime: number }) {
  useEffect(() => {
    // The server's clock as the browser can tell it: off by the time this page took to arrive.
    const offset = serverTime - Date.now();
    if (wentBackJustNow()) {
      replaceTo('/login');
      return;
    }
    void refreshed(() => Date.now() + offset).then((ok) => {
      if (!ok) return replaceTo('/login');
      noteGoingBack();
      replaceTo(safeRedirectPath(next));
    });
  }, [next, serverTime]);
  return null;
}

async function refreshed(serverNow: () => number): Promise<boolean> {
  try {
    const { auth } = createBrowserEditorClient();
    const { data, error } = await auth.getSession();
    if (error || !data.session) return false;
    if (!expiredBy(data.session.access_token, serverNow())) return true;
    const again = await auth.refreshSession();
    return !again.error && again.data.session !== null;
  } catch {
    return false;
  }
}

/** Whether `token` has expired by `now` (or will within the margin). A token it cannot read has not, as for the proxy. */
function expiredBy(token: string, now: number): boolean {
  const exp = accessTokenExpiry(token);
  return exp !== null && exp * 1000 - EXPIRY_MARGIN_MS <= now;
}

/** Whether this page sent the tab back within LOOP_WINDOW_MS; the note is used up either way. */
function wentBackJustNow(): boolean {
  try {
    const at = Number(sessionStorage.getItem(WENT_BACK_KEY));
    sessionStorage.removeItem(WENT_BACK_KEY);
    return at > 0 && Date.now() - at < LOOP_WINDOW_MS;
  } catch {
    return false;
  }
}

function noteGoingBack(): void {
  try {
    sessionStorage.setItem(WENT_BACK_KEY, String(Date.now()));
  } catch {
    // Without the tab's storage there is no loop guard; the server's time still decides above.
  }
}
