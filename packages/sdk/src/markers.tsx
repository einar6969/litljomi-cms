import type { BundleEntry } from './bundle.ts';

/**
 * Render inside the component that renders the entry. The id and hash together are the proof of
 * delivery (spec §7.4).
 */
export function CmsEntryMarker({ entry }: { entry: Pick<BundleEntry, 'id' | 'contentHash'> }) {
  return <span hidden data-cms-entry={entry.id} data-cms-hash={entry.contentHash} />;
}

/** Diagnostic only: a release marker is never proof that an entry is live. */
export function CmsReleaseMarker({ release }: { release: number }) {
  return <meta name="cms-release" content={String(release)} />;
}
