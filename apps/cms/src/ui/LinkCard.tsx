import Link from 'next/link';
import type { ReactNode } from 'react';

/** A list of links as large, bordered rows (the tenant picker and the tenant's content types). */
export function LinkCardList({ children }: { children: ReactNode }) {
  return <ul className="mt-6 grid list-none gap-3 p-0">{children}</ul>;
}

/** One row of a LinkCardList: the whole row is the link, at least 56 px tall. */
export function LinkCard({ href, children }: { href: string; children: ReactNode }) {
  return (
    <li>
      <Link
        href={href}
        className="flex min-h-[56px] items-center justify-between gap-4 rounded-lg border border-hairline bg-canvas px-5 py-3 text-lg font-semibold no-underline hover:border-ink hover:bg-recessed"
      >
        <span>{children}</span>
        <span aria-hidden="true" className="text-muted">→</span>
      </Link>
    </li>
  );
}
