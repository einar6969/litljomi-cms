import { describe, expect, it } from 'vitest';
import { t } from '@/i18n/is';
import { summarizeStatus, type OverviewStatusRow, type Read, type StatusSummary } from '../overview';
import { usageState } from '../media/usage-state';

describe('usageState', () => {
  const ENTRY = 'e1';
  const proof = (rows: Parameters<typeof summarizeStatus>[0]): Read<StatusSummary> => ({ ok: true, value: summarizeStatus(rows) });
  const row = (o: Partial<OverviewStatusRow> = {}): OverviewStatusRow => ({
    entry_id: ENTRY,
    action: 'publish',
    status: 'committed',
    requested_at: '2026-11-01T10:00:00Z',
    release_status: 'delivered',
    omitted: false,
    site_count: 1,
    sites_notified: 1,
    sites_live_ok: 1,
    sites_not_confirmed: 0,
    retries_exhausted: false,
    live_retrying: false,
    latest_action: 'publish',
    nothing_checked: false,
    ...o,
  });
  const used = { entry_id: ENTRY, in_draft: true, in_published: true };

  it('is "on the site" only when the entry\'s publish is proven live', () => {
    expect(usageState(used, proof([row()]))).toEqual({ label: t.library.usage.live, tone: 'ok' });
    expect(usageState({ ...used, in_draft: false }, proof([row()]))).toEqual({ label: t.library.usage.live, tone: 'ok' });
  });

  it('is "in a draft" when only a draft uses the file, whatever the publish says', () => {
    expect(usageState({ entry_id: ENTRY, in_draft: true, in_published: false }, proof([row()]))).toEqual({ label: t.library.usage.draft, tone: 'neutral' });
    expect(usageState({ entry_id: ENTRY, in_draft: true, in_published: false }, { ok: false, code: 'x' })).toEqual({ label: t.library.usage.draft, tone: 'neutral' });
  });

  it('shows the entry\'s own unproven state for a committed publish not yet confirmed live', () => {
    for (const [o, label] of [
      [{ release_status: 'building' as const }, t.publish.inProgress],
      [{ sites_live_ok: 0, sites_notified: 1 }, t.publish.revalidated],
      [{ sites_live_ok: 0, sites_not_confirmed: 1 }, t.publish.notConfirmed],
      [{ nothing_checked: true }, t.publish.liveNothingChecked],
      [{ site_count: 0, sites_live_ok: 0, sites_notified: 0 }, t.publish.noSite],
    ] as const) {
      const state = usageState(used, proof([row(o)]));
      expect(state.label, label).toBe(label);
      expect(state.label).not.toBe(t.library.usage.live);
      expect(state.tone).not.toBe('ok');
    }
  });

  it('never says "on the site" without a proven row or a readable status', () => {
    expect(usageState(used, proof([]))).toEqual({ label: t.entries.statuses.published, tone: 'neutral' });
    expect(usageState(used, proof([row({ entry_id: 'other' })]))).toEqual({ label: t.entries.statuses.published, tone: 'neutral' });
    expect(usageState(used, { ok: false, code: 'capped' })).toEqual({ label: t.entries.statuses.published, tone: 'neutral' });
  });
});
