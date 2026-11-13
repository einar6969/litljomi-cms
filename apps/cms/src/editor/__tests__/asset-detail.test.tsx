// @vitest-environment jsdom
import { act, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n/is';

const actions = vi.hoisted(() => ({ assetPreviewAction: vi.fn(), updateAssetAction: vi.fn(), updateAssetTextAction: vi.fn() }));
vi.mock('@/app/(editor)/t/[tenant]/asset-actions', () => actions);
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const { AssetDetail } = await import('../media/AssetDetail');
type DetailProps = Parameters<typeof AssetDetail>[0];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ASSET = '00000000-0000-4000-8000-0000000000a1';
const ENTRY = '00000000-0000-4000-8000-0000000000e1';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.clearAllMocks();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const render = async (element: ReactElement) => act(async () => root.render(element));
const $ = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector);
const button = (name: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === name)!;
const link = (name: string) => [...container.querySelectorAll('a')].find((a) => a.textContent?.includes(name) || a.getAttribute('aria-label') === name);

async function type(input: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  await act(async () => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const FILE: DetailProps['file'] = {
  id: ASSET,
  filename: 'rugbraud.jpg',
  mime: 'image/jpeg',
  width: 2048,
  height: 716,
  bytes: 61_952,
  createdAt: '2026-10-04T12:00:00Z',
  uploaded: '4. okt. 2026',
  focal: null,
  defaultAlt: 'Brauð',
  caption: null,
  credit: 'Þóra',
};

const detail = (o: Partial<DetailProps> = {}) => (
  <AssetDetail file={FILE} url="http://127.0.0.1:54321/thumb" usage={[]} originalHref={`/t/demo/assets/${ASSET}/original`} {...o} />
);

describe('AssetDetail', () => {
  it("shows the file's name, type, size, dimensions and upload date, and links its original in a new tab", async () => {
    await render(detail());
    expect($('[data-testid="asset-filename"]')?.textContent).toBe('rugbraud.jpg');
    expect($('[data-testid="asset-type"]')?.textContent).toBe('JPEG');
    expect($('[data-testid="asset-size"]')?.textContent).toBe('60,5 KB');
    expect($('[data-testid="asset-dimensions"]')?.textContent).toBe('2048 × 716 px');
    expect($('[data-testid="asset-uploaded"]')?.textContent).toBe('4. okt. 2026');
    const original = link(t.library.detail.original)!;
    expect(original.getAttribute('href')).toBe(`/t/demo/assets/${ASSET}/original`);
    expect(original.getAttribute('target')).toBe('_blank');
  });

  it('shows alt text, caption and credit with their help, and one save button that waits for a change', async () => {
    await render(detail());
    const alt = $<HTMLInputElement>('#asset-alt')!;
    const caption = $<HTMLTextAreaElement>('#asset-caption')!;
    const credit = $<HTMLInputElement>('#asset-credit')!;
    expect([alt.value, caption.value, credit.value]).toEqual(['Brauð', '', 'Þóra']);
    expect([alt.maxLength, caption.maxLength, credit.maxLength]).toEqual([1000, 1000, 300]);
    const help = (el: Element) => document.getElementById(el.getAttribute('aria-describedby')!)?.textContent;
    expect([help(alt), help(caption), help(credit)]).toEqual([t.library.detail.altHelp, t.library.detail.captionHelp, t.library.detail.creditHelp]);
    expect(button(t.library.detail.save).disabled).toBe(true);
    await type(caption, 'Nýbakað');
    expect(button(t.library.detail.save).disabled).toBe(false);
    await type(caption, '');
    expect(button(t.library.detail.save).disabled).toBe(true);
  });

  it('saves the three texts together, trimmed, and says so politely', async () => {
    actions.updateAssetTextAction.mockResolvedValue({ ok: true });
    await render(detail());
    await type($<HTMLInputElement>('#asset-alt')!, '  Rúgbrauð á borði ');
    await type($<HTMLTextAreaElement>('#asset-caption')!, 'Nýbakað');
    await type($<HTMLInputElement>('#asset-credit')!, '');
    await act(async () => button(t.library.detail.save).click());
    expect(actions.updateAssetTextAction).toHaveBeenCalledWith(ASSET, { defaultAlt: 'Rúgbrauð á borði', caption: 'Nýbakað', credit: null });
    expect($('[data-testid="asset-notice"]')?.textContent).toBe(t.library.detail.saved);
    expect($('[data-testid="asset-notice"]')?.getAttribute('aria-live')).toBe('polite');
    expect($<HTMLInputElement>('#asset-alt')!.value).toBe('Rúgbrauð á borði');
    expect(button(t.library.detail.save).disabled).toBe(true);
  });

  it('keeps the typed text when a save fails, and says why as an alert', async () => {
    actions.updateAssetTextAction.mockResolvedValue({ ok: false, code: 'error' });
    await render(detail());
    await type($<HTMLTextAreaElement>('#asset-caption')!, 'Nýbakað');
    await act(async () => button(t.library.detail.save).click());
    expect($('[data-testid="asset-notice"]')?.textContent).toBe(t.editor.image.updateError);
    expect($('[data-testid="asset-notice"]')?.getAttribute('role')).toBe('alert');
    expect($<HTMLTextAreaElement>('#asset-caption')!.value).toBe('Nýbakað');
    expect(button(t.library.detail.save).disabled).toBe(false);

    actions.updateAssetTextAction.mockResolvedValue({ ok: false, code: 'auth' });
    await act(async () => button(t.library.detail.save).click());
    expect($('[data-testid="asset-notice"]')?.textContent).toContain(t.editor.signedOut);

    actions.updateAssetTextAction.mockRejectedValue(new Error('network'));
    await act(async () => button(t.library.detail.save).click());
    expect($('[data-testid="asset-notice"]')?.textContent).toBe(t.editor.image.updateError);
  });

  it('saves the focal point alone, and shows a refusal as an alert', async () => {
    actions.updateAssetAction.mockResolvedValue({ ok: true });
    await render(detail());
    const picker = $<HTMLButtonElement>('#asset-focal')!;
    picker.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect;
    await act(async () => picker.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: 10, clientY: 90 })));
    expect(actions.updateAssetAction).toHaveBeenLastCalledWith(ASSET, { focal: { x: 0.1, y: 0.9 } });
    expect($('[data-testid="asset-focal-value"]')?.textContent).toContain('10 % frá vinstri, 90 % ofan frá');
    expect($('[data-testid="asset-notice"]')?.textContent).toBe(t.editor.image.focalSaved);

    actions.updateAssetAction.mockResolvedValue({ ok: false, code: 'error' });
    await act(async () => picker.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: 50, clientY: 50 })));
    expect($('[data-testid="asset-notice"]')?.textContent).toBe(t.editor.image.updateError);
    expect($('[data-testid="asset-notice"]')?.getAttribute('role')).toBe('alert');
    expect($('[data-testid="asset-focal-value"]')?.textContent).toContain('10 % frá vinstri, 90 % ofan frá');
  });

  it('lists where the file is used, each entry a link with its type and state, and the publish note only for a file on the site', async () => {
    const draftOnly = [{ entryId: ENTRY, href: `/t/demo/news/${ENTRY}`, title: 'Frétt', typeLabel: 'Fréttir', live: false, state: { label: t.library.usage.draft, tone: 'neutral' as const } }];
    await render(detail({ usage: draftOnly }));
    const usage = $('[data-testid="asset-usage"]')!;
    expect(usage.querySelector('h3')?.textContent).toBe(`${t.library.usage.title} 1`);
    const entry = usage.querySelector('a')!;
    expect(entry.getAttribute('href')).toBe(`/t/demo/news/${ENTRY}`);
    expect(entry.textContent).toBe('Frétt');
    expect(usage.textContent).toContain('Fréttir');
    expect(usage.textContent).toContain(t.library.usage.draft);
    expect(container.textContent).not.toContain(t.library.detail.nextPublish);

    await render(detail({ usage: [{ ...draftOnly[0]!, title: null, live: true, state: { label: t.library.usage.live, tone: 'ok' as const } }] }));
    expect($('[data-testid="asset-usage"] a')?.textContent).toBe(t.entries.untitled);
    expect($('[data-testid="asset-usage"]')?.textContent).toContain(t.library.usage.live);
    expect(container.textContent).toContain(t.library.detail.nextPublish);

    // Published but not yet proven live: the panel shows the state it is given, and the note stays.
    await render(detail({ usage: [{ ...draftOnly[0]!, live: true, state: { label: t.publish.revalidated, tone: 'pending' as const } }] }));
    expect($('[data-testid="asset-usage"]')?.textContent).toContain(t.publish.revalidated);
    expect($('[data-testid="asset-usage"]')?.textContent).not.toContain(t.library.usage.live);
    expect(container.textContent).toContain(t.library.detail.nextPublish);
  });

  it('says when the file is used nowhere', async () => {
    await render(detail());
    expect($('[data-testid="asset-usage"]')?.textContent).toContain(t.library.usage.none);
  });

  it('in the library, takes focus on its heading and closes with its link, Escape included, but not from a text field', async () => {
    await render(detail({ closeHref: '/t/demo/assets' }));
    const heading = $('#asset-panel-title')!;
    expect(document.activeElement).toBe(heading);
    expect(heading.textContent).toBe(t.library.detail.title);
    const close = link(t.library.detail.close)!;
    expect(close.getAttribute('href')).toBe('/t/demo/assets');
    expect(link(t.library.detail.back)?.getAttribute('href')).toBe('/t/demo/assets');
    const clicks = vi.fn((e: Event) => e.preventDefault());
    close.addEventListener('click', clicks);
    await act(async () => $<HTMLInputElement>('#asset-alt')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(clicks).not.toHaveBeenCalled();
    await act(async () => heading.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(clicks).toHaveBeenCalledTimes(1);
  });

  it('on its own page, takes no focus and has no close link', async () => {
    await render(detail());
    expect(document.activeElement).toBe(document.body);
    expect(link(t.library.detail.close)).toBeUndefined();
  });

  it('asks for the preview of a file the page had no thumbnail for, and signs it again when it fails to load', async () => {
    actions.assetPreviewAction.mockResolvedValue({ ok: true, url: 'http://127.0.0.1:54321/y', thumbnail: true, defaultAlt: null, focalX: null, focalY: null });
    await render(detail({ url: null }));
    expect(actions.assetPreviewAction).toHaveBeenCalledWith(ASSET);
    expect($<HTMLImageElement>('[data-testid="asset-preview"]')!.src).toBe('http://127.0.0.1:54321/y');
    for (let i = 2; i <= 4; i++) {
      await act(async () => $('[data-testid="asset-preview"]')!.dispatchEvent(new Event('error')));
      expect(actions.assetPreviewAction).toHaveBeenCalledTimes(i);
    }
    expect($('[data-testid="asset-notice"]')).toBeNull();
    await act(async () => $('[data-testid="asset-preview"]')!.dispatchEvent(new Event('error')));
    expect($('[data-testid="asset-notice"]')?.textContent).toBe(t.editor.image.previewError);
  });
});
