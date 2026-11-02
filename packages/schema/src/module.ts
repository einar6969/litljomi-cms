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
  structure: Array<{ type: string; label: string }>;
  /** Site integration per content type name. */
  site: Record<string, SiteIntegration>;
}

export function defineModule(m: ModuleManifest): ModuleManifest {
  return m;
}
