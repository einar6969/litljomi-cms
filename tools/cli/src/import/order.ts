// Manual order (import plan section 2.3, step 5; A12, spec §5.1). A type the module orders by hand
// (`orderBy: 'manual'`) lists its entries by `entries.order_key`, which only `api.move_entry`
// changes: one entry just before or just after another of the same tenant and type, the same call
// the editor's list makes. An entry nobody has moved comes first, so a new tenant's entries are
// listed newest first, the reverse of the order the importer created them in.
//
// These functions are pure: the importer reads the type's list (`api.entry_list` by
// `order_position`, then id), plans the moves here, makes them one by one, and reads the list again.
// Only the relative order of the manifest's own entries is judged; an entry the manifest does not
// name is never moved and never a target, and keeps its place among the others.

export type Place = 'before' | 'after';

/** A move as api.move_entry takes it: `entry` just before or just after `target`. */
export interface Move {
  entry: string;
  target: string;
  place: Place;
}

/** `list` filtered to the members of `wanted`, in `list`'s order. */
export function relativeOrder(list: readonly string[], wanted: readonly string[]): string[] {
  const members = new Set(wanted);
  return list.filter((x) => members.has(x));
}

/** `list` after the moves, as api.move_entry makes them: each lands right beside its target. */
export function applyMoves(list: readonly string[], moves: readonly Move[]): string[] {
  let out = [...list];
  for (const { entry, target, place } of moves) {
    if (entry === target || !out.includes(entry) || !out.includes(target)) continue;
    const rest = out.filter((x) => x !== entry);
    const at = rest.indexOf(target) + (place === 'after' ? 1 : 0);
    out = [...rest.slice(0, at), entry, ...rest.slice(at)];
  }
  return out;
}

/** Indices into `seq` of one longest strictly increasing subsequence (patience sorting). */
function longestIncreasing(seq: readonly number[]): Set<number> {
  const tails: number[] = [];
  const previous: number[] = new Array<number>(seq.length).fill(-1);
  for (let i = 0; i < seq.length; i++) {
    const v = seq[i] as number;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((seq[tails[mid] as number] as number) < v) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) previous[i] = tails[lo - 1] as number;
    tails[lo] = i;
  }
  const keep = new Set<number>();
  let k = tails.length > 0 ? (tails[tails.length - 1] as number) : -1;
  while (k !== -1) {
    keep.add(k);
    k = previous[k] as number;
  }
  return keep;
}

/**
 * The fewest moves that put `wanted` in that order within `current`, the type's whole list as it
 * stands. The longest run of wanted entries already in order stays where it is; each other entry
 * is moved just after the wanted entry before it, or, for the first, just before the first one that
 * stays. They are made in wanted order, so every target is already in place when it is used.
 * A list already in order needs none, so a re-run moves nothing.
 */
export function planMoves(current: readonly string[], wanted: readonly string[]): Move[] {
  const position = new Map(current.map((x, i) => [x, i]));
  const positions = wanted.map((x) => {
    const p = position.get(x);
    if (p === undefined) throw new Error(`entry ${x} is not in the list`);
    return p;
  });
  const keep = longestIncreasing(positions);
  const firstKept = wanted.find((_, i) => keep.has(i));
  const moves: Move[] = [];
  wanted.forEach((entry, i) => {
    if (keep.has(i)) return;
    if (i > 0) moves.push({ entry, target: wanted[i - 1] as string, place: 'after' });
    else moves.push({ entry, target: firstKept as string, place: 'before' });
  });
  return moves;
}

/**
 * Where the delivered order of the wanted entries first differs from `wanted`, or null when it does
 * not. Only wanted entries that are delivered are compared: a missing one is its own difference.
 * `place` counts from 1; `expected` and `actual` hold up to five entries from there.
 */
export function orderDifference(wanted: readonly string[], delivered: readonly string[]): { place: number; expected: string[]; actual: string[] } | null {
  const actual = relativeOrder(delivered, wanted);
  const present = new Set(actual);
  const expected = wanted.filter((x) => present.has(x));
  const i = expected.findIndex((x, n) => actual[n] !== x);
  if (i === -1) return null;
  return { place: i + 1, expected: expected.slice(i, i + 5), actual: actual.slice(i, i + 5) };
}
