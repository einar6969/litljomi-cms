'use client';

import Link from 'next/link';
import { Fragment } from 'react';
import { t } from '@/i18n/is';
import { Icon } from './Icon';
import { useShell } from './Shell';

export type Crumb = {
  label: string;
  /** A crumb without an href is the page itself. */
  href?: string;
  /** The link's name where it differs from its text. */
  name?: string;
};

/** Where the form puts its save status (EntryForm). */
export const SAVE_SLOT_ID = 'save-slot';

type Props = {
  /** What the bar says below 1024 px, beside the menu button. */
  title: string;
  crumbs?: Crumb[];
  /** Tenant home has no bar from 1024 px up; below it the bar only carries the menu. */
  home?: boolean;
  /** The page has a save status. */
  saves?: boolean;
  menuLabel?: string;
};

/** The bar over a page: the menu button on small screens, breadcrumbs on large ones, the save status. */
export function TopBar({ title, crumbs = [], home = false, saves = false, menuLabel = t.app.menu }: Props) {
  const { open } = useShell();
  return (
    <header className={home ? 'top-home' : saves ? 'top top-saves' : 'top'}>
      <button type="button" className="icbtn top-menu" aria-label={menuLabel} onClick={open}>
        <Icon name="menu" size={20} />
      </button>
      <span className="top-name">{title}</span>
      {crumbs.length > 0 ? (
        <nav className="crumbs" aria-label={t.app.breadcrumbs}>
          <ol>
            {crumbs.map((crumb, index) => (
              <Fragment key={crumb.label + index}>
                {index > 0 ? (
                  <li aria-hidden="true">
                    <span className="sep">/</span>
                  </li>
                ) : null}
                <li>
                  {crumb.href ? (
                    <Link href={crumb.href} aria-label={crumb.name}>
                      {crumb.label}
                    </Link>
                  ) : (
                    <span aria-current="page">{crumb.label}</span>
                  )}
                </li>
              </Fragment>
            ))}
          </ol>
        </nav>
      ) : null}
      {saves ? <div id={SAVE_SLOT_ID} className="top-save" /> : null}
    </header>
  );
}
