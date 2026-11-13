import type { ContentType } from './define-type.ts';

/** An entry as a site integration sees it: enough to compute its public path and to find it in a release. */
export interface SiteEntry {
  id: string;
  type: string;
  slug: string | null;
  sortAt: string | null;
}

/** The published entries of one release. */
export interface ReleaseView {
  /** Entries of the type, sorted by `sortAt` descending. */
  entries(type: string): SiteEntry[];
}

/** A page of the live site to fetch after delivery: the entry's link must be there (`present`) or gone (`absent`). */
export type LiveCheck = { path: string; expect: 'present' | 'absent' };

export interface SiteIntegration {
  /** The entry's public path on the site. */
  path(e: SiteEntry): string;
  /** The live checks for a release; `previous` is the release before it (null for the first). */
  checks(e: SiteEntry, release: ReleaseView, previous: ReleaseView | null): LiveCheck[];
}

/** What a tenant module declares (spec §3.1). Core reads modules only through the registry. */
export interface ModuleManifest {
  tenant: string;
  locale: 'is';
  branding: { name: string };
  types: ContentType[];
  /** Editor navigation (§3.2): items and groups of items, in the order the editor shows them. */
  structure: StructureNode[];
  /** Site integration per content type name. */
  site: Record<string, SiteIntegration>;
}

/** One content type in the editor's navigation. A singleton type has exactly one entry (§10.1). */
export interface StructureItem {
  type: string;
  label: string;
  singleton?: boolean;
}

/** A labelled group of navigation items. Groups do not nest. */
export interface StructureGroup {
  group: string;
  items: StructureItem[];
}

export type StructureNode = StructureItem | StructureGroup;

const isGroup = (node: StructureNode): node is StructureGroup => 'group' in node;

/** Every navigation item of the module, groups flattened, in navigation order. */
export function structureItems(m: Pick<ModuleManifest, 'structure'>): StructureItem[] {
  return m.structure.flatMap((node) => (isGroup(node) ? node.items : [node]));
}

/** True when the module's structure declares the type a singleton. */
export function isSingleton(m: Pick<ModuleManifest, 'structure'>, type: string): boolean {
  return structureItems(m).some((item) => item.type === type && item.singleton === true);
}

const blank = (s: unknown): boolean => typeof s !== 'string' || s.trim() === '';

/**
 * Checks the structure against the module's types: every item names a type of the module, no type
 * is listed twice (also across groups), groups have a label, are unique and are not empty.
 */
function checkStructure(m: ModuleManifest): void {
  const types = new Set(m.types.map((t) => t.name));
  const groups = new Set<string>();
  for (const node of m.structure) {
    if (!isGroup(node)) continue;
    if (blank(node.group)) throw new Error('structure: a group has no label');
    if (groups.has(node.group)) throw new Error(`structure: group "${node.group}" is listed twice`);
    groups.add(node.group);
    if (node.items.length === 0) throw new Error(`structure: group "${node.group}" is empty`);
  }
  const seen = new Set<string>();
  for (const item of structureItems(m)) {
    if (!types.has(item.type)) throw new Error(`structure: unknown type "${item.type}"`);
    if (seen.has(item.type)) throw new Error(`structure: type "${item.type}" is listed twice`);
    seen.add(item.type);
    if (blank(item.label)) throw new Error(`structure: type "${item.type}" has no label`);
  }
}

/**
 * Names no content type may have: the editor's own pages beside the type lists under
 * `/t/<tenant>/` (apps/cms/src/app/(editor)/t/[tenant]/). A type's list is `/t/<tenant>/<type>`, so
 * a type named after one of them could never be opened. The CMS app's tests hold this list to the
 * folders there.
 */
export const RESERVED_TYPE_NAMES: readonly string[] = Object.freeze(['assets']);

function checkTypeNames(m: ModuleManifest): void {
  for (const type of m.types) {
    if (RESERVED_TYPE_NAMES.includes(type.name)) throw new Error(`types: type "${type.name}" is the name of an editor page; choose another name`);
  }
}

/**
 * Declares a module. Throws when a type has a reserved name (`RESERVED_TYPE_NAMES`) or its
 * structure does not fit its types (see `checkStructure`).
 */
export function defineModule(m: ModuleManifest): ModuleManifest {
  checkTypeNames(m);
  checkStructure(m);
  return m;
}
