// Publication order (import plan section 1, "Publication order is derived, not written"): a target is
// published before anything that refers to it. Items without references go first; each later wave
// holds what refers only to earlier waves. A cycle is broken at an item whose references into the
// cycle can all be left out and whose data still passes publish validation without them: its first
// pass is published without them, and a second pass after the last wave saves the full data and
// publishes it again. A cycle that cannot be broken so (a cycle of required references) is refused.
import type { EntryUse } from './refs.ts';

export interface WaveNode {
  key: string;
  uses: readonly EntryUse[];
}

export interface WavePlan {
  /** Keys per wave, in manifest order within a wave. */
  waves: string[][];
  /** Keys published once more, with their full data, after the last wave. */
  secondPass: string[];
  /** Per broken key: the keys its first pass leaves out. */
  dropped: Map<string, Set<string>>;
  problems: string[];
}

/** Strongly connected components (Tarjan), each in manifest order. */
function components(keys: readonly string[], edges: Map<string, Set<string>>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  let next = 0;
  const visit = (v: string) => {
    index.set(v, next);
    low.set(v, next);
    next += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of edges.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v) as number, low.get(w) as number));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v) as number, index.get(w) as number));
      }
    }
    if (low.get(v) === index.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop() as string;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      const order = new Map(keys.map((k, i) => [k, i]));
      out.push(scc.sort((a, b) => (order.get(a) as number) - (order.get(b) as number)));
    }
  };
  for (const k of keys) if (!index.has(k)) visit(k);
  return out;
}

/**
 * The waves for `nodes`. `canBreak(key, leftOut)` says whether the item's data, with its removable
 * uses of `leftOut` left out, still passes publish validation.
 */
export function deriveWaves(nodes: readonly WaveNode[], canBreak: (key: string, leftOut: ReadonlySet<string>) => boolean): WavePlan {
  const keys = nodes.map((n) => n.key);
  const known = new Set(keys);
  const uses = new Map(nodes.map((n) => [n.key, n.uses.filter((u) => known.has(u.key))]));
  const edges = new Map(keys.map((k) => [k, new Set((uses.get(k) ?? []).map((u) => u.key))]));
  const dropped = new Map<string, Set<string>>();
  const problems: string[] = [];

  const cyclic = (scc: string[]) => scc.length > 1 || (edges.get(scc[0] as string)?.has(scc[0] as string) ?? false);
  for (;;) {
    const cycles = components(keys, edges).filter(cyclic);
    if (cycles.length === 0) break;
    let progressed = false;
    for (const scc of cycles) {
      const members = new Set(scc);
      const candidate = scc.find((k) => {
        const into = (uses.get(k) ?? []).filter((u) => members.has(u.key) && (edges.get(k)?.has(u.key) ?? false));
        if (into.length === 0 || into.some((u) => !u.removable)) return false;
        const leftOut = new Set([...(dropped.get(k) ?? []), ...into.map((u) => u.key)]);
        return canBreak(k, leftOut);
      });
      if (candidate === undefined) {
        problems.push(`a cycle of required references cannot be broken: ${scc.map((k) => JSON.stringify(k)).join(', ')}`);
        for (const k of scc) for (const m of scc) edges.get(k)?.delete(m);
        continue;
      }
      const leftOut = dropped.get(candidate) ?? new Set<string>();
      for (const m of scc) {
        if (edges.get(candidate)?.has(m)) {
          leftOut.add(m);
          edges.get(candidate)?.delete(m);
        }
      }
      dropped.set(candidate, leftOut);
      progressed = true;
    }
    if (!progressed && problems.length > 0) break;
  }

  const depth = new Map<string, number>();
  const depthOf = (k: string): number => {
    const known = depth.get(k);
    if (known !== undefined) return known;
    const deps = [...(edges.get(k) ?? [])];
    const d = deps.length === 0 ? 0 : 1 + Math.max(...deps.map(depthOf));
    depth.set(k, d);
    return d;
  };
  const waves: string[][] = [];
  for (const k of keys) {
    const d = depthOf(k);
    while (waves.length <= d) waves.push([]);
    (waves[d] as string[]).push(k);
  }
  return { waves, secondPass: keys.filter((k) => dropped.has(k)), dropped, problems };
}
