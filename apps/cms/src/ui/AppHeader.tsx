import Link from 'next/link';
import { t } from '@/i18n/is';
import { Button } from './Button';
import { HeaderTenant } from './HeaderTenant';
import { Wordmark } from './Wordmark';

type Props = {
  tenants: ReadonlyArray<{ slug: string; name: string }>;
  signOut: () => Promise<void>;
};

/** The editor's header: the wordmark, the open tenant's name and "Skrá út". */
export function AppHeader({ tenants, signOut }: Props) {
  return (
    <header className="border-b border-hairline bg-canvas">
      <div className="mx-auto flex max-w-[960px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2">
        <Link href="/" className="inline-flex min-h-[44px] items-center no-underline">
          <Wordmark />
        </Link>
        <HeaderTenant tenants={tenants} />
        <form action={signOut}>
          <Button type="submit">{t.app.signOut}</Button>
        </form>
      </div>
    </header>
  );
}
