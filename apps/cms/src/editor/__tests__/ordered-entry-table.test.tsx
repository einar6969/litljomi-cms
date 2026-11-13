// @vitest-environment jsdom
// A12: the entry list of a manually ordered type (spec §5.1): the order shown, the move buttons and
// the handle's arrow keys, each saved at once with its result in words, a failed move put back,
// one move at a time. Dragging is the browser spec's (e2e/manual-order.spec.ts): jsdom has no
// layout to drop on.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n/is';

const moveEntryAction = vi.hoisted(() => vi.fn());
vi.mock('@/app/(editor)/t/[tenant]/order-actions', () => ({ moveEntryAction }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const { OrderedEntryTable } = await import('../OrderedEntryTable');
type OrderedRow = import('../OrderedEntryTable').OrderedRow;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const id = (n: number) => `00000000-0000-4000-8000-0000000000e${n}`;
const row = (n: number, title: string | null): OrderedRow => ({
  id: id(n),
  href: `/t/acme/partner/${id(n)}`,
  title,
  statusLabel: t.entries.statuses.published,
  tone: 'ok',
  updatedAt: '2026-11-12T12:00:00Z',
  updatedText: '12.11.2026, 12:00:00',
});
const ROWS = [row(1, 'Alfa'), row(2, 'Beta'), row(3, null)];
const o = t.entries.order;
const label = (s: string, title: string) => s.replace('{title}', title);

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  moveEntryAction.mockReset();
  moveEntryAction.mockResolvedValue({ ok: true });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const render = async (rows = ROWS, filtered = false) => act(async () => root.render(<OrderedEntryTable rows={rows} filtered={filtered} />));
const titles = () => [...container.querySelectorAll('tbody tr')].map((tr) => tr.querySelector('a')!.textContent);
const button = (name: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.getAttribute('aria-label') === name);
const statusText = () => container.querySelector('[role="status"]')!.textContent;
const click = async (el: HTMLElement) => act(async () => el.click());
const press = async (el: HTMLElement, key: string) =>
  act(async () => void el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));

describe('the manually ordered entry list', () => {
  it('shows the rows in the order given, with an order column, a handle on every row and the buttons that can move it', async () => {
    await render();
    expect(titles()).toEqual(['Alfa', 'Beta', t.entries.untitled]);
    expect([...container.querySelectorAll('th')].map((th) => th.textContent)).toEqual([o.column, t.entries.title, t.entries.status, t.entries.updated]);
    expect(container.querySelectorAll('[data-handle]')).toHaveLength(3);
    expect(button(label(o.handle, 'Alfa'))).toBeDefined();
    expect(button(label(o.moveUp, 'Alfa'))).toBeUndefined();
    expect(button(label(o.moveDown, 'Alfa'))).toBeDefined();
    expect(button(label(o.moveUp, t.entries.untitled))).toBeDefined();
    expect(button(label(o.moveDown, t.entries.untitled))).toBeUndefined();
    expect(container.querySelector('a')!.getAttribute('href')).toBe(`/t/acme/partner/${id(1)}`);
    expect(container.querySelector('#entry-order-help')!.textContent).toBe(o.help);
    expect(container.querySelector('table')!.getAttribute('aria-describedby')).toBe('entry-order-help');
  });

  it('says a filtered list moves only among the rows shown', async () => {
    await render(ROWS, true);
    expect(container.querySelector('#entry-order-help')!.textContent).toBe(`${o.help} ${o.filtered}`);
  });

  it('moves down with a button: after the row below, saved at once, and says where it now is', async () => {
    await render();
    await click(button(label(o.moveDown, 'Alfa'))!);
    expect(moveEntryAction).toHaveBeenCalledWith(id(1), id(2), 'after');
    expect(titles()).toEqual(['Beta', 'Alfa', t.entries.untitled]);
    expect(statusText()).toBe(label(o.moved, 'Alfa').replace('{n}', '2').replace('{total}', '3'));
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('moves up with the arrow key on the handle: before the row above, and focus stays on the moved row', async () => {
    await render();
    const handle = button(label(o.handle, t.entries.untitled))!;
    handle.focus();
    await press(handle, 'ArrowUp');
    expect(moveEntryAction).toHaveBeenCalledWith(id(3), id(2), 'before');
    expect(titles()).toEqual(['Alfa', t.entries.untitled, 'Beta']);
    expect(document.activeElement).toBe(button(label(o.handle, t.entries.untitled)));
    await press(button(label(o.handle, t.entries.untitled))!, 'ArrowUp');
    expect(moveEntryAction).toHaveBeenLastCalledWith(id(3), id(1), 'before');
    expect(titles()).toEqual([t.entries.untitled, 'Alfa', 'Beta']);
    // At the top, ArrowUp asks for nothing.
    await press(button(label(o.handle, t.entries.untitled))!, 'ArrowUp');
    expect(moveEntryAction).toHaveBeenCalledTimes(2);
  });

  it('shows the move while it is saved and ignores another until it is done', async () => {
    let answer: (v: { ok: boolean }) => void = () => {};
    moveEntryAction.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    await render();
    await click(button(label(o.moveDown, 'Alfa'))!);
    expect(titles()).toEqual(['Beta', 'Alfa', t.entries.untitled]);
    expect(statusText()).toBe(o.saving);
    await click(button(label(o.moveDown, 'Beta'))!);
    expect(moveEntryAction).toHaveBeenCalledTimes(1);
    await act(async () => answer({ ok: true }));
    expect(statusText()).toBe(label(o.moved, 'Alfa').replace('{n}', '2').replace('{total}', '3'));
  });

  it('puts the list back and says so in plain words when a move fails or throws', async () => {
    moveEntryAction.mockResolvedValueOnce({ ok: false, code: 'error' });
    await render();
    await click(button(label(o.moveDown, 'Alfa'))!);
    expect(titles()).toEqual(['Alfa', 'Beta', t.entries.untitled]);
    expect(container.querySelector('[role="alert"]')!.textContent).toBe(o.failed);
    expect(statusText()).toBe('');
    expect(document.activeElement).toBe(button(label(o.handle, 'Alfa')));

    moveEntryAction.mockRejectedValueOnce(new Error('network'));
    await click(button(label(o.moveUp, 'Beta'))!);
    expect(titles()).toEqual(['Alfa', 'Beta', t.entries.untitled]);
    expect(container.querySelector('[role="alert"]')!.textContent).toBe(o.failed);

    // The next move that works clears the error.
    await click(button(label(o.moveUp, 'Beta'))!);
    expect(titles()).toEqual(['Beta', 'Alfa', t.entries.untitled]);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('takes a new list from the server in place of the one shown', async () => {
    await render();
    await click(button(label(o.moveDown, 'Alfa'))!);
    await render([row(4, 'Delta'), row(1, 'Alfa')]);
    expect(titles()).toEqual(['Delta', 'Alfa']);
  });
});
