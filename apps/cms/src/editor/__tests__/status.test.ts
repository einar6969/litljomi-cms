import { describe, expect, it } from 'vitest';
import { DRAFT_OUTDATED } from '@litljomi/cms-schema';
import { t } from '@/i18n/is';
import { displayState, IN_PROGRESS, isFinal, type PublicationStatusRow, type RequestStatus } from '../publish/status';

const base: PublicationStatusRow = {
  latest_request_id: '00000000-0000-4000-8000-0000000000d1',
  latest_action: 'publish',
  request_id: '00000000-0000-4000-8000-0000000000e1',
  tenant_id: '00000000-0000-4000-8000-0000000000f1',
  entry_id: '00000000-0000-4000-8000-0000000000c1',
  action: 'publish',
  status: 'committed',
  error: null,
  requested_at: '2026-11-02T12:00:00Z',
  release_number: 4,
  release_status: 'delivered',
  omitted: false,
  missing_assets: null,
  site_count: 2,
  sites_notified: 2,
  sites_live_ok: 2,
  sites_not_confirmed: 0,
  retries_exhausted: false,
  live_retrying: false,
};
const row = (patch: Partial<PublicationStatusRow>): PublicationStatusRow => ({ ...base, ...patch });
const unpublish = (patch: Partial<PublicationStatusRow> = {}) => row({ action: 'unpublish', ...patch });

// Every value the view can give a delivered release's counts over two active sites: 0..2 notified,
// live ok and not confirmed (not more than the sites), with the retries exhausted or not (M3-02),
// and a live check retried or not (M3-03).
function* deliveredCombinations(): Generator<PublicationStatusRow> {
  for (const action of ['publish', 'unpublish'] as const)
    for (const omitted of [false, true])
      for (let notified = 0; notified <= 2; notified++)
        for (let live = 0; live <= notified; live++)
          for (let notConfirmed = 0; live + notConfirmed <= notified; notConfirmed++)
            for (const exhausted of [false, true])
              for (const retrying of [false, true])
                yield row({
                  action,
                  omitted,
                  sites_notified: notified,
                  sites_live_ok: live,
                  sites_not_confirmed: notConfirmed,
                  retries_exhausted: exhausted,
                  live_retrying: retrying && notConfirmed > 0 && !exhausted,
                });
}

describe('displayState: requested, committed and delivered (§7.4)', () => {
  it.each<RequestStatus>(['pending', 'validating'])('%s is "Í birtingu…", not final', (status) => {
    for (const action of ['publish', 'unpublish'] as const) {
      const state = displayState(row({ status, action, release_number: null, release_status: null, sites_notified: 0, sites_live_ok: 0 }));
      expect(state).toEqual({ label: 'Í birtingu…', tone: 'pending' });
      expect(isFinal(state)).toBe(false);
    }
  });

  it('committed without a release yet, or with a release still building or failed before delivery, is "Í birtingu…"', () => {
    for (const release_status of [null, 'building', 'failed'] as const) {
      for (const action of ['publish', 'unpublish'] as const) {
        // Counts from an earlier release cannot show through: the release is not delivered.
        const state = displayState(row({ action, release_status, release_number: release_status ? 5 : null }));
        expect(state).toEqual({ label: 'Í birtingu…', tone: 'pending' });
      }
    }
  });

  it('delivered with a site not yet notified (retrying, retries left) is "Í birtingu…"', () => {
    expect(displayState(row({ sites_notified: 1, sites_live_ok: 1, retries_exhausted: false }))).toEqual({
      label: 'Í birtingu…',
      tone: 'pending',
    });
    expect(displayState(row({ sites_notified: 0, sites_live_ok: 0 })).label).toBe('Í birtingu…');
  });

  it('revalidated: every active site notified, a live check still running, is "Bíður eftir vefnum"', () => {
    const state = displayState(row({ sites_notified: 2, sites_live_ok: 1, sites_not_confirmed: 0 }));
    expect(state).toEqual({ label: 'Bíður eftir vefnum', tone: 'pending' });
    expect(isFinal(state)).toBe(false);
    // One site not confirmed while the other is still checking: not final yet.
    expect(displayState(row({ sites_notified: 2, sites_live_ok: 0, sites_not_confirmed: 1 })).label).toBe('Bíður eftir vefnum');
  });
});

describe('displayState: live (decision 35)', () => {
  it('"Birt á vef ✓" when every active site\'s live_status is ok', () => {
    const state = displayState(row({}));
    expect(state).toEqual({ label: 'Birt á vef ✓', tone: 'ok' });
    expect(isFinal(state)).toBe(true);
    expect(displayState(row({ site_count: 1, sites_notified: 1, sites_live_ok: 1 })).label).toBe('Birt á vef ✓');
  });

  it('"Birt á vef ✓" appears for no other combination', () => {
    let live = 0;
    for (const r of deliveredCombinations()) {
      const state = displayState(r);
      const everySiteOk = r.sites_live_ok === r.site_count;
      if (state.label === 'Birt á vef ✓') {
        live++;
        expect(r).toMatchObject({ action: 'publish', status: 'committed', release_status: 'delivered', omitted: false });
        expect(everySiteOk).toBe(true);
      }
      if (r.action === 'publish' && !r.omitted && everySiteOk) expect(state.label).toBe('Birt á vef ✓');
    }
    expect(live).toBeGreaterThan(0);
    for (const status of ['pending', 'validating', 'failed_validation', 'superseded', 'rejected', 'failed'] as const) {
      expect(displayState(row({ status })).label).not.toBe('Birt á vef ✓');
    }
    for (const release_status of [null, 'building', 'failed'] as const) {
      expect(displayState(row({ release_status })).label).not.toBe('Birt á vef ✓');
    }
  });

  // The exact state ("Enginn vefur tengdur", a warning) is pinned below.
  it('never "Birt á vef ✓" for a tenant without an active site (no proof exists)', () => {
    expect(displayState(row({ site_count: 0, sites_notified: 0, sites_live_ok: 0 })).label).not.toBe('Birt á vef ✓');
  });

  it('every combination maps to one of the §7.4 labels', () => {
    const labels = new Set<string>([t.publish.inProgress, t.publish.revalidated, t.publish.live, t.publish.removed, t.publish.deliveryFailed, t.publish.notConfirmed, t.publish.notConfirmedRetrying]);
    for (const r of deliveredCombinations()) expect(labels).toContain(displayState(r).label);
  });
});

describe('displayState: failures', () => {
  it('omitted from the release is "Birting á vef mistókst", final, whatever the sites say', () => {
    for (const r of deliveredCombinations()) {
      if (r.action !== 'publish' || !r.omitted) continue;
      const state = displayState(r);
      expect(state).toMatchObject({ label: 'Birting á vef mistókst', tone: 'error' });
      expect(isFinal(state)).toBe(true);
    }
  });

  it('retries exhausted (24 hours of failed notifications, M3-02) is "Birting á vef mistókst", final', () => {
    for (const action of ['publish', 'unpublish'] as const) {
      const state = displayState(row({ action, sites_notified: 1, sites_live_ok: 1, retries_exhausted: true }));
      expect(state).toMatchObject({ label: 'Birting á vef mistókst', tone: 'error' });
      expect(isFinal(state)).toBe(true);
      expect(displayState(row({ action, sites_notified: 0, sites_live_ok: 0, retries_exhausted: true })).label).toBe('Birting á vef mistókst');
    }
  });

  it('build retries exhausted (24 hours of failed builds, M3-02) is "Birting á vef mistókst" before any release is delivered', () => {
    for (const release_status of [null, 'failed'] as const) {
      for (const action of ['publish', 'unpublish'] as const) {
        const state = displayState(row({ action, release_status, release_number: null, sites_notified: 0, sites_live_ok: 0, retries_exhausted: true }));
        expect(state).toMatchObject({ label: 'Birting á vef mistókst', tone: 'error' });
        expect(isFinal(state)).toBe(true);
      }
    }
  });

  it('every active site live ok wins over a stale exhausted flag (success is proven)', () => {
    expect(displayState(row({ retries_exhausted: true })).label).toBe('Birt á vef ✓');
  });

  it('live not confirmed and retried (M3-03): "Ekki enn staðfest á vef, reynt aftur…", pending (it changes on its own)', () => {
    for (const action of ['publish', 'unpublish'] as const) {
      const state = displayState(row({ action, sites_live_ok: 1, sites_not_confirmed: 1, live_retrying: true }));
      expect(state).toMatchObject({ label: t.publish.notConfirmedRetrying, tone: 'pending' });
      expect(state.label).toBe('Ekki enn staðfest á vef, reynt aftur…');
      expect(isFinal(state)).toBe(false);
    }
  });

  it('a retried publish says the entry has not been seen yet', () => {
    const state = displayState(row({ sites_live_ok: 1, sites_not_confirmed: 1, live_retrying: true }));
    expect(state.detail).toBe(t.publish.notConfirmedRetryingDetail);
  });

  it('a retried unpublish says the entry has not left the site yet (approved text)', () => {
    const state = displayState(unpublish({ sites_live_ok: 1, sites_not_confirmed: 1, live_retrying: true }));
    expect(state).toEqual({ label: t.publish.notConfirmedRetrying, tone: 'pending', detail: t.publish.notConfirmedRetryingUnpublishDetail });
    expect(state.detail).toBe('Beiðnin var send á vefinn en færslan hefur ekki enn horfið þaðan. Kerfið reynir aftur sjálfkrafa.');
  });

  it('live not confirmed with its retries exhausted (M3-03: 24 hours) is "Birting á vef mistókst", final', () => {
    const state = displayState(row({ sites_live_ok: 1, sites_not_confirmed: 1, retries_exhausted: true }));
    expect(state).toMatchObject({ label: 'Birting á vef mistókst', tone: 'error' });
    expect(isFinal(state)).toBe(true);
  });

  it('live not confirmed, no retry (a newer release superseded it): "Ekki staðfest á vef", final', () => {
    for (const action of ['publish', 'unpublish'] as const) {
      const state = displayState(row({ action, sites_live_ok: 1, sites_not_confirmed: 1 }));
      expect(state).toMatchObject({ label: 'Ekki staðfest á vef', tone: 'error' });
      expect(isFinal(state)).toBe(true);
      expect(displayState(row({ action, sites_live_ok: 0, sites_not_confirmed: 2 })).label).toBe('Ekki staðfest á vef');
    }
  });

  it('live not confirmed: the detail says the entry did not show for a publish, and that it is not proven gone for an unpublish', () => {
    expect(displayState(row({ action: 'publish', sites_live_ok: 1, sites_not_confirmed: 1 })).detail).toBe(
      'Færslan var send á vefinn en ekki tókst að staðfesta að hún birtist þar.',
    );
    const unpublish = displayState(row({ action: 'unpublish', sites_live_ok: 1, sites_not_confirmed: 1 }));
    expect(unpublish.detail).toBe('Beiðnin var send á vefinn en ekki tókst að staðfesta að færslan sé horfin þaðan.');
    expect(unpublish.detail).not.toContain('birtist');
  });

  // M5-01: the view skips a superseded repeat, so the publish it cancelled can be the shown request.
  it('a publish cancelled by a newer unpublish: says so, never "publish again"', () => {
    const state = displayState(row({ status: 'superseded', latest_request_id: 'u', latest_action: 'unpublish', release_status: null }));
    expect(state).toEqual({ label: t.publish.cancelled, tone: 'neutral' });
    expect(isFinal(state)).toBe(true);
  });

  it('superseded: "Færslunni var breytt eftir að þú ýttir á Birta. Birtu aftur."', () => {
    const state = displayState(row({ status: 'superseded', error: { code: 'superseded' }, release_status: null }));
    expect(state).toMatchObject({ label: 'Færslunni var breytt eftir að þú ýttir á Birta. Birtu aftur.', tone: 'error' });
    expect(isFinal(state)).toBe(true);
  });

  it('rejected: "Ekki heimilt að birta"; failed: "Birting mistókst. Reyndu aftur síðar."', () => {
    for (const action of ['publish', 'unpublish'] as const) {
      expect(displayState(row({ action, status: 'rejected', error: { code: 'forbidden' } }))).toMatchObject({ label: 'Ekki heimilt að birta', tone: 'error' });
      expect(displayState(row({ action, status: 'failed', error: { code: 'unexpected', attempts: 5 } }))).toMatchObject({
        label: 'Birting mistókst. Reyndu aftur síðar.',
        tone: 'error',
      });
    }
  });

  it('a status the display does not know is an error, never a success', () => {
    const state = displayState(row({ status: 'something_else' as RequestStatus }));
    expect(state.tone).toBe('error');
    expect(isFinal(state)).toBe(true);
    // The same final state as a request that failed (Task 25 quality r1: one branch for both).
    expect(state).toEqual(displayState(row({ status: 'failed' })));
  });
});

describe('displayState: failed_validation, "Ekki hægt að birta: …"', () => {
  const failed = (error: unknown, patch: Partial<PublicationStatusRow> = {}) =>
    displayState(row({ status: 'failed_validation', error, release_status: null, ...patch }), { fieldLabels: { title: 'Titill', startDate: 'Upphaf', image: 'Mynd' } });

  it('names the fields of invalid_data and projection_failed, once each, by their labels', () => {
    const state = failed({
      code: 'invalid_data',
      issues: [
        { code: 'too_small', path: ['title'], message: 'x' },
        { code: 'invalid_type', path: ['startDate'], message: 'y' },
        { code: 'too_small', path: ['title'], message: 'z' },
      ],
    });
    expect(state).toMatchObject({ label: 'Ekki hægt að birta: Titill, Upphaf', tone: 'error' });
    expect(isFinal(state)).toBe(true);
    expect(failed({ code: 'projection_failed', issues: [{ code: 'custom', path: ['image', 'alt'], message: 'x' }] }).label).toBe('Ekki hægt að birta: Mynd');
  });

  it('a field without a label is named by its key; a malformed issue list is generic', () => {
    expect(failed({ code: 'invalid_data', issues: [{ path: ['location'] }] }).label).toBe('Ekki hægt að birta: location');
    expect(failed({ code: 'invalid_data', issues: 'nope' }).label).toBe(`Ekki hægt að birta: ${t.publish.invalidGeneric}`);
    expect(failed({ code: 'invalid_data', issues: [{ path: [] }, { path: [7] }, null] }).label).toBe(`Ekki hægt að birta: ${t.publish.invalidGeneric}`);
  });

  it('names the fields of invalid references from their jsonpath', () => {
    const state = failed({
      code: 'invalid_reference',
      refs: [
        { path: '$."image"', kind: 'asset', id: 'a', reason: 'archived' },
        { path: '$."body"."content"[0]."attrs"', kind: 'entry', id: 'b', reason: 'unpublished' },
      ],
    });
    expect(state.label).toBe('Ekki hægt að birta: Mynd, body');
  });

  it('slug_required names the slug field', () => {
    expect(failed({ code: 'slug_required' }).label).toBe(`Ekki hægt að birta: ${t.editor.slug.label}`);
  });

  it('asset_missing names the missing images by filename (decision 36.4)', () => {
    const state = failed({ code: 'asset_missing', assetIds: ['x', 'y'] }, { missing_assets: ['rugbraud.jpg', 'kaka.png'] });
    expect(state).toEqual({ label: 'Ekki hægt að birta: rugbraud.jpg, kaka.png', tone: 'error', detail: t.publish.missingImageDetail });
    // An image the editor cannot see any more is still reported, without a name.
    expect(failed({ code: 'asset_missing', assetIds: ['x'] }, { missing_assets: null }).label).toBe(`Ekki hægt að birta: ${t.publish.missingImage}`);
  });

  it(`${DRAFT_OUTDATED} (M2-05) says in plain words that the draft is outdated and how to fix it (M2-14)`, () => {
    const state = failed({ code: DRAFT_OUTDATED, draftSchemaVersion: 1, currentSchemaVersion: 2 });
    expect(state).toEqual({ label: `Ekki hægt að birta: ${t.publish.outdated}`, tone: 'error', detail: t.publish.outdatedDetail });
    expect(isFinal(state)).toBe(true);
    // The versions are the worker's, not the editor's words: they are not shown.
    expect(JSON.stringify(state)).not.toMatch(/[12]/);
  });

  it('other codes (schema, type) are generic', () => {
    for (const error of [{ code: 'upcast_failed' }, { code: 'draft_schema_ahead' }, { code: 'unknown_type' }, null, 'x']) {
      expect(failed(error).label).toBe(`Ekki hægt að birta: ${t.publish.invalidGeneric}`);
    }
  });

  it('labels without options use the field keys', () => {
    const state = displayState(row({ status: 'failed_validation', error: { code: 'invalid_data', issues: [{ path: ['title'] }] } }));
    expect(state.label).toBe('Ekki hægt að birta: title');
  });
});

describe('displayState: no active site (decision 39.3)', () => {
  it('a delivered release in a tenant without an active site is "Enginn vefur tengdur", a final warning, never a success', () => {
    for (const action of ['publish', 'unpublish'] as const) {
      const state = displayState(row({ action, site_count: 0, sites_notified: 0, sites_live_ok: 0, sites_not_confirmed: 0 }));
      expect(state).toEqual({ label: 'Enginn vefur tengdur', tone: 'warning' });
      expect(isFinal(state)).toBe(true);
    }
  });

  it('before delivery it is still "Í birtingu…", and an omitted publish is still "Birting á vef mistókst"', () => {
    for (const release_status of [null, 'building', 'failed'] as const) {
      expect(displayState(row({ site_count: 0, sites_notified: 0, sites_live_ok: 0, release_status })).label).toBe('Í birtingu…');
    }
    expect(displayState(row({ status: 'pending', site_count: 0, sites_notified: 0, sites_live_ok: 0 })).label).toBe('Í birtingu…');
    expect(displayState(row({ omitted: true, site_count: 0, sites_notified: 0, sites_live_ok: 0 })).label).toBe('Birting á vef mistókst');
  });

  it('a tenant with an active site never shows it', () => {
    for (const r of deliveredCombinations()) expect(displayState(r).label).not.toBe('Enginn vefur tengdur');
  });
});

describe('displayState: unpublish', () => {
  it('confirmed on every active site is "Tekið af vef", final and neutral, and its detail never claims removal from caches', () => {
    const state = displayState(unpublish());
    expect(state).toMatchObject({ label: 'Tekið af vef', tone: 'neutral' });
    expect(isFinal(state)).toBe(true);
    expect(state.detail).toBe(t.publish.removedDetail);
    // The detail says copies may remain; it never says they were removed.
    expect(state.detail).not.toMatch(/fjarlægð|eytt|horfin/i);
    expect(state.detail).toMatch(/skyndiminni/);
  });

  it('an unpublish is never "Birt á vef ✓", and is "Tekið af vef" only when every active site confirmed', () => {
    for (const r of deliveredCombinations()) {
      if (r.action !== 'unpublish') continue;
      const label = displayState(r).label;
      expect(label).not.toBe('Birt á vef ✓');
      if (label === 'Tekið af vef') expect(r.sites_live_ok).toBe(r.site_count);
    }
  });

  it('an omitted flag never affects an unpublish (withdrawal: nothing to omit)', () => {
    expect(displayState(unpublish({ omitted: true })).label).toBe('Tekið af vef');
  });
});

describe('tones', () => {
  it('only "Birt á vef ✓" is ok, only "Tekið af vef" is neutral, and only "Enginn vefur tengdur" is a warning', () => {
    const rows = [...deliveredCombinations()].flatMap((r) => [r, { ...r, site_count: 0, sites_notified: 0, sites_live_ok: 0, sites_not_confirmed: 0 }]);
    for (const r of rows) {
      const { label, tone } = displayState(r);
      expect(tone === 'ok', label).toBe(label === t.publish.live);
      expect(tone === 'neutral', label).toBe(label === t.publish.removed);
      expect(tone === 'warning', label).toBe(label === t.publish.noSite);
    }
  });
});

describe('IN_PROGRESS', () => {
  it('is the one "Í birtingu…" state: pending and not final, the same object displayState returns', () => {
    expect(IN_PROGRESS).toEqual({ label: t.publish.inProgress, tone: 'pending' });
    expect(isFinal(IN_PROGRESS)).toBe(false);
    expect(displayState(row({ status: 'pending', release_status: null }))).toBe(IN_PROGRESS);
  });
});

describe('isFinal', () => {
  it('is true for ok, neutral, warning and error, false for pending', () => {
    expect(isFinal({ label: 'x', tone: 'ok' })).toBe(true);
    expect(isFinal({ label: 'x', tone: 'neutral' })).toBe(true);
    expect(isFinal({ label: 'x', tone: 'warning' })).toBe(true);
    expect(isFinal({ label: 'x', tone: 'error' })).toBe(true);
    expect(isFinal({ label: 'x', tone: 'pending' })).toBe(false);
  });
});
