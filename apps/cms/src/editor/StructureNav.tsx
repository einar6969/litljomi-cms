import type { StructureNode } from '@litljomi/cms-schema';
import Link from 'next/link';
import { t } from '@/i18n/is';
import { Icon } from '@/ui/Icon';
import { NewEntryButton } from './NewEntryButton';
import { entriesLine, type EntryCount } from './overview';
import { navSections } from './structure';

/**
 * The tenant home's content types (spec §3.2 `structure`): the tenant's groups and list types in the
 * module's order, each a card with its count line and "Ný færsla". A singleton has one entry and no
 * list, so it is a row of the overview's Síður card instead (its page opens that entry, §10.1), and
 * a section with only singletons is left out. A type with no count, because its read failed, has
 * no count line.
 */
export function StructureNav({
  tenantSlug,
  structure,
  counts = new Map(),
}: {
  tenantSlug: string;
  structure: StructureNode[];
  counts?: ReadonlyMap<string, EntryCount>;
}) {
  const base = `/t/${encodeURIComponent(tenantSlug)}`;
  const sections = navSections(structure)
    .map((section) => ({ ...section, items: section.items.filter((item) => !item.singleton) }))
    .filter((section) => section.items.length > 0);
  if (sections.length === 0) return null;
  return (
    <nav aria-label={t.tenant.navigation} className="flex flex-col gap-6">
      {sections.map((section, i) => (
        <section key={i}>
          <h2 className="sec-h">{section.heading}</h2>
          <ul className="cards">
            {section.items.map((item) => {
              const count = counts.get(item.type);
              return (
                <li key={item.type} className="card tc tc-data">
                  <Link href={`${base}/${encodeURIComponent(item.type)}`} className="tc-h">
                    <span>{item.label}</span>
                    <Icon name="arrowRight" />
                  </Link>
                  {count ? <p className="meta-l">{entriesLine(count.total, count.drafts)}</p> : null}
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
