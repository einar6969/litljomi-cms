// What a delivered release must confirm on the sites, entry by entry (spec §7.1, §7.4; plan Task 21,
// decision 35; A7). Pure: the release build records the entries that have nothing to check
// (build-release.ts), and the delivery checks the rest (deliver.ts), from the same targets.
import { isManuallyOrdered, type LiveCheck, type ModuleManifest, type ReleaseView, type SiteEntry } from '@litljomi/cms-schema';
import type { Bundle, BundleEntry } from '@litljomi/cms-sdk';
import type { LinkedRequest } from './build-release';

/** One entry to confirm: a failure decided before any fetch, or its checks. */
export type LiveTarget = {
  entryId: string;
  requestIds: string[];
  /**
   * `delivery_failed` (left out of the release, §7.1), `still_published` (withdrawn, but the entry is
   * in the release), `withdrawal_unchecked` (withdrawn, an earlier release reached a site with it,
   * and no bundle here holds a record to check it by) or `checks_failed` (the module threw).
   */
  failure: string | null;
  checks: LiveCheck[];
  /** The entry's own path; null when its type has no page of its own (A7) or no integration. */
  ownPath: string | null;
  contentHash: string | null;
  mediaUrls: string[];
  /**
   * W1: a withdrawal of this release (the entry's last request is an unpublish, the entry is not in
   * the release, no failure but `withdrawal_unchecked`). Its checks are stored on a delivery that
   * misses them.
   */
  withdrawal?: true;
  /**
   * A7, §7.4: no failure, the entry is (or was, for a withdrawal) on a site, and no page is checked
   * for it: its type has no site integration, or the module's checks are empty. The delivery runs
   * what there is (its media) and the release records it (`releases.error.nothingChecked`), so the
   * editor sees "published, not confirmed", never the confirmed state.
   */
  nothingChecked?: true;
};

/** The releases a target is computed from. */
export type TargetRelease = { bundle: Bundle; previousBundle: Bundle | null; requests: LinkedRequest[] };

/**
 * A bundle as the module's `checks` see it: each type's entries by sortAt descending, except a
 * manually ordered type's (`manual`, A12), which keep the bundle's order: the editors' order, as
 * the build wrote it (§7.2).
 */
export function releaseView(bundle: Bundle | null, manual: ReadonlySet<string> = new Set()): ReleaseView {
  return {
    entries(type: string): SiteEntry[] {
      const list = bundle && Object.hasOwn(bundle.entries, type) ? (bundle.entries[type] ?? []) : [];
      const entries = list.map((e) => siteEntry(type, e));
      if (manual.has(type)) return entries;
      return entries.sort((a, b) => (a.sortAt === b.sortAt ? 0 : a.sortAt === null ? 1 : b.sortAt === null ? -1 : a.sortAt < b.sortAt ? 1 : -1));
    },
  };
}

/** The names of the module's manually ordered types (A12). */
export const manualTypes = (module: Pick<ModuleManifest, 'types'>): ReadonlySet<string> =>
  new Set(module.types.filter((t) => isManuallyOrdered(t)).map((t) => t.name));

const siteEntry = (type: string, e: BundleEntry): SiteEntry => ({ id: e.id, type, slug: e.slug, sortAt: e.sortAt });

function find(bundle: Bundle | null, id: string): { type: string; entry: BundleEntry } | null {
  if (!bundle) return null;
  for (const [type, list] of Object.entries(bundle.entries)) {
    const entry = list.find((e) => e.id === id);
    if (entry) return { type, entry };
  }
  return null;
}

/** Every string in the projected data that is a public media URL (`mediaPrefix` + path), in order, once. */
function mediaUrlsIn(data: unknown, mediaPrefix: string): string[] {
  const found = new Set<string>();
  const walk = (v: unknown, depth: number) => {
    if (depth > 256) return;
    if (typeof v === 'string') {
      if (v.startsWith(mediaPrefix) && v.length > mediaPrefix.length) found.add(v);
    } else if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
    } else if (v !== null && typeof v === 'object') {
      for (const x of Object.values(v)) walk(x, depth + 1);
    }
  };
  walk(data, 0);
  return [...found];
}

/**
 * The entries a release must confirm, one per entry among its linked requests (in request order).
 * The release's content decides what is checked, so it agrees with the module's checks:
 *
 * - in the release: the module's checks for it (given this release and the previous one), its new
 *   content hash, its own path (none for a type without one, A7) and its media URLs;
 * - not in the release, with a publish as its last request: left out of the build (omitted), so
 *   `delivery_failed` (§7.1: never live);
 * - not in the release after an unpublish: the checks for the record the previous release had
 *   (no hash, no media). With no such record, nothing to check when no site ever had it (§7.4;
 *   api.worker_entry_was_delivered); otherwise `withdrawal_unchecked`: a site may still hold it
 *   (from an older release, or a failed release whose pointer was written), so the withdrawal is
 *   never confirmed with nothing checked (M5-01);
 * - in the release, with an unpublish as its last request: `still_published`. The withdrawal is not
 *   what the release delivered (an older publish committed after it, say), so it is never confirmed:
 *   the entry's own present checks would pass and show it removed (§7.1: withdrawal always wins).
 *
 * A target with a record, no failure and no page check is `nothingChecked` (A7).
 */
export function liveTargets(module: ModuleManifest, release: TargetRelease, mediaPrefix: string): LiveTarget[] {
  const byEntry = new Map<string, LinkedRequest[]>();
  for (const r of release.requests) byEntry.set(r.entryId, [...(byEntry.get(r.entryId) ?? []), r]);
  const manual = manualTypes(module);
  const current = releaseView(release.bundle, manual);
  const previous = release.previousBundle ? releaseView(release.previousBundle, manual) : null;

  return [...byEntry].map(([entryId, requests]): LiveTarget => {
    const base = { entryId, requestIds: requests.map((r) => r.id), failure: null, checks: [], ownPath: null, contentHash: null, mediaUrls: [] };
    const inRelease = find(release.bundle, entryId);
    const last = requests[requests.length - 1]!;
    if (!inRelease && last.action === 'publish') return { ...base, failure: 'delivery_failed' };
    if (inRelease && last.action === 'unpublish') return { ...base, failure: 'still_published' };
    const record = inRelease ?? find(release.previousBundle, entryId);
    const withdrawal = !inRelease && last.action === 'unpublish' ? ({ withdrawal: true } as const) : {};
    if (!record) return last.wasDelivered === false ? { ...base, ...withdrawal } : { ...base, ...withdrawal, failure: 'withdrawal_unchecked' };
    const own = inRelease ? { contentHash: inRelease.entry.contentHash, mediaUrls: mediaUrlsIn(inRelease.entry.data, mediaPrefix) } : {};
    const nothingChecked = { nothingChecked: true } as const;
    const integration = Object.hasOwn(module.site, record.type) ? module.site[record.type] : undefined;
    if (!integration) return { ...base, ...own, ...withdrawal, ...nothingChecked };
    try {
      const e = siteEntry(record.type, record.entry);
      const checks = integration.checks(e, current, previous);
      const ownPath = integration.path ? integration.path(e) : null;
      return { ...base, ...own, ...withdrawal, checks, ownPath, ...(checks.length === 0 ? nothingChecked : {}) };
    } catch {
      return { ...base, ...own, failure: 'checks_failed' };
    }
  });
}
