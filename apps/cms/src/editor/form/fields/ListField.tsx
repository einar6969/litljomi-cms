'use client';

import { newItemKey, type ListItem } from '@litljomi/cms-schema/src/fields/list.ts';
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { t } from '@/i18n/is';
import { Button } from '@/ui/Button';
import { describedByOf, FieldGroup } from '@/ui/Field';
import type { FieldProps } from '../field-registry';
import { FieldInput } from '../FieldInput';

const ITEM_KEY = /^[A-Za-z0-9_-]{1,64}$/;

/** The stored items, or null when the value is not a list of `{ _key, value }` with unique keys. */
function itemsOf(value: unknown): ListItem[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const keys = new Set<string>();
  for (const item of value as unknown[]) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;
    const key = (item as { _key?: unknown })._key;
    if (typeof key !== 'string' || !ITEM_KEY.test(key) || keys.has(key)) return null;
    keys.add(key);
  }
  return value as ListItem[];
}

/** The list's rule in words: "Mest 10 atriði." */
export function listHelp({ min, max }: { min?: number; max?: number }): string | null {
  const l = t.editor.list;
  const fill = (s: string) => s.replace('{min}', String(min ?? 0)).replace('{max}', String(max ?? 0));
  if (min !== undefined && min > 0 && max !== undefined) return fill(l.range);
  if (min !== undefined && min > 0) return fill(l.atLeast);
  if (max !== undefined) return fill(l.atMost);
  return null;
}

/** `items` with the item at `from` moved to `to`. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/** After a render: focus a moved item's handle, a new item's first control, or the add button. */
type Focus = { key: string; target: 'handle' | 'control' } | { key: null; target: 'add' };

const FOCUSABLE = 'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], button:not([disabled])';

/**
 * A list (spec §5.2, "reorderable"): its items in order, each rendered through the registry with
 * the item field, plus add and remove. Items are reordered by dragging the handle, by the handle's
 * arrow keys (focus stays on the moved item's handle) or by the move buttons; each move is
 * announced. The stored value is `[{ _key, value }]`: a new item gets a fresh `_key` and an empty
 * value (null), and the key travels with the item, so a nested field keeps its state, help and
 * error text when its item moves. Each item's controls derive their ids from the list's id and the
 * item's key. An empty list is cleared. Adding stops at `max`. A stored value that is not a valid
 * list is named in an error and replaced only when the editor adds an item.
 */
export function ListField({ id, label, required, value, onChange, of, min, max }: FieldProps) {
  const l = t.editor.list;
  const stored = itemsOf(value);
  const [storedInvalid, setStoredInvalid] = useState(stored === null);
  // The latest items, so two changes before a re-render (two nested fields) both land.
  const latest = useRef<ListItem[]>(stored ?? []);
  const items = stored ?? [];
  useEffect(() => {
    latest.current = itemsOf(value) ?? [];
  }, [value]);
  const [announcement, setAnnouncement] = useState('');
  const [focus, setFocus] = useState<Focus | null>(null);
  // Dragging starts from the handle only, so text in an item's inputs stays selectable.
  const [armed, setArmed] = useState<string | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focus === null) return;
    setFocus(null);
    const root = rootRef.current;
    if (root === null) return;
    if (focus.key === null) {
      root.querySelector<HTMLElement>(':scope > [data-add] button')?.focus();
      return;
    }
    const item = root.querySelector<HTMLElement>(`:scope > ol > [data-item-key="${focus.key}"]`);
    const handle = item?.querySelector<HTMLElement>(':scope > div > [data-handle]');
    // A new item's control may not take focus yet (a reference picker is disabled while its
    // options load): its handle takes it instead.
    const control = focus.target === 'control' ? item?.querySelector<HTMLElement>(':scope > [data-item-body]')?.querySelector<HTMLElement>(FOCUSABLE) : null;
    (control ?? handle)?.focus();
  }, [focus]);

  const commit = (next: ListItem[]) => {
    latest.current = next;
    setStoredInvalid(false);
    onChange(next.length === 0 ? undefined : next);
  };

  const itemLabel = (n: number) => l.item.replace('{label}', of?.label ?? label).replace('{n}', String(n));

  const move = (from: number, to: number) => {
    const current = latest.current;
    if (from === to || to < 0 || to >= current.length) return;
    const key = current[from]!._key;
    commit(moveItem(current, from, to));
    setAnnouncement(l.moved.replace('{item}', itemLabel(from + 1)).replace('{n}', String(to + 1)).replace('{total}', String(current.length)));
    setFocus({ key, target: 'handle' });
  };

  const add = () => {
    const key = newItemKey();
    commit([...latest.current, { _key: key, value: null }]);
    setFocus({ key, target: 'control' });
  };

  const remove = (index: number) => {
    const current = latest.current;
    const next = current.filter((_, i) => i !== index);
    commit(next);
    setAnnouncement(l.removed.replace('{item}', itemLabel(index + 1)));
    const neighbour = next[index] ?? next[index - 1];
    setFocus(neighbour ? { key: neighbour._key, target: 'handle' } : { key: null, target: 'add' });
  };

  const setItem = (key: string, next: unknown) => {
    commit(latest.current.map((item) => (item._key === key ? { _key: key, value: next === undefined ? null : next } : item)));
  };

  const onHandleKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    move(index, e.key === 'ArrowUp' ? index - 1 : index + 1);
  };

  const onDrop = (e: DragEvent<HTMLLIElement>, index: number) => {
    e.preventDefault();
    const from = latest.current.findIndex((item) => item._key === dragged);
    setDragged(null);
    setArmed(null);
    if (from !== -1) move(from, index);
  };

  const full = max !== undefined && items.length >= max;
  const help = listHelp({ min, max });
  const error = storedInvalid ? t.editor.invalidStored : null;
  const itemField = of ?? null;

  return (
    <FieldGroup id={id} label={label} required={required} help={help} error={error} describedBy={describedByOf(id, { help, error })}>
      <div ref={rootRef} className="flex flex-col gap-3">
      {items.length === 0 ? <p className="text-sm font-normal text-muted">{l.empty}</p> : null}
      <ol className="flex flex-col gap-3">
        {items.map((item, index) => {
          const name = itemLabel(index + 1);
          const fill = (s: string) => s.replace('{item}', name);
          return (
            <li
              key={item._key}
              data-item-key={item._key}
              draggable={armed === item._key}
              onDragStart={(e) => {
                setDragged(item._key);
                // Some browsers start a drag only when it carries data.
                if (e.dataTransfer) {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', item._key);
                }
              }}
              onDragOver={(e) => {
                if (dragged !== null) e.preventDefault();
              }}
              onDrop={(e) => onDrop(e, index)}
              onDragEnd={() => {
                setDragged(null);
                setArmed(null);
              }}
              className={`flex flex-col gap-3 rounded-lg border border-hairline p-4 ${dragged === item._key ? 'opacity-50' : ''}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-handle=""
                  aria-label={fill(l.handle)}
                  onKeyDown={(e) => onHandleKey(e, index)}
                  onPointerDown={() => setArmed(item._key)}
                  onPointerUp={() => setArmed(null)}
                  className="inline-flex min-h-[44px] min-w-[44px] cursor-grab items-center justify-center rounded-md text-muted"
                >
                  <span aria-hidden="true">⠿</span>
                </button>
                <span className="ml-auto flex flex-wrap gap-2">
                  {index > 0 ? (
                    <Button variant="secondary" aria-label={fill(l.moveUp)} onClick={() => move(index, index - 1)}>
                      <span aria-hidden="true">↑</span>
                    </Button>
                  ) : null}
                  {index < items.length - 1 ? (
                    <Button variant="secondary" aria-label={fill(l.moveDown)} onClick={() => move(index, index + 1)}>
                      <span aria-hidden="true">↓</span>
                    </Button>
                  ) : null}
                  <Button variant="secondary" onClick={() => remove(index)}>
                    {fill(l.remove)}
                  </Button>
                </span>
              </div>
              <div data-item-body="">
                {itemField ? (
                  <FieldInput field={itemField} id={`${id}-${item._key}`} label={name} value={item.value ?? undefined} onChange={(next) => setItem(item._key, next)} />
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      <div data-add="">
        <Button variant="secondary" onClick={add} disabled={full}>
          {l.add}
        </Button>
      </div>
      </div>
      {/* Not role="status": the form's save status is the page's one status region. */}
      <p aria-live="polite" data-testid="list-announcement" className="sr-only">
        {announcement}
      </p>
    </FieldGroup>
  );
}
