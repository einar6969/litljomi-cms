// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n/is';

const mocks = vi.hoisted(() => ({
  registerAssetAction: vi.fn(),
  uploadWithProgress: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@/app/(editor)/t/[tenant]/asset-actions', () => ({ registerAssetAction: mocks.registerAssetAction }));
vi.mock('@/lib/supabase/browser', () => ({ createBrowserEditorClient: () => ({}) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock('../upload', async (importOriginal) => ({ ...(await importOriginal<typeof import('../upload')>()), uploadWithProgress: mocks.uploadWithProgress }));

const { LibraryUpload, UploadTrigger, UPLOAD_INPUT_ID } = await import('../media/LibraryUpload');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TENANT = '00000000-0000-4000-8000-0000000000f1';

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
const button = (name: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === name);
const upload = <LibraryUpload tenantId={TENANT} tenantSlug="acme" newestHref="/t/acme/assets" showButton />;

/** Chooses the files in the hidden input, as the file chooser would. */
async function choose(files: File[]) {
  const input = $<HTMLInputElement>(`#${UPLOAD_INPUT_ID}`)!;
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}

describe('LibraryUpload', () => {
  it('opens a file chooser for several images from "Hlaða upp"', async () => {
    await render(upload);
    const input = $<HTMLInputElement>(`#${UPLOAD_INPUT_ID}`)!;
    expect(input.multiple).toBe(true);
    expect(input.accept).toBe('image/jpeg,image/png,image/webp');
    const clicked = vi.fn();
    input.addEventListener('click', clicked);
    await act(async () => button(t.library.upload)!.click());
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('shows a row per file with its state, names a refused file in an alert, and reloads newest first when files arrived', async () => {
    let answer: (value: string) => void = () => {};
    mocks.uploadWithProgress.mockImplementation((_c: unknown, _p: string, _f: File, progress: (f: number) => void) => {
      progress(0.25);
      return new Promise((resolve) => (answer = resolve));
    });
    mocks.registerAssetAction.mockResolvedValue({ ok: true, assetId: 'x' });
    await render(upload);
    await choose([new File([new Uint8Array(4)], 'Rúgbrauð.jpg', { type: 'image/jpeg' }), new File([new Uint8Array(4)], 'skjal.pdf', { type: 'application/pdf' })]);

    const rows = () => [...container.querySelectorAll('[data-testid="upload-queue"] li')].map((li) => li.textContent);
    expect(rows()[0]).toContain('Rúgbrauð.jpg');
    expect(rows()[0]).toContain(t.upload.uploading.replace('{p}', '25'));
    expect(rows()[1]).toContain(t.editor.image.type);
    expect($('[data-testid="upload-queue"] [role="alert"]')?.textContent).toBe(t.editor.image.type);
    expect($('[data-testid="upload-summary"]')?.getAttribute('aria-live')).toBe('polite');
    expect($('[data-testid="upload-summary"]')?.textContent).toBe(t.upload.progress.replace('{done}', '0').replace('{total}', '2'));
    expect(mocks.uploadWithProgress.mock.calls[0]![1]).toMatch(new RegExp(`^${TENANT}/[0-9a-f-]{36}/rugbraud\\.jpg$`));

    await act(async () => answer('ok'));
    expect(mocks.registerAssetAction).toHaveBeenCalledWith('acme', expect.any(String), mocks.uploadWithProgress.mock.calls[0]![1], 'rugbraud.jpg');
    expect($('[data-testid="upload-summary"]')?.textContent).toBe('1 skrá er komin í safnið. Ekki tókst að hlaða upp 1 skrá.');
    expect(mocks.push).toHaveBeenCalledWith('/t/acme/assets');
    expect(rows()).toHaveLength(1);
    // A file refused for its type gets no retry, only its removal.
    expect(button(t.editor.retry)).toBeUndefined();
    await act(async () => container.querySelector<HTMLButtonElement>(`[aria-label="${t.upload.remove}: skjal.pdf"]`)!.click());
    expect(rows()).toHaveLength(0);
  });

  it('stops on a lost session with the signed-out notice, and goes on from "Reyna aftur"', async () => {
    mocks.uploadWithProgress.mockResolvedValueOnce('auth').mockResolvedValue('ok');
    mocks.registerAssetAction.mockResolvedValue({ ok: true, assetId: 'x' });
    await render(upload);
    await choose([new File([new Uint8Array(4)], 'a.jpg', { type: 'image/jpeg' })]);
    expect($('[role="alert"]')?.textContent).toContain(t.editor.signedOut);
    expect(container.textContent).toContain(t.upload.waiting);
    await act(async () => button(t.editor.retry)!.click());
    expect(mocks.uploadWithProgress).toHaveBeenCalledTimes(2);
    expect($('[data-testid="upload-summary"]')?.textContent).toBe('1 skrá er komin í safnið.');
  });

  it('offers "Reyna aftur" for a file that failed on its way, with a new path', async () => {
    mocks.uploadWithProgress.mockResolvedValueOnce('error').mockResolvedValue('ok');
    mocks.registerAssetAction.mockResolvedValue({ ok: true, assetId: 'x' });
    await render(upload);
    await choose([new File([new Uint8Array(4)], 'a.jpg', { type: 'image/jpeg' })]);
    expect(container.textContent).toContain(t.upload.failed);
    expect(mocks.push).not.toHaveBeenCalled();
    await act(async () => button(t.editor.retry)!.click());
    expect(mocks.uploadWithProgress.mock.calls[1]![1]).not.toBe(mocks.uploadWithProgress.mock.calls[0]![1]);
    expect(mocks.push).toHaveBeenCalledTimes(1);
  });

  it('takes files dropped anywhere on the page', async () => {
    mocks.uploadWithProgress.mockResolvedValue('ok');
    mocks.registerAssetAction.mockResolvedValue({ ok: true, assetId: 'x' });
    await render(upload);
    const drop = new Event('drop', { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown };
    drop.dataTransfer = { types: ['Files'], files: [new File([new Uint8Array(4)], 'a.jpg', { type: 'image/jpeg' })] };
    await act(async () => window.dispatchEvent(drop));
    expect(drop.defaultPrevented).toBe(true);
    expect(mocks.uploadWithProgress).toHaveBeenCalledTimes(1);
  });

  it('leaves the button to the empty library, whose own button opens the same chooser', async () => {
    await render(
      <>
        <LibraryUpload tenantId={TENANT} tenantSlug="acme" newestHref="/t/acme/assets" showButton={false} />
        <UploadTrigger />
      </>,
    );
    expect([...container.querySelectorAll('button')].filter((b) => b.textContent === t.library.upload)).toHaveLength(1);
    const clicked = vi.fn();
    $(`#${UPLOAD_INPUT_ID}`)!.addEventListener('click', clicked);
    await act(async () => button(t.library.upload)!.click());
    expect(clicked).toHaveBeenCalledTimes(1);
  });
});
