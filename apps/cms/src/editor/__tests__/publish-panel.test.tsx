// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n/is';
import type { PublicationStatusRow } from '../publish/status';

vi.mock('@/lib/supabase/browser', () => ({ createBrowserEditorClient: () => ({}) }));
vi.mock('@/app/(editor)/t/[tenant]/publish-actions', () => ({ requestPublishAction: vi.fn(), requestUnpublishAction: vi.fn() }));

const { PublishPanel, POLL_MS } = await import('../publish/PublishPanel');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ENTRY = '00000000-0000-4000-8000-0000000000e1';
const REQUEST = '00000000-0000-4000-8000-0000000000d1';
const OLD_REQUEST = '00000000-0000-4000-8000-0000000000d0';

const row = (patch: Partial<PublicationStatusRow>): PublicationStatusRow => ({
  request_id: REQUEST,
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
  notify_attempts: 0,
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
  await act(async () =>
    root.render(<PublishPanel entryId={ENTRY} version={4} initiallyPublished={false} fieldLabels={{ title: 'Titill' }} publish={publish} unpublish={unpublish} {...props} />),
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

  it('cannot publish while the form is in conflict or signed out', async () => {
    await renderPanel({ loadStatus: async () => null, disabled: true });
    expect(button(t.publish.publish)!.disabled).toBe(true);
  });
});
