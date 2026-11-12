// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n/is';

const actions = vi.hoisted(() => ({ assetPreviewAction: vi.fn(), updateAssetAction: vi.fn(), registerAssetAction: vi.fn() }));
vi.mock('@/app/(editor)/t/[tenant]/asset-actions', () => actions);

const { FocalPointPicker, KEYBOARD_SAVE_DELAY_MS } = await import('../media/FocalPointPicker');
const { AssetDetail } = await import('../media/AssetDetail');
const { moveFocal, fraction } = await import('../media/focal-point');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ASSET = '00000000-0000-4000-8000-0000000000a1';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.clearAllMocks();
});
afterEach(async () => {
  vi.useRealTimers();
  await act(async () => root.unmount());
  container.remove();
});

const render = async (element: ReactElement) => act(async () => root.render(element));
const $ = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector);
const press = (el: Element, key: string, shiftKey = false) =>
  act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
  });

describe('moveFocal and fraction', () => {
  it('moves by 5 %, or 1 % with Shift, from the centre when there is no point, clamped to the image', () => {
    expect(moveFocal(null, 'ArrowRight', false)).toEqual({ x: 0.55, y: 0.5 });
    expect(moveFocal({ x: 0.2, y: 0.2 }, 'ArrowUp', true)).toEqual({ x: 0.2, y: 0.19 });
    expect(moveFocal({ x: 0.02, y: 0.98 }, 'ArrowLeft', false)).toEqual({ x: 0, y: 0.98 });
    expect(moveFocal({ x: 0.02, y: 0.98 }, 'ArrowDown', false)).toEqual({ x: 0.02, y: 1 });
    expect(moveFocal({ x: 0.5, y: 0.5 }, 'Enter', false)).toBeNull();
    expect(moveFocal({ x: 0.5, y: 0.5 }, 'a', false)).toBeNull();
  });
  it('stays on whole hundredths over many steps', () => {
    let p = { x: 0, y: 0 };
    for (let i = 0; i < 7; i++) p = moveFocal(p, 'ArrowRight', true)!;
    expect(p.x).toBe(0.07);
    expect(fraction(-5, 100)).toBe(0);
    expect(fraction(150, 100)).toBe(1);
    expect(fraction(1, 3)).toBe(0.33);
  });
});

describe('FocalPointPicker', () => {
  const setup = (focal: { x: number; y: number } | null = null) => {
    const onSave = vi.fn();
    return { onSave, rendered: render(<FocalPointPicker id="f" url="http://127.0.0.1:54321/x" alt="Brauð" focal={focal} onSave={onSave} onImageError={vi.fn()} />) };
  };

  it('is a named button in the tab order, described by where the point is, in words', async () => {
    const { rendered } = setup({ x: 0.2, y: 0.75 });
    await rendered;
    const picker = $<HTMLButtonElement>('#f-focal')!;
    expect(picker.tagName).toBe('BUTTON');
    expect(picker.tabIndex).toBe(0);
    expect(picker.getAttribute('aria-label')).toBe(t.editor.image.focalLabel);
    const help = document.getElementById(picker.getAttribute('aria-describedby')!)!;
    expect(help.textContent).toContain('20 % frá vinstri, 75 % ofan frá');
    expect(help.textContent).toContain(t.editor.image.focalHelp);
    // No class turns the global :focus-visible ring off (globals.css; Task 31 r3 Minor). The e2e
    // spec checks the ring is drawn.
    expect(picker.className).not.toMatch(/outline-none|outline-0|focus(-visible)?:outline-none/);
  });

  it('says there is no focal point, and offers no removal, when there is none', async () => {
    const { rendered } = setup(null);
    await rendered;
    expect($('[data-testid="f-focal-value"]')?.textContent).toBe(t.editor.image.focalNone);
    expect($('[data-testid="f-focal-marker"]')).toBeNull();
    expect([...container.querySelectorAll('button')].some((b) => b.textContent === t.editor.image.clearFocal)).toBe(false);
  });

  it('moves the point with the arrow keys at once, and saves once after the keys rest', async () => {
    vi.useFakeTimers();
    const { onSave, rendered } = setup(null);
    await rendered;
    const picker = $<HTMLButtonElement>('#f-focal')!;
    await press(picker, 'ArrowRight');
    await press(picker, 'ArrowRight');
    await press(picker, 'ArrowDown', true);
    expect($('[data-testid="f-focal-marker"]')?.getAttribute('style')).toBe('left: 60%; top: 51%;');
    expect($('[data-testid="f-focal-value"]')?.textContent).toContain('60 % frá vinstri, 51 % ofan frá');
    expect(onSave).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(KEYBOARD_SAVE_DELAY_MS));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ x: 0.6, y: 0.51 });
  });

  it('saves a pending keyboard move at once when focus leaves the picker', async () => {
    vi.useFakeTimers();
    const { onSave, rendered } = setup({ x: 0.5, y: 0.5 });
    await rendered;
    const picker = $<HTMLButtonElement>('#f-focal')!;
    await press(picker, 'ArrowLeft');
    await act(async () => picker.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(onSave).toHaveBeenCalledWith({ x: 0.45, y: 0.5 });
    await act(async () => vi.advanceTimersByTime(KEYBOARD_SAVE_DELAY_MS * 2));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('ignores the click that Enter or Space makes (no pointer position), and other keys', async () => {
    const { onSave, rendered } = setup({ x: 0.5, y: 0.5 });
    await rendered;
    const picker = $<HTMLButtonElement>('#f-focal')!;
    await act(async () => picker.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })));
    await press(picker, 'Tab');
    await press(picker, 'Enter');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves the clicked point, and removes the point with its own button', async () => {
    const { onSave, rendered } = setup({ x: 0.5, y: 0.5 });
    await rendered;
    const picker = $<HTMLButtonElement>('#f-focal')!;
    picker.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 200 }) as DOMRect;
    await act(async () => picker.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: 100, clientY: 150 })));
    expect(onSave).toHaveBeenLastCalledWith({ x: 0.25, y: 0.75 });
    const clear = [...container.querySelectorAll('button')].find((b) => b.textContent === t.editor.image.clearFocal)!;
    await act(async () => clear.click());
    expect(onSave).toHaveBeenLastCalledWith(null);
  });
});

describe('AssetDetail', () => {
  const detail = (o: { focal?: { x: number; y: number } | null; defaultAlt?: string | null; url?: string | null } = {}) => (
    <AssetDetail
      assetId={ASSET}
      url={o.url === undefined ? 'http://127.0.0.1:54321/x' : o.url}
      filename="Rúgbrauð.jpg"
      width={64}
      height={48}
      focal={o.focal ?? null}
      defaultAlt={o.defaultAlt ?? null}
    />
  );
  const saveButton = () => [...container.querySelectorAll('button')].find((b) => b.textContent === t.asset.saveDefaultAlt)!;
  async function type(input: HTMLInputElement, text: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  it('shows the file name and size, and the default alt text with its help', async () => {
    await render(detail({ defaultAlt: 'Brauð' }));
    expect($('[data-testid="asset-filename"]')?.textContent).toBe('Rúgbrauð.jpg');
    expect($('[data-testid="asset-size"]')?.textContent).toBe('64 × 48 px');
    const input = $<HTMLInputElement>('#asset-default-alt')!;
    expect(input.value).toBe('Brauð');
    expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe(t.asset.defaultAltHelp);
    expect(saveButton().disabled).toBe(true);
  });

  it('saves the default alt text alone, trimmed, and an emptied one as null', async () => {
    actions.updateAssetAction.mockResolvedValue({ ok: true });
    await render(detail({ focal: { x: 0.2, y: 0.3 }, defaultAlt: 'Brauð' }));
    await type($<HTMLInputElement>('#asset-default-alt')!, '  Rúgbrauð á borði ');
    await act(async () => saveButton().click());
    expect(actions.updateAssetAction).toHaveBeenLastCalledWith(ASSET, { defaultAlt: 'Rúgbrauð á borði' });
    expect($('[data-testid="asset-notice"]')?.textContent).toBe(t.editor.image.defaultAltSaved);
    expect($('[data-testid="asset-notice"]')?.getAttribute('aria-live')).toBe('polite');
    expect(saveButton().disabled).toBe(true);
    await type($<HTMLInputElement>('#asset-default-alt')!, '');
    await act(async () => saveButton().click());
    expect(actions.updateAssetAction).toHaveBeenLastCalledWith(ASSET, { defaultAlt: null });
  });

  it('saves the focal point alone, and shows a refusal as an alert', async () => {
    actions.updateAssetAction.mockResolvedValue({ ok: true });
    await render(detail({ defaultAlt: 'Brauð' }));
    const picker = $<HTMLButtonElement>('#asset-focal')!;
    picker.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect;
    await act(async () => picker.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: 10, clientY: 90 })));
    expect(actions.updateAssetAction).toHaveBeenLastCalledWith(ASSET, { focal: { x: 0.1, y: 0.9 } });
    expect($('[data-testid="asset-focal-value"]')?.textContent).toContain('10 % frá vinstri, 90 % ofan frá');

    actions.updateAssetAction.mockResolvedValue({ ok: false, code: 'error' });
    await act(async () => picker.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: 50, clientY: 50 })));
    expect($('[data-testid="asset-notice"]')?.textContent).toBe(t.editor.image.updateError);
    expect($('[data-testid="asset-notice"]')?.getAttribute('role')).toBe('alert');
    // The refused point is not shown as saved.
    expect($('[data-testid="asset-focal-value"]')?.textContent).toContain('10 % frá vinstri, 90 % ofan frá');

    actions.updateAssetAction.mockResolvedValue({ ok: false, code: 'auth' });
    await act(async () => picker.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: 50, clientY: 50 })));
    expect($('[data-testid="asset-notice"]')?.textContent).toBe(t.editor.signedOut);
  });

  it('asks for the preview of a file the page had no thumbnail for, and shows no image until it comes', async () => {
    let answer: (value: unknown) => void = () => {};
    actions.assetPreviewAction.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    await render(detail({ url: null }));
    expect(actions.assetPreviewAction).toHaveBeenCalledWith(ASSET);
    expect($('[data-testid="asset-preview"]')).toBeNull();
    await act(async () => answer({ ok: true, url: 'http://127.0.0.1:54321/thumb', thumbnail: true, defaultAlt: null, focalX: null, focalY: null }));
    expect($<HTMLImageElement>('[data-testid="asset-preview"]')!.src).toBe('http://127.0.0.1:54321/thumb');
    expect($('[data-testid="asset-notice"]')).toBeNull();
  });

  it('says so when that preview cannot be had', async () => {
    actions.assetPreviewAction.mockResolvedValue({ ok: false, code: 'error' });
    await render(detail({ url: null }));
    expect($('[data-testid="asset-preview"]')).toBeNull();
    expect($('[data-testid="asset-notice"]')?.textContent).toBe(t.editor.image.previewError);
    actions.assetPreviewAction.mockResolvedValue({ ok: false, code: 'auth' });
    await act(async () => root.unmount());
    root = createRoot(container);
    await render(detail({ url: null }));
    expect($('[data-testid="asset-notice"]')?.textContent).toBe(t.editor.signedOut);
  });

  it(`signs the preview again when it fails to load, at most 3 times, then says so`, async () => {
    actions.assetPreviewAction.mockResolvedValue({ ok: true, url: 'http://127.0.0.1:54321/y', defaultAlt: null, focalX: null, focalY: null });
    await render(detail());
    for (let i = 1; i <= 3; i++) {
      await act(async () => $('[data-testid="asset-preview"]')!.dispatchEvent(new Event('error')));
      expect(actions.assetPreviewAction).toHaveBeenCalledTimes(i);
    }
    expect($<HTMLImageElement>('[data-testid="asset-preview"]')!.src).toBe('http://127.0.0.1:54321/y');
    expect($('[data-testid="asset-notice"]')).toBeNull();
    await act(async () => $('[data-testid="asset-preview"]')!.dispatchEvent(new Event('error')));
    expect($('[data-testid="asset-notice"]')?.textContent).toBe(t.editor.image.previewError);
  });
});
