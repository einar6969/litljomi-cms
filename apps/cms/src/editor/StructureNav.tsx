import type { StructureNode } from '@litljomi/cms-schema';
import { t } from '@/i18n/is';
import { LinkCard, LinkCardList } from '@/ui/LinkCard';

type Item = { type: string; label: string };
type Section = { heading: string; items: Item[]; grouped: boolean };

/**
 * Groups the module's structure into sections in declared order: each group is one section under
 * its own label, and each run of items outside a group is one section under "Efnisflokkar".
 */
function sections(structure: StructureNode[]): Section[] {
  const out: Section[] = [];
  for (const node of structure) {
    const last = out.at(-1);
    if ('group' in node) out.push({ heading: node.group, items: node.items, grouped: true });
    else if (last && !last.grouped) last.items.push(node);
    else out.push({ heading: t.tenant.contentTypes, items: [node], grouped: false });
  }
  return out;
}

/**
 * The editor's navigation (spec §3.2 `structure`): the tenant's groups and content types in the
 * module's order. Every item links to its type's page; a singleton type's page opens its one
 * entry (§10.1).
 */
export function StructureNav({ tenantSlug, structure }: { tenantSlug: string; structure: StructureNode[] }) {
  const base = `/t/${encodeURIComponent(tenantSlug)}`;
  return (
    <nav aria-label={t.tenant.navigation}>
      {sections(structure).map((section, i) => (
        <section key={i} className="mt-8">
          <h2 className="text-xs font-semibold uppercase leading-4 tracking-wider text-muted">{section.heading}</h2>
          <LinkCardList>
            {section.items.map((item) => (
              <LinkCard key={item.type} href={`${base}/${encodeURIComponent(item.type)}`}>
                {item.label}
              </LinkCard>
            ))}
          </LinkCardList>
        </section>
      ))}
    </nav>
  );
}
