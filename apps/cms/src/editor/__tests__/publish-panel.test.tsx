// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n/is';
import { displayState, type PublicationStatusRow } from '../publish/status';

vi.mock('@/lib/supabase/browser', () => ({ createBrowserEditorClient: () => ({}) }));
vi.mock('@/app/(editor)/t/[tenant]/publish-actions', () => ({ requestPublishAction: vi.fn(), requestUnpublishAction: vi.fn() }));

const { PublishPanel, POLL_MS } = await import('../publish/PublishPanel');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ENTRY = '00000000-0000-4000-8000-0000000000e1';
const REQUEST = '00000000-0000-4000-8000-0000000000d1';
const OLD_REQUEST = '00000000-0000-4000-8000-0000000000d0';

const row = (patch: Partial<PublicationStatusRow>): PublicationStatusRow => ({
  request_id: REQUEST,
  latest_request_id: patch.request_id ?? REQUEST,
  latest_action: 'publish',
  tenant_id: '00000000-0000-4000-8000-0000000000f1',
  entry_id: ENTRY,
  action: 'publish',
  status: 'pending',
  error: null,
  requested_at: '2026-11-02T12:00:00Z',
  release_number: null,
  release_status: null,
  omitted: false,
  missing_assets: null,
  site_count: 1,
  sites_notified: 0,
  sites_live_ok: 0,
  sites_not_confirmed: 0,
  retries_exhausted: false,
  live_retrying: false,
  ...patch,
});
const live = (patch: Partial<PublicationStatusRow> = {}) =>
  row({ status: 'committed', release_number: 3, release_status: 'delivered', sites_notified: 1, sites_live_ok: 1, ...patch });

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const stateText = () => container.querySelector('[data-testid="publish-state"]')?.textContent;
const button = (name: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === name);
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

type PanelProps = Parameters<typeof PublishPanel>[0];
async function renderPanel(props: Partial<PanelProps> & Pick<PanelProps, 'loadStatus'>) {
  const publish = vi.fn<NonNullable<PanelProps['publish']>>(async () => ({ requestId: REQUEST }));
  const unpublish = vi.fn<NonNullable<PanelProps['unpublish']>>(async () => ({ requestId: REQUEST }));
  // By default the published version the panel re-reads is the one the page was rendered with.
  const loadPublishedVersion = async () => props.publishedVersion ?? null;
  await act(async () =>
    root.render(
      <PublishPanel
        entryId={ENTRY}
        version={4}
        initiallyPublished={false}
        fieldLabels={{ title: 'Titill' }}
        publish={publish}
        unpublish={unpublish}
        loadPublishedVersion={loadPublishedVersion}
        {...props}
      />,
    ),
  );
  await advance(0);
  return { publish, unpublish };
}

describe('PublishPanel', () => {
  it('shows "Ekki birt" for an entry without a request and does not poll', async () => {
    const loadStatus = vi.fn(async () => null);
    await renderPanel({ loadStatus });
    expect(stateText()).toBe(t.publish.none);
    await advance(POLL_MS * 3);
    expect(loadStatus).toHaveBeenCalledTimes(1);
  });

  it('publishes the version the editor last saw, polls every 2 s while not final and stops when live', async () => {
    const answers = [null, row({}), row({ status: 'committed' }), live({ sites_live_ok: 0 }), live()];
    const loadStatus = vi.fn(async () => answers.shift() ?? live());
    const { publish } = await renderPanel({ loadStatus });

    await act(async () => button(t.publish.publish)!.click());
    await advance(0);
    expect(publish).toHaveBeenCalledWith(ENTRY, 4);
    expect(stateText()).toBe(t.publish.inProgress);
    expect(button(t.publish.publish)!.disabled).toBe(true);

    await advance(POLL_MS);
    expect(stateText()).toBe(t.publish.inProgress);
    await advance(POLL_MS);
    expect(stateText()).toBe(t.publish.revalidated);
    await advance(POLL_MS);
    expect(stateText()).toBe('Birt á vef ✓');
    const calls = loadStatus.mock.calls.length;
    await advance(POLL_MS * 5);
    expect(loadStatus).toHaveBeenCalledTimes(calls);
    // Published now: it can be taken down, and published again.
    expect(button(t.publish.unpublish)).toBeDefined();
    expect(button(t.publish.publish)!.disabled).toBe(false);
  });

  it('keeps showing "Í birtingu…" until the view shows the new request, not an older final one', async () => {
    const answers = [live({ request_id: OLD_REQUEST }), live({ request_id: OLD_REQUEST }), live()];
    const loadStatus = vi.fn(async () => answers.shift() ?? live());
    await renderPanel({ loadStatus, initiallyPublished: true });
    expect(stateText()).toBe('Birt á vef ✓');
    await act(async () => button(t.publish.publish)!.click());
    await advance(0);
    expect(stateText()).toBe(t.publish.inProgress);
    await advance(POLL_MS);
    expect(stateText()).toBe('Birt á vef ✓');
    expect(loadStatus).toHaveBeenCalledTimes(3);
  });

  it('unpublishes and shows "Tekið af vef" with a detail that does not claim removal from caches', async () => {
    const answers = [live(), row({ action: 'unpublish' }), live({ action: 'unpublish' })];
    const loadStatus = vi.fn(async () => answers.shift() ?? live({ action: 'unpublish' }));
    const { unpublish } = await renderPanel({ loadStatus, initiallyPublished: true });
    await act(async () => button(t.publish.unpublish)!.click());
    await advance(0);
    expect(unpublish).toHaveBeenCalledWith(ENTRY);
    await advance(POLL_MS);
    expect(stateText()).toBe('Tekið af vef');
    expect(container.querySelector('[data-testid="publish-detail"]')?.textContent).toBe(t.publish.removedDetail);
    expect(button(t.publish.unpublish)).toBeUndefined();
  });

  it('shows "Enginn vefur tengdur" and stops polling when the tenant has no active site (decision 39.3)', async () => {
    const noSite = live({ site_count: 0, sites_notified: 0, sites_live_ok: 0 });
    const answers = [null, row({ site_count: 0 }), noSite];
    const loadStatus = vi.fn(async () => answers.shift() ?? noSite);
    await renderPanel({ loadStatus });
    await act(async () => button(t.publish.publish)!.click());
    await advance(0);
    expect(stateText()).toBe(t.publish.inProgress);
    await advance(POLL_MS);
    expect(stateText()).toBe('Enginn vefur tengdur');
    const calls = loadStatus.mock.calls.length;
    await advance(POLL_MS * 5);
    expect(loadStatus).toHaveBeenCalledTimes(calls);
    expect(button(t.publish.publish)!.disabled).toBe(false);
  });

  it('names the failing fields by their labels', async () => {
    const loadStatus = vi.fn(async () => row({ status: 'failed_validation', error: { code: 'invalid_data', issues: [{ path: ['title'] }] } }));
    await renderPanel({ loadStatus });
    expect(stateText()).toBe('Ekki hægt að birta: Titill');
  });

  // M5-01: a panel opened before the withdrawal still offers it. The refusal changes nothing else.
  it('a repeat unpublish from a stale panel is a plain refusal, and the status stays as it was', async () => {
    const shown = live();
    const before = displayState(shown).label;
    const loadStatus = vi.fn(async () => shown);
    const unpublish = vi.fn(async () => ({ error: 'not_published' as const }));
    await renderPanel({ loadStatus, unpublish, initiallyPublished: true });
    expect(stateText()).toBe(before);

    await act(async () => button(t.publish.unpublish)!.click());
    await advance(0);

    expect(unpublish).toHaveBeenCalledWith(ENTRY);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(t.publish.notPublished);
    expect(stateText()).toBe(before);
  });

  // M5-01: the view skips a superseded repeat, so the panel that sent it never sees its row.
  it('a repeat that ended superseded shows the request the view shows, and does not wait for ever', async () => {
    const REPEAT = '99999999-9999-4999-8999-999999999999';
    const first = live({ action: 'unpublish', request_id: 'fyrsta', sites_live_ok: 0, sites_not_confirmed: 1 });
    const loadStatus = vi.fn(async () => (unpublish.mock.calls.length > 0 ? { ...first, latest_request_id: REPEAT, latest_action: 'unpublish' as const } : live()));
    const unpublish = vi.fn(async () => ({ requestId: REPEAT }));
    await renderPanel({ loadStatus, unpublish, initiallyPublished: true });

    await act(async () => button(t.publish.unpublish)!.click());
    await advance(0);

    expect(stateText()).toBe(displayState(first).label);
    const calls = loadStatus.mock.calls.length;
    await advance(POLL_MS * 2);
    expect(loadStatus.mock.calls.length).toBe(calls);
  });

  it('shows a refused request\'s notice and keeps polling a status it could not read', async () => {
    const loadStatus = vi.fn<() => Promise<PublicationStatusRow | null>>(async () => {
      throw new Error('network');
    });
    const { publish } = await renderPanel({ loadStatus });
    expect(container.querySelector('[role="note"]')?.textContent).toBe(t.publish.statusUnavailable);
    await advance(POLL_MS);
    expect(loadStatus).toHaveBeenCalledTimes(2);

    loadStatus.mockImplementation(async () => null);
    await advance(POLL_MS);
    publish.mockResolvedValueOnce({ error: 'version_conflict' });
    await act(async () => button(t.publish.publish)!.click());
    await advance(0);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(t.publish.superseded);
    publish.mockRejectedValueOnce(new Error('offline'));
    await act(async () => button(t.publish.publish)!.click());
    await advance(0);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(t.publish.requestFailed);
  });

  // A10 (probe §14, 10): before the first status read answers, a published entry must not read "Ekki birt".
  it('says it is reading the status, not "Ekki birt", until the first read answers', async () => {
    let answer: (row: PublicationStatusRow | null) => void = () => {};
    const loadStatus = vi.fn(() => new Promise<PublicationStatusRow | null>((resolve) => (answer = resolve)));
    await renderPanel({ loadStatus, initiallyPublished: true, publishedVersion: 4 });
    expect(stateText()).toBe(t.publish.loading);
    expect(stateText()).not.toBe(t.publish.none);
    await act(async () => answer(live()));
    expect(stateText()).toBe('Birt á vef ✓');
  });

  // A10 (probe §14, 11): live, but the draft has moved on since.
  it('does not show "Birt á vef ✓" while the draft has changes that are not published', async () => {
    const loadStatus = vi.fn(async () => live());
    await renderPanel({ loadStatus, initiallyPublished: true, publishedVersion: 3, version: 5 });
    expect(stateText()).toBe(t.publish.changed);
    expect(stateText()).not.toContain('✓');
    expect(container.querySelector('[data-testid="publish-state"]')?.getAttribute('data-tone')).toBe('warning');
    expect(container.querySelector('[data-testid="publish-detail"]')?.textContent).toBe(t.publish.changedDetail);
  });

  it('turns to "Óbirtar breytingar" when an edit is saved after publishing, and back to live once that is published', async () => {
    let shown = live();
    const loadStatus = vi.fn(async () => shown);
    const { publish } = await renderPanel({ loadStatus, initiallyPublished: true, publishedVersion: 4, version: 4 });
    expect(stateText()).toBe('Birt á vef ✓');
    // The autosave saved an edit: version 5.
    await act(async () => root.render(<PublishPanel entryId={ENTRY} version={5} initiallyPublished publishedVersion={4} fieldLabels={{}} publish={publish} loadStatus={loadStatus} />));
    expect(stateText()).toBe(t.publish.changed);
    // Publishing version 5 makes it the published one once its request is live.
    shown = live({ request_id: REQUEST });
    publish.mockResolvedValueOnce({ requestId: REQUEST });
    await act(async () => button(t.publish.publish)!.click());
    await advance(0);
    expect(publish).toHaveBeenLastCalledWith(ENTRY, 5);
    expect(stateText()).toBe('Birt á vef ✓');
  });

  // A publish this panel did not send (the page was opened while it was on its way) settles: the
  // published version is read again, never taken from the page as it was rendered (§7.4).
  it('a first publish that settles after the page opened mid-flight shows "Óbirtar breytingar" over later edits', async () => {
    const answers = [row({}), live()];
    const loadStatus = vi.fn(async () => answers.shift() ?? live());
    // The publish carried version 4; the editor has saved version 5 since.
    const loadPublishedVersion = vi.fn(async () => 4);
    await renderPanel({ loadStatus, initiallyPublished: false, publishedVersion: null, version: 5, loadPublishedVersion });
    expect(stateText()).toBe(t.publish.inProgress);
    await advance(POLL_MS);
    expect(loadPublishedVersion).toHaveBeenCalledWith(ENTRY);
    expect(stateText()).toBe(t.publish.changed);
    expect(stateText()).not.toContain('✓');
  });

  it('a re-publish that settles after the page opened mid-flight shows "Birt á vef ✓" once everything is published', async () => {
    const answers = [row({}), live()];
    const loadStatus = vi.fn(async () => answers.shift() ?? live());
    // Rendered while version 3 was the published one; the request on its way carried version 5.
    await renderPanel({ loadStatus, initiallyPublished: true, publishedVersion: 3, version: 5, loadPublishedVersion: async () => 5 });
    expect(stateText()).toBe(t.publish.inProgress);
    await advance(POLL_MS);
    expect(stateText()).toBe('Birt á vef ✓');
  });

  it('claims nothing while the published version cannot be read, and reads it again', async () => {
    const loadStatus = vi.fn(async () => live());
    const loadPublishedVersion = vi.fn<(id: string) => Promise<number | null>>(async () => {
      throw new Error('network');
    });
    await renderPanel({ loadStatus, initiallyPublished: true, publishedVersion: null, version: 5, loadPublishedVersion });
    expect(stateText()).toBe(t.publish.loading);
    expect(container.querySelector('[role="note"]')?.textContent).toBe(t.publish.statusUnavailable);
    loadPublishedVersion.mockImplementation(async () => 4);
    await advance(POLL_MS);
    expect(stateText()).toBe(t.publish.changed);
    expect(container.querySelector('[role="note"]')).toBeNull();
    const calls = loadStatus.mock.calls.length;
    await advance(POLL_MS * 3);
    expect(loadStatus).toHaveBeenCalledTimes(calls);
  });

  // A10: a publish refused for an unpublished reference names it by its title.
  it('names a refused reference by the title of the entry it points to', async () => {
    const TARGET = '00000000-0000-4000-8000-0000000000a9';
    const refused = row({
      status: 'failed_validation',
      error: { code: 'invalid_reference', refs: [{ path: '$."related"[1]', kind: 'entry', id: TARGET, reason: 'unpublished' }] },
    });
    const loadTitles = vi.fn(async () => ({ [TARGET]: 'Vorhátíð' }));
    await renderPanel({ loadStatus: async () => refused, loadTitles, fieldLabels: { related: 'Tengd verk' } });
    expect(stateText()).toBe('Ekki hægt að birta: Tengd verk');
    expect(loadTitles).toHaveBeenCalledExactlyOnceWith([TARGET]);
    expect(container.querySelector('[data-testid="publish-lines"]')?.textContent).toBe(`Tengd verk 2: „Vorhátíð“ ${t.publish.reference.unpublished}`);
    expect(container.querySelector('[data-testid="publish-detail"]')?.textContent).toBe(t.publish.reference.detail);
  });

  // A6: the archive control is offered only for an entry that is not published, with nothing on its way.
  it('tells the form when the entry can be archived', async () => {
    const onArchivableChange = vi.fn();
    const answers: (PublicationStatusRow | null)[] = [null, row({}), live()];
    const loadStatus = vi.fn(async () => (answers.length > 0 ? answers.shift()! : live()));
    await renderPanel({ loadStatus, onArchivableChange });
    expect(onArchivableChange).toHaveBeenLastCalledWith(true);
    await act(async () => button(t.publish.publish)!.click());
    expect(onArchivableChange).toHaveBeenLastCalledWith(false);
    await advance(POLL_MS);
    expect(stateText()).toBe('Birt á vef ✓');
    expect(onArchivableChange).toHaveBeenLastCalledWith(false);
  });

  it('cannot publish while the form is in conflict or signed out', async () => {
    await renderPanel({ loadStatus: async () => null, disabled: true });
    expect(button(t.publish.publish)!.disabled).toBe(true);
  });
});
