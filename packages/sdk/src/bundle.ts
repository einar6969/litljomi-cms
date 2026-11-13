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
 * `focal`, `caption` and `credit` are additive fields of format 1 (spec §7.2): null when the file
 * has none, and absent in a bundle written before each was delivered, so read them as optional.
 * The caption and the credit (photographer or source) are the file's own, the same with every
 * use; the alt text is the use's.
 */
export interface PublicAsset {
  id: string;
  url: string;
  width: number;
  height: number;
  mime: string;
  alt: string;
  focal?: FocalPoint | null;
  caption?: string | null;
  credit?: string | null;
}

/** A referenced entry in `data` (spec §4.3, §7.1); null in place of one that is not published. */
export interface EntrySummary {
  id: string;
  type: string;
  slug: string | null;
  title: string | null;
  path: string | null;
}

/**
 * A video field's value in `data` (spec §5.2, §7.1): a link to a video on YouTube or Vimeo, not a
 * file. `provider` and `id` are read from `url` by the release build; a site embeds the player from
 * them (or links to `url`). `still` is delivered exactly as an image field's value, null when the
 * editor set none. An additive type of format 1 (spec §7.2).
 */
export interface PublicVideo {
  provider: 'youtube' | 'vimeo';
  id: string;
  url: string;
  title: string;
  still: PublicAsset | null;
}
