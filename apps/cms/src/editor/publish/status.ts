// What the editor is shown about an entry's publication (spec §6.3, §7.4; plan Task 25, decisions
// 35, 36.1, 36.4 and 37.8), derived from its row of `api.publication_status`. Success is never
// shown before its proof exists: "Birt á vef ✓" only when every active site's live_status is 'ok'
// for the request's delivered release. No text promises removal from caches ("Withdrawal and
// failure visibility").
import { t } from '@/i18n/is';

export type RequestStatus = 'pending' | 'validating' | 'committed' | 'failed_validation' | 'superseded' | 'rejected' | 'failed';

/** One row of `api.publication_status` (20261103190000_not_confirmed_retry.sql): an entry's latest request. */
export type PublicationStatusRow = {
  request_id: string;
  tenant_id: string;
  entry_id: string;
  action: 'publish' | 'unpublish';
  status: RequestStatus;
  error: unknown;
  requested_at: string;
  release_number: number | null;
  release_status: 'building' | 'delivered' | 'failed' | null;
  /** Delivery failed for this entry: the request's release, or a newer delivered one, recorded it in `releases.error.omitted` or `.fallback` (§7.1). */
  omitted: boolean;
  /** asset_missing only: the missing images' filenames. */
  missing_assets: string[] | null;
  /** The tenant's active sites, and how many of them are notified, live ok and not confirmed. */
  site_count: number;
  sites_notified: number;
  sites_live_ok: number;
  sites_not_confirmed: number;
  /**
   * The request will not be retried any more (M3-02): an active site's notification failed for 24
   * hours, or the request's build did.
   */
  retries_exhausted: boolean;
  /**
   * A site's live check missed (not_confirmed) and the sweep will check it again (M3-03): the
   * request's release is the tenant's latest delivered one and its retries are not exhausted.
   */
  live_retrying: boolean;
};

/**
 * `pending` changes on its own; every other tone is final. `ok` is "Birt á vef ✓", `neutral` is
 * "Tekið af vef", `warning` is "Enginn vefur tengdur", `error` every failure (Task 32).
 */
export type DisplayState = { label: string; tone: 'pending' | 'ok' | 'neutral' | 'warning' | 'error'; detail?: string };

export type DisplayOptions = {
  /** The content type's field labels by key, to name the fields a validation failure is about. */
  fieldLabels?: Readonly<Record<string, string>>;
};

/** The columns the panel reads, in the view's order. */
export const PUBLICATION_STATUS_COLUMNS =
  'request_id, tenant_id, entry_id, action, status, error, requested_at, release_number, release_status, omitted, ' +
  'missing_assets, site_count, sites_notified, sites_live_ok, sites_not_confirmed, retries_exhausted, live_retrying';

/** "Í birtingu…": a request on its way. The panel also shows it while it waits for its own new request's row. */
export const IN_PROGRESS: Readonly<DisplayState> = Object.freeze({ label: t.publish.inProgress, tone: 'pending' });

/** True once the state can no longer change without a new request: polling stops. */
export const isFinal = (state: DisplayState): boolean => state.tone !== 'pending';

/**
 * The §7.4 state of an entry's latest request:
 *
 * - requested, validating, committed, and delivered but not every site notified → "Í birtingu…"
 *   (a release still building, or one that failed before delivery, links no request, so it is
 *   "committed" here too);
 * - every active site notified, a live check still running → "Bíður eftir vefnum";
 * - every active site's live_status ok → "Birt á vef ✓" (publish) or "Tekið af vef" (unpublish, neutral);
 * - left out of the release, or its retries exhausted (24 hours of failed builds, notifications or
 *   live checks, M3-02 and M3-03) → "Birting á vef mistókst";
 * - every site settled, one not confirmed and checked again later (M3-03) → "Ekki enn staðfest á
 *   vef, reynt aftur…", pending (it changes on its own);
 * - every site settled, one not confirmed and no retry left (its release superseded by a newer
 *   one) → "Ekki staðfest á vef";
 * - delivered in a tenant with no active site → "Enginn vefur tengdur", a final warning (decision 39.3);
 * - the request's own failures: failed_validation, superseded, rejected, failed.
 *
 * A tenant with no active site never reaches a confirmed state: there is nothing to prove it on.
 */
export function displayState(row: PublicationStatusRow, options: DisplayOptions = {}): DisplayState {
  switch (row.status) {
    case 'pending':
    case 'validating':
      return IN_PROGRESS;
    case 'committed':
      return deliveryState(row);
    case 'failed_validation':
      return invalidState(row, options.fieldLabels ?? {});
    case 'superseded':
      return { label: t.publish.superseded, tone: 'error' };
    case 'rejected':
      return { label: t.publish.rejected, tone: 'error' };
    case 'failed':
    default:
      // Fail closed: a status this display does not know is shown as failed, never as success.
      return { label: t.publish.failed, tone: 'error' };
  }
}

function deliveryState(row: PublicationStatusRow): DisplayState {
  const deliveryFailed: DisplayState = { label: t.publish.deliveryFailed, tone: 'error', detail: t.publish.deliveryFailedDetail };
  // §7.4, M3-02: a build that kept failing for 24 hours is not retried; the admin was alerted.
  if (row.release_status !== 'delivered') return row.retries_exhausted ? deliveryFailed : IN_PROGRESS;
  // §7.1: an entry left out of a release is never live. An unpublish has nothing to leave out.
  if (row.action === 'publish' && row.omitted) return deliveryFailed;
  const sites = row.site_count;
  // Decision 39.3: nothing will ever confirm it, so the panel stops polling. Never a success.
  if (sites === 0) return { label: t.publish.noSite, tone: 'warning' };
  if (row.sites_live_ok === sites) {
    return row.action === 'publish' ? { label: t.publish.live, tone: 'ok' } : { label: t.publish.removed, tone: 'neutral', detail: t.publish.removedDetail };
  }
  // §7.4, M3-02: the sweep stops retrying 24 hours after the first failure and alerts.
  if (row.retries_exhausted) return deliveryFailed;
  if (row.sites_live_ok + row.sites_not_confirmed === sites) {
    // M3-03: the sweep notifies the site again and re-runs the live check on M3-02's schedule.
    if (row.live_retrying) return { label: t.publish.notConfirmedRetrying, tone: 'pending', detail: t.publish.notConfirmedRetryingDetail };
    return { label: t.publish.notConfirmed, tone: 'error', detail: t.publish.notConfirmedDetail };
  }
  if (row.sites_notified === sites) return { label: t.publish.revalidated, tone: 'pending' };
  return IN_PROGRESS;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// A reference's location as the database records it: jsonpath with quoted keys, `$."field"…`.
const REF_FIELD = /^\$\."([A-Za-z0-9_-]{1,64})"/;

/** The keys of the top-level fields a recorded validation error is about, in order, once each. */
function fieldKeysOf(error: Record<string, unknown>): string[] {
  const keys: string[] = [];
  if (Array.isArray(error.issues)) {
    for (const issue of error.issues) {
      const first = isObject(issue) && Array.isArray(issue.path) ? issue.path[0] : undefined;
      if (typeof first === 'string' && first !== '') keys.push(first);
    }
  }
  if (Array.isArray(error.refs)) {
    for (const ref of error.refs) {
      const match = isObject(ref) && typeof ref.path === 'string' ? REF_FIELD.exec(ref.path) : null;
      if (match) keys.push(match[1]!);
    }
  }
  return [...new Set(keys)];
}

function invalidState(row: PublicationStatusRow, labels: Readonly<Record<string, string>>): DisplayState {
  const error = isObject(row.error) ? row.error : {};
  const named = (names: string[], detail?: string): DisplayState => ({
    label: `${t.publish.invalid} ${names.length > 0 ? names.join(', ') : t.publish.invalidGeneric}`,
    tone: 'error',
    ...(detail ? { detail } : {}),
  });
  if (error.code === 'asset_missing') {
    const files = (row.missing_assets ?? []).filter((f) => typeof f === 'string' && f !== '');
    return named(files.length > 0 ? files : [t.publish.missingImage], t.publish.missingImageDetail);
  }
  if (error.code === 'slug_required') return named([t.editor.slug.label], t.publish.invalidDetail);
  const keys = fieldKeysOf(error);
  return named(
    keys.map((key) => (Object.hasOwn(labels, key) ? labels[key]! : key)),
    keys.length > 0 ? t.publish.invalidDetail : undefined,
  );
}
