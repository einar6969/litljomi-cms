import type { Metadata } from 'next';
import { RefreshSession } from './RefreshSession';

// `next` may be the confirm page's link, with its token hash: no Referer passes it on.
export const metadata = { referrer: 'no-referrer' } satisfies Metadata;

type Props = { searchParams: Promise<{ next?: string | string[] }> };

/**
 * Where the proxy sends a page navigation whose session has expired (R7; lib/supabase/proxy.ts): the
 * browser refreshes the session and goes back. Public, and the proxy never sends it on here again.
 * The server's time goes with it: the proxy decided by the server's clock, which the browser's may
 * be behind.
 */
export default async function RefreshPage({ searchParams }: Props) {
  const { next } = await searchParams;
  return <RefreshSession next={typeof next === 'string' ? next : undefined} serverTime={Date.now()} />;
}
