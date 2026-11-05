import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { consoleAccess } from '@/lib/console-access';

// The pages that need `aal2` (§4.4). A group of its own, because a layout cannot read the path and
// /console/mfa must stay reachable at `aal1`. `none` is the console layout's 404.
export default async function GatedLayout({ children }: { children: ReactNode }) {
  if ((await consoleAccess()) === 'needs_mfa') redirect('/console/mfa');
  return <>{children}</>;
}
