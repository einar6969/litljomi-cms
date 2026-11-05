import type { StructureNode } from '@litljomi/cms-schema';
import Link from 'next/link';
import { t } from '@/i18n/is';
import { Icon } from '@/ui/Icon';
import { NewEntryButton } from './NewEntryButton';
import { navSections } from './structure';

/**
 * The tenant home's navigation (spec §3.2 `structure`): the tenant's groups and content types in the
 * module's order. A type with a list is a card with "Ný færsla"; a singleton has one entry, so it is
 * a plain row (its page opens that entry, §10.1).
 */
export function StructureNav({ tenantSlug, structure }: { tenantSlug: string; structure: StructureNode[] }) {
  const base = `/t/${encodeURIComponent(tenantSlug)}`;
  return (
    <nav aria-label={t.tenant.navigation} className="flex flex-col gap-6">
      {navSections(structure).map((section, i) => (
        <section key={i}>
          <h2 className="sec-h">{section.heading}</h2>
          <ul className="cards">
            {section.items.map((item) => {
              const href = `${base}/${encodeURIComponent(item.type)}`;
              return item.singleton ? (
                <li key={item.type}>
                  <Link href={href} className="card tr">
                    <span>{item.label}</span>
                    <Icon name="arrowRight" />
                  </Link>
                </li>
              ) : (
                <li key={item.type} className="card tc">
                  <Link href={href} className="tc-h">
                    <span>{item.label}</span>
                    <Icon name="arrowRight" />
                  </Link>
                  <NewEntryButton tenantSlug={tenantSlug} type={item.type} variant="secondary" size="sm" />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}
