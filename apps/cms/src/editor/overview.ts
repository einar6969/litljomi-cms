// The tenant overview's logic (spec §7.4), with no I/O: what the band says, which entries wait,
// what each pill shows, and the words for counts and times. Success is never shown before its
// proof exists, so a read that failed, was capped or is missing is never a smaller number: it
// takes every claim about the site away.
import type { StructureNode } from '@litljomi/cms-schema';
import { t } from '@/i18n/is';
import type { BadgeTone } from '@/ui/StatusBadge';
import { displayState, type DisplayState, type PublicationStatusRow } from './publish/status';
import { navSections, type NavItem } from './structure';

/** A read that succeeded, or failed with its code only (never the database's message). */
export type Read<T> = { ok: true; value: T } | { ok: false; code: string };

/** The columns of `api.publication_status` the overview reads: what `displayState` needs for a state's tone, and what `summarizeStatus` uses. */
export const OVERVIEW_STATUS_FIELDS = [
  'entry_id',
  'action',
  'status',
  'requested_at',
  'release_status',
  'omitted',
  'site_count',
  'sites_notified',
  'sites_live_ok',
  'sites_not_confirmed',
  'retries_exhausted',
  'live_retrying',
  'latest_action',
] as const satisfies readonly (keyof PublicationStatusRow)[];

export type OverviewStatusRow = Pick<PublicationStatusRow, (typeof OVERVIEW_STATUS_FIELDS)[number]>;

export type EntryStatus = keyof typeof t.entries.statuses;

/** One entry as the recent list and the Síður card show it. */
export type OverviewEntry = { id: string; type: string; title: string | null; status: EntryStatus; updated_at: string };

/** A card's count line: entries that are not archived, and the never-published drafts among them. */
export type EntryCount = { total: number; drafts: number };

/** A row of the Síður card: a singleton type, and its entry once it has one. */
export type OverviewPage = { type: string; label: string; entry: OverviewEntry | null };

/** The active site: `url` is null when its base URL cannot be linked to. It still counts as a site. */
export type OverviewSite = { url: string | null };

export type StatusSummary = {
  /** Entries whose latest publish every active site has confirmed. */
  proven: ReadonlySet<string>;
  /** Entries whose latest request proves nothing and says why: on its way, gone wrong, or with no site to prove it on. */
  unproven: ReadonlyMap<string, DisplayState>;
  /** An entry's latest request went wrong, or a site did not confirm it, retried or not. */
  failed: boolean;
  /** The newest `requested_at` among proven rows. */
  lastPublished: string | null;
};

export type Band = {
  heading: string;
  /** "Í loftinu": green, so only with proof and no failure. */
  tag: boolean;
  lastPublished: string | null;
  viewChanges: boolean;
  siteUrl: string | null;
};

type BandReads = { site: Read<OverviewSite | null>; changed: Read<string[]>; status: Read<StatusSummary> };

/** The rest of a `PublicationStatusRow`: never read. `error` and `missing_assets` only name a failure in detail; without them `displayState` gives the same tone. */
const UNREAD: Omit<PublicationStatusRow, keyof OverviewStatusRow> = {
  request_id: '',
  tenant_id: '',
  error: null,
  release_number: null,
  missing_assets: null,
  latest_request_id: '',
};

const STATUS_TONE: Record<EntryStatus, BadgeTone> = { published: 'ok', changed: 'warning', archived: 'hollow', draft: 'neutral' };

const isSingular = (n: number): boolean => n % 10 === 1 && n % 100 !== 11;

export const waitingHeading = (n: number): string =>
  (isSingular(n) ? t.overview.waitingOne : t.overview.waitingMany).replace('{n}', String(n));

export function entriesLine(total: number, drafts: number): string {
  const line = (isSingular(total) ? t.overview.entriesOne : t.overview.entriesMany).replace('{n}', String(total));
  return drafts > 0 ? line + t.overview.drafts.replace('{d}', String(drafts)) : line;
}

/** The list types and the singleton types of the structure, each in declared order. */
export function overviewTypes(structure: StructureNode[]): { list: NavItem[]; singletons: NavItem[] } {
  const items = navSections(structure).flatMap((section) => section.items);
  return { list: items.filter((item) => !item.singleton), singletons: items.filter((item) => item.singleton) };
}

/** `?breytingar=1`: a search param can be anything, and only this exact value counts. */
export const parseChangesParam = (value: unknown): boolean => value === '1';

/** The base URL when it is safe to link to: an http or https URL. */
export function usableSiteUrl(baseUrl: string): string | null {
  try {
    const { protocol } = new URL(baseUrl);
    return protocol === 'http:' || protocol === 'https:' ? baseUrl : null;
  } catch {
    return null;
  }
}

/** Sorts the rows by what they prove. The one §7.4 derivation is `displayState`. */
export function summarizeStatus(rows: readonly OverviewStatusRow[]): StatusSummary {
  const proven = new Set<string>();
  const unproven = new Map<string, DisplayState>();
  let failed = false;
  let lastPublished: string | null = null;
  for (const row of rows) {
    const state = displayState({ ...row, ...UNREAD });
    if (row.action === 'publish' && state.tone === 'ok') {
      proven.add(row.entry_id);
      if (lastPublished === null || Date.parse(row.requested_at) > Date.parse(lastPublished)) lastPublished = row.requested_at;
    }
    if (state.tone === 'pending' || state.tone === 'error' || state.tone === 'warning') unproven.set(row.entry_id, state);
    if (state.tone === 'error' || (state.tone === 'pending' && row.sites_not_confirmed > 0)) failed = true;
  }
  return { proven, unproven, failed, lastPublished };
}

/**
 * The entries that wait: with a request on its way or gone wrong first, then changed since their
 * publication, in `changed`'s order. Each once. "No site" does not wait, or n would grow by every
 * published entry.
 */
export function waitingIds(changed: readonly string[], summary: StatusSummary): string[] {
  const unproven = [...summary.unproven].filter(([, state]) => state.tone === 'pending' || state.tone === 'error').map(([id]) => id);
  return [...new Set([...unproven, ...changed])];
}

/** Whether the band has reached "nothing proven, n = 0", the one place the published count decides. */
export function needsPublishedCount({ site, changed, status }: BandReads): boolean {
  if (!site.ok || !changed.ok || !status.ok || site.value === null) return false;
  return status.value.proven.size === 0 && waitingIds(changed.value, status.value).length === 0;
}

/**
 * The band: its order is the point. A read that failed or was capped comes first, then no site,
 * and only then what the rows prove. "Vefurinn þinn er uppfærður." needs an active site, every read,
 * nothing waiting and a proven row.
 */
export function deriveBand({ site, changed, status, published }: BandReads & { published: Read<number> | null }): Band {
  const siteUrl = site.ok ? (site.value?.url ?? null) : null;
  const closed = { heading: t.publish.statusUnavailable, tag: false, lastPublished: null, viewChanges: false, siteUrl };
  if (!site.ok || !changed.ok || !status.ok || published?.ok === false) return closed;
  const n = waitingIds(changed.value, status.value).length;
  const viewChanges = n > 0;
  if (site.value === null) return { ...closed, heading: t.publish.noSite, viewChanges };
  const open = {
    tag: status.value.proven.size > 0 && !status.value.failed,
    lastPublished: status.value.lastPublished,
    viewChanges,
    siteUrl,
  };
  if (n > 0) return { ...open, heading: waitingHeading(n) };
  if (status.value.proven.size > 0) return { ...open, heading: t.overview.upToDate };
  // Something was published and nothing proves it, or the count is missing: never reassure.
  return published?.value === 0 ? { ...open, heading: t.overview.nothingPublished } : closed;
}

/**
 * What an entry's pill shows. An unproven request shows its own state, never "Birt", and the
 * `ok` tone needs that entry's proven row: a published entry without one is neutral, as it is when
 * the status read failed or was capped.
 */
export function entryPill(entry: Pick<OverviewEntry, 'id' | 'status'>, status: Read<StatusSummary>): { label: string; tone: BadgeTone } {
  const state = status.ok ? status.value.unproven.get(entry.id) : undefined;
  if (state) return { label: state.label, tone: state.tone };
  const label = t.entries.statuses[entry.status] ?? entry.status;
  if (entry.status === 'published' && !(status.ok && status.value.proven.has(entry.id))) return { label, tone: 'neutral' };
  return { label, tone: STATUS_TONE[entry.status] ?? 'neutral' };
}

const TIME_ZONE = 'Atlantic/Reykjavik';
const LOCALE = 'is-IS';
const dayParts = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric', month: 'numeric', day: 'numeric' });
const clock = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dayMonth = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, day: 'numeric', month: 'short' });
const dayMonthYear = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' });

/** The calendar day of an instant in Reykjavík, as a day number, so days can be subtracted. */
function reykjavikDay(date: Date): { day: number; year: number } {
  const part = (type: string) => Number(dayParts.formatToParts(date).find((p) => p.type === type)!.value);
  const year = part('year');
  return { year, day: Date.UTC(year, part('month') - 1, part('day')) / 86_400_000 };
}

/** `í dag, 14:32`, `í gær, 16:20`, `2. nóv., 13:12`, or with the year when it is not `now`'s. */
export function formatOverviewTime(iso: string, now: Date): string {
  const date = new Date(iso);
  const then = reykjavikDay(date);
  const today = reykjavikDay(now);
  const time = clock.format(date);
  if (then.day === today.day) return `${t.overview.today}, ${time}`;
  if (then.day === today.day - 1) return `${t.overview.yesterday}, ${time}`;
  return `${(then.year === today.year ? dayMonth : dayMonthYear).format(date)}, ${time}`;
}
