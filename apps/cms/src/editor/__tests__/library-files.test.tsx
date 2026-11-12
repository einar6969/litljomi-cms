// @vitest-environment jsdom
import { act, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n/is';

const actions = vi.hoisted(() => ({ ensureThumbnailAction: vi.fn() }));
vi.mock('@/app/(editor)/t/[tenant]/asset-actions', () => actions);
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const { LibraryFiles } = await import('../media/LibraryFiles');
type Files = Parameters<typeof LibraryFiles>[0]['files'];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const files: Files = [1, 2, 3].map((n) => ({
  id: id(n),
  href: `/t/demo/assets?file=${id(n)}`,
  filename: `mynd-${n}.jpg`,
  mime: 'image/jpeg',
  kind: 'image',
  alt: n === 2 ? 'Rúgbrauð á borði' : null,
  width: 2048,
  height: 716,
  bytes: 61_952,
  createdAt: '2026-10-04T12:00:00Z',
  uploaded: '4. okt. 2026',
  thumbUrl: `http://127.0.0.1:54321/thumb-${n}`,
  usage: n,
}));

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
const cards = () => [...container.querySelectorAll<HTMLAnchorElement>('[data-testid="library-grid"] a')];
const press = (el: Element, key: string) =>
  act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });

describe('LibraryFiles as a grid', () => {
  it('names each card by its file name and alt text, with its size line, and a decorative thumbnail', async () => {
    await render(<LibraryFiles view="grid" files={files} activeId={null} />);
    expect(cards().map((a) => a.getAttribute('aria-label'))).toEqual(['mynd-1.jpg', 'mynd-2.jpg, Rúgbrauð á borði', 'mynd-3.jpg']);
    expect(cards()[0]!.getAttribute('href')).toBe(files[0]!.href);
    expect(cards()[0]!.textContent).toContain('2048×716 · 60,5 KB');
    const img = cards()[0]!.querySelector('img')!;
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('src')).toBe('http://127.0.0.1:54321/thumb-1');
  });

  it('is one tab stop, the open file or else the first, and the arrow keys, Home and End move between cards', async () => {
    await render(<LibraryFiles view="grid" files={files} activeId={null} />);
    expect(cards().map((a) => a.tabIndex)).toEqual([0, -1, -1]);
    cards()[0]!.focus();
    await press(cards()[0]!, 'ArrowRight');
    expect(document.activeElement).toBe(cards()[1]);
    expect(cards().map((a) => a.tabIndex)).toEqual([-1, 0, -1]);
    await press(cards()[1]!, 'End');
    expect(document.activeElement).toBe(cards()[2]);
    await press(cards()[2]!, 'ArrowRight');
    expect(document.activeElement).toBe(cards()[2]);
    await press(cards()[2]!, 'Home');
    expect(document.activeElement).toBe(cards()[0]);
    await press(cards()[0]!, 'ArrowLeft');
    expect(document.activeElement).toBe(cards()[0]);

    await render(<LibraryFiles view="grid" files={files} activeId={id(3)} />);
    expect(cards().map((a) => a.tabIndex)).toEqual([-1, -1, 0]);
    expect(cards()[2]!.getAttribute('aria-current')).toBe('true');
  });

  it('gives focus back to the card of the file whose details were closed', async () => {
    await render(<LibraryFiles view="grid" files={files} activeId={id(2)} />);
    document.body.focus();
    await render(<LibraryFiles view="grid" files={files} activeId={null} />);
    expect(document.activeElement).toBe(cards()[1]);
  });

  it('asks for the thumbnails of files without one, one after another, and shows each as it comes', async () => {
    const answers: ((value: unknown) => void)[] = [];
    actions.ensureThumbnailAction.mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
    await render(<LibraryFiles view="grid" files={files.map((f) => ({ ...f, thumbUrl: f.id === id(3) ? f.thumbUrl : null }))} activeId={null} />);
    expect(actions.ensureThumbnailAction.mock.calls).toEqual([[id(1)]]);
    expect(cards()[0]!.querySelector('img')).toBeNull();
    expect(cards()[0]!.querySelector('svg')).not.toBeNull();
    await act(async () => answers[0]!({ ok: true, url: 'http://127.0.0.1:54321/new-1' }));
    expect(cards()[0]!.querySelector('img')?.getAttribute('src')).toBe('http://127.0.0.1:54321/new-1');
    expect(actions.ensureThumbnailAction.mock.calls).toEqual([[id(1)], [id(2)]]);
    // A file that cannot have one keeps its icon.
    await act(async () => answers[1]!({ ok: false, code: 'error' }));
    expect(cards()[1]!.querySelector('img')).toBeNull();
    expect(actions.ensureThumbnailAction).toHaveBeenCalledTimes(2);
  });

  it('signs a thumbnail that fails to load once more, then shows the icon', async () => {
    actions.ensureThumbnailAction.mockResolvedValue({ ok: true, url: 'http://127.0.0.1:54321/again' });
    await render(<LibraryFiles view="grid" files={[files[0]!]} activeId={null} />);
    await act(async () => cards()[0]!.querySelector('img')!.dispatchEvent(new Event('error')));
    expect(actions.ensureThumbnailAction).toHaveBeenCalledWith(id(1));
    expect(cards()[0]!.querySelector('img')?.getAttribute('src')).toBe('http://127.0.0.1:54321/again');
    await act(async () => cards()[0]!.querySelector('img')!.dispatchEvent(new Event('error')));
    expect(actions.ensureThumbnailAction).toHaveBeenCalledTimes(1);
    expect(cards()[0]!.querySelector('img')).toBeNull();
  });
});

describe('LibraryFiles as a list', () => {
  it('is a table of the same files with their type, size, dimensions, upload date and usage count', async () => {
    await render(<LibraryFiles view="list" files={files} activeId={null} />);
    const table = container.querySelector('table')!;
    expect([...table.querySelectorAll('th')].map((th) => th.textContent)).toEqual([
      t.library.col.file,
      t.library.col.type,
      t.library.col.size,
      t.library.col.dimensions,
      t.library.col.uploaded,
      t.library.col.usage,
    ]);
    const cells = [...table.querySelectorAll('tbody tr')[1]!.querySelectorAll('td')].map((td) => td.textContent);
    expect(cells).toEqual(['mynd-2.jpg', 'JPEG', '60,5 KB', '2048×716', '4. okt. 2026', '2']);
    const name = table.querySelector<HTMLAnchorElement>('tbody tr a')!;
    expect(name.getAttribute('href')).toBe(files[0]!.href);
    expect(container.querySelector('[data-testid="library-grid"]')).toBeNull();
  });
});
