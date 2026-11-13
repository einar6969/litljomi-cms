'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { moveEntryAction } from '@/app/(editor)/t/[tenant]/order-actions';
import { t } from '@/i18n/is';
import { Icon } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { StatusBadge, type BadgeTone } from '@/ui/StatusBadge';
import { useHydrated } from '@/ui/useHydrated';
import { applyMove, dropPlace, isNoMove, stepMove, type Move, type Place } from './entry-order';

/** One row of the list, prepared by the page (no data from the database beyond what it shows). */
export type OrderedRow = {
  id: string;
  href: string;
  title: string | null;
  statusLabel: string;
  tone: BadgeTone;
  updatedAt: string;
  updatedText: string;
};

type Props = { rows: OrderedRow[]; filtered: boolean };

type Status = { kind: 'idle' } | { kind: 'saving' } | { kind: 'moved'; text: string } | { kind: 'failed' };

type Drag = { id: string; over: { id: string; place: Place } | null };

/** How close to the window's top or bottom edge a drag scrolls the page, and by how much per move. */
const EDGE_PX = 48;
const SCROLL_PX = 24;

/**
 * The entry list of a manually ordered type (A12; spec §5.1), in the order the site shows. Each
 * row has a handle (drag it with a mouse, a pen or a finger, or press its up and down arrow keys)
 * and move-up and move-down buttons (44 px each, at every width). A move is saved at once through
 * `moveEntryAction`: the row moves before the answer, focus stays on it, and the status line says
 * where it now is; a refused or failed move puts the list back and says so. One move at a time:
 * a move asked for while one is being saved is ignored, and the controls are disabled until the
 * page is hydrated. In a filtered list, a move is relative to the rows shown (`entry-order.ts`).
 */
export function OrderedEntryTable({ rows, filtered }: Props) {
  const o = t.entries.order;
  const hydrated = useHydrated();
  const [source, setSource] = useState(rows);
  const [order, setOrder] = useState(rows);
  // A new list from the server (another search, a reload) replaces the one shown.
  if (rows !== source) {
    setSource(rows);
    setOrder(rows);
  }
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  useEffect(() => {
    if (focusId === null) return;
    setFocusId(null);
    tableRef.current?.querySelector<HTMLElement>(`[data-entry-row="${focusId}"] [data-handle]`)?.focus();
  }, [focusId]);

  const titleOf = (row: OrderedRow) => row.title ?? t.entries.untitled;
  const fill = (s: string, row: OrderedRow) => s.replace('{title}', titleOf(row));

  const save = async (move: Move) => {
    const ids = order.map((r) => r.id);
    if (busy || isNoMove(ids, move)) return;
    const before = order;
    const byId = new Map(order.map((r) => [r.id, r]));
    const next = applyMove(ids, move).map((id) => byId.get(id)!);
    setOrder(next);
    setBusy(true);
    setStatus({ kind: 'saving' });
    // The row's node moves in the table, which can drop its focus: put it back on the handle.
    setFocusId(move.entryId);
    let ok = false;
    try {
      ok = (await moveEntryAction(move.entryId, move.targetId, move.place)).ok;
    } catch {
      ok = false;
    }
    setBusy(false);
    if (ok) {
      const moved = byId.get(move.entryId)!;
      const n = next.findIndex((r) => r.id === move.entryId) + 1;
      setStatus({ kind: 'moved', text: fill(o.moved, moved).replace('{n}', String(n)).replace('{total}', String(next.length)) });
    } else {
      setOrder(before);
      setStatus({ kind: 'failed' });
      setFocusId(move.entryId);
    }
  };

  const step = (index: number, delta: -1 | 1) => {
    const move = stepMove(
      order.map((r) => r.id),
      index,
      delta,
    );
    if (move) void save(move);
  };

  const onHandleKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    step(index, e.key === 'ArrowUp' ? -1 : 1);
  };

  // Dragging uses pointer events on the handle, so it works with a mouse, a pen and a finger alike
  // (the handle has touch-action: none). The row under the pointer and which half of it decide the
  // drop; near the window's edge the page scrolls.
  const onPointerDown = (e: PointerEvent<HTMLButtonElement>, id: string) => {
    if (busy || !hydrated || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ id, over: null });
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (drag === null) return;
    if (e.clientY < EDGE_PX) window.scrollBy(0, -SCROLL_PX);
    else if (e.clientY > window.innerHeight - EDGE_PX) window.scrollBy(0, SCROLL_PX);
    const row = document.elementFromPoint?.(e.clientX, e.clientY)?.closest<HTMLElement>('[data-entry-row]');
    const id = row?.dataset.entryRow;
    if (!row || !id || id === drag.id) {
      if (drag.over !== null) setDrag({ id: drag.id, over: null });
      return;
    }
    const rect = row.getBoundingClientRect();
    const place = dropPlace(rect.top, rect.height, e.clientY);
    if (drag.over?.id !== id || drag.over.place !== place) setDrag({ id: drag.id, over: { id, place } });
  };
  const onPointerUp = () => {
    const done = drag;
    setDrag(null);
    if (done?.over) void save({ entryId: done.id, targetId: done.over.id, place: done.over.place });
  };

  // Disabled only until hydration: while a move is being saved the controls stay focusable (focus
  // stays on the moved row's handle) and `save` ignores further moves.
  const disabled = !hydrated;
  return (
    <>
      <p className="help" id="entry-order-help">
        {o.help}
        {filtered ? ` ${o.filtered}` : null}
      </p>
      <div className="card tbl-w">
        {/* Below 768 px the table is restyled as stacked rows (globals.css). Some screen readers
            drop a table's semantics once it is no longer display:table, so the roles are stated. */}
        <table ref={tableRef} role="table" className="tbl entry-table ordered" aria-describedby="entry-order-help">
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader" className="w-order">
                {o.column}
              </th>
              <th role="columnheader">{t.entries.title}</th>
              <th role="columnheader" className="w-status">
                {t.entries.status}
              </th>
              <th role="columnheader" className="w-time">
                {t.entries.updated}
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {order.map((row, index) => (
              <tr
                key={row.id}
                role="row"
                data-entry-row={row.id}
                data-drop={drag?.over?.id === row.id ? drag.over.place : undefined}
                className={drag?.id === row.id ? 'opacity-50' : undefined}
              >
                <td role="cell" className="c-order">
                  <span className="order-tools">
                    <button
                      type="button"
                      data-handle=""
                      className="icbtn drag-handle"
                      aria-label={fill(o.handle, row)}
                      disabled={disabled}
                      onKeyDown={(e) => onHandleKey(e, index)}
                      onPointerDown={(e) => onPointerDown(e, row.id)}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onPointerCancel={() => setDrag(null)}
                    >
                      <Icon name="grip" />
                    </button>
                    {index > 0 ? (
                      <button type="button" className="icbtn" aria-label={fill(o.moveUp, row)} disabled={disabled} onClick={() => step(index, -1)}>
                        <Icon name="chevronUp" />
                      </button>
                    ) : (
                      <span className="icbtn" aria-hidden="true" />
                    )}
                    {index < order.length - 1 ? (
                      <button type="button" className="icbtn" aria-label={fill(o.moveDown, row)} disabled={disabled} onClick={() => step(index, 1)}>
                        <Icon name="chevronDown" />
                      </button>
                    ) : (
                      <span className="icbtn" aria-hidden="true" />
                    )}
                  </span>
                </td>
                <td role="cell" className="c-title">
                  <Link href={row.href} className={row.title ? 't' : 't text-muted'}>
                    {titleOf(row)}
                  </Link>
                </td>
                <td role="cell" className="c-status">
                  <StatusBadge tone={row.tone}>{row.statusLabel}</StatusBadge>
                </td>
                <td role="cell" className="c-time">
                  <time className="mono text-muted" dateTime={row.updatedAt}>
                    {row.updatedText}
                  </time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* The result of the last move, in words: where the entry now is, or that it failed. */}
      <p role="status" className="help" data-testid="order-status">
        {status.kind === 'saving' ? o.saving : status.kind === 'moved' ? status.text : ''}
      </p>
      {status.kind === 'failed' ? (
        <Notice tone="error" role="alert">
          {o.failed}
        </Notice>
      ) : null}
    </>
  );
}
