'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { NavSection } from '@/editor/structure';
import { t } from '@/i18n/is';
import { Icon } from './Icon';
import { useShell } from './Shell';
import { SignOutForm } from './SignOutForm';
import { Wordmark } from './Wordmark';

type Props = {
  tenant?: { slug: string; name: string };
  sections?: NavSection[];
  signOut: () => Promise<void>;
};

/** The sidebar: the wordmark, the tenant, its content types and media library, help and "Skrá út". */
export function Sidebar({ tenant, sections = [], signOut }: Props) {
  const pathname = usePathname();
  const { close } = useShell();
  const base = tenant ? `/t/${encodeURIComponent(tenant.slug)}` : '';
  return (
    <aside className="side">
      <button type="button" className="icbtn side-close" aria-label={t.app.closeMenu} onClick={close}>
        <Icon name="close" size={20} />
      </button>
      <Link href="/" className="wm">
        <Wordmark />
      </Link>
      {tenant ? (
        <>
          <Link href={base} className="ten" data-testid="header-tenant">
            <span className="tile" aria-hidden="true">
              {tenant.name.charAt(0).toUpperCase()}
            </span>
            <span>{tenant.name}</span>
          </Link>
          <nav aria-label={t.tenant.navigation}>
            {sections.map((section) => (
              <div key={section.heading + section.items[0]?.type}>
                <p className="navh">{section.heading}</p>
                <ul className="nav">
                  {section.items.map((item) => {
                    const href = `${base}/${encodeURIComponent(item.type)}`;
                    const here = pathname === href || pathname.startsWith(`${href}/`);
                    return (
                      <li key={item.type}>
                        <Link href={href} aria-current={here ? 'page' : undefined}>
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {/* The media library: a fixed link under the content types (docs/plans/media-library.md section 6.1). */}
            <ul className="nav nav-fixed">
              <li>
                <Link href={`${base}/assets`} aria-current={pathname === `${base}/assets` || pathname.startsWith(`${base}/assets/`) ? 'page' : undefined}>
                  <Icon name="image" />
                  {t.library.title}
                </Link>
              </li>
            </ul>
          </nav>
        </>
      ) : null}
      <div className="side-foot">
        <ul className="nav">
          <li>
            <a href={`mailto:${t.app.helpEmail}`}>
              <Icon name="help" />
              {t.app.help}
            </a>
          </li>
          <li>
            <SignOutForm signOut={signOut} />
          </li>
        </ul>
      </div>
    </aside>
  );
}
