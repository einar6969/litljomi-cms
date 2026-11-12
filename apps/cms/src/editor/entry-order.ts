// The entry list of a manually ordered type (A12; spec §5.1): what a move asks the database for and
// what the list shows after it. A move is always "this entry just before, or just after, that one"
// (api.move_entry), so it means the same in a filtered list, where only some entries are shown: the
// entries the list does not show keep their places.
//
// This file imports nothing from the app, so the list component and its tests share it.

export type Place = 'before' | 'after';

/** A move as api.move_entry takes it. */
export type Move = { entryId: string; targetId: string; place: Place };

/** `ids` with `entryId` moved just before or just after `targetId`; `ids` unchanged when either is missing or they are the same. */
export function applyMove(ids: readonly string[], { entryId, targetId, place }: Move): string[] {
  if (entryId === targetId || !ids.includes(entryId) || !ids.includes(targetId)) return [...ids];
  const rest = ids.filter((id) => id !== entryId);
  const at = rest.indexOf(targetId) + (place === 'after' ? 1 : 0);
  return [...rest.slice(0, at), entryId, ...rest.slice(at)];
}

/**
 * One place up (`-1`) or down (`1`) for the entry at `index`: before the entry above it, or after
 * the entry below it. Null at the top going up, at the bottom going down, or for an index outside
 * the list.
 */
export function stepMove(ids: readonly string[], index: number, step: -1 | 1): Move | null {
  const entryId = ids[index];
  const targetId = ids[index + step];
  if (entryId === undefined || targetId === undefined) return null;
  return { entryId, targetId, place: step === -1 ? 'before' : 'after' };
}

/** Where a drop at `clientY` over a row lands: before it in its upper half, after it in its lower half. */
export function dropPlace(rowTop: number, rowHeight: number, clientY: number): Place {
  return clientY < rowTop + rowHeight / 2 ? 'before' : 'after';
}

/** True when the move changes nothing that the list shows. */
export const isNoMove = (ids: readonly string[], move: Move): boolean => {
  const next = applyMove(ids, move);
  return next.every((id, i) => id === ids[i]);
};
