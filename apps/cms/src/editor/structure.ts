import type { StructureNode } from '@litljomi/cms-schema';
import { t } from '@/i18n/is';

export type NavItem = { type: string; label: string; singleton: boolean };
export type NavSection = { heading: string; items: NavItem[]; grouped: boolean };

const item = (node: { type: string; label: string; singleton?: boolean | undefined }): NavItem => ({
  type: node.type,
  label: node.label,
  singleton: node.singleton === true,
});

/**
 * Groups the module's structure into sections in declared order: each group is one section under
 * its own label, and each run of items outside a group is one section under "Efnisflokkar". The
 * sidebar and the tenant home show the same sections.
 */
export function navSections(structure: StructureNode[]): NavSection[] {
  const out: NavSection[] = [];
  for (const node of structure) {
    const last = out.at(-1);
    if ('group' in node) out.push({ heading: node.group, items: node.items.map(item), grouped: true });
    else if (last && !last.grouped) last.items.push(item(node));
    else out.push({ heading: t.tenant.contentTypes, items: [item(node)], grouped: false });
  }
  return out;
}

/** What the structure calls a content type ("Fréttir"), which is the plural the type's label is not. */
export function structureLabel(structure: StructureNode[], type: string): string | undefined {
  for (const section of navSections(structure)) {
    const found = section.items.find((candidate) => candidate.type === type);
    if (found) return found.label;
  }
  return undefined;
}
