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

/** An image's focal point: fractions of its width and height, each in 0..1 from the top left. */
export interface FocalPoint {
  x: number;
  y: number;
}

/**
 * An image field's value in `data` (spec §5.6, §7.1): the public copy with this use's alt text.
 * `focal` is an additive field of format 1 (spec §7.2): null when the editor set none, and
 * absent in a bundle written before it was delivered, so read it as optional.
 */
export interface PublicAsset {
  id: string;
  url: string;
  width: number;
  height: number;
  mime: string;
  alt: string;
  focal?: FocalPoint | null;
}

/** A referenced entry in `data` (spec §4.3, §7.1); null in place of one that is not published. */
export interface EntrySummary {
  id: string;
  type: string;
  slug: string | null;
  title: string | null;
  path: string | null;
}
