/** Bundle format v1 (spec §7.2). */

export interface Pointer {
  format: 1;
  tenant: string;
  release: number;
  bundle: string;
  generatedAt: string;
}

export interface BundleEntry<T = Record<string, unknown>> {
  id: string;
  revisionId: string;
  contentHash: string;
  slug: string | null;
  title: string | null;
  sortAt: string | null;
  firstPublishedAt: string;
  lastPublishedAt: string;
  schemaVersion: number;
  data: T;
}

export interface Bundle {
  format: 1;
  tenant: string;
  release: number;
  generatedAt: string;
  entries: Record<string, BundleEntry[]>;
}
