import { createHash } from 'node:crypto';
import { types } from 'node:util';

/**
 * Canonical JSON: object keys sorted by UTF-16 code unit at every depth, `undefined` object
 * values dropped, array order kept (an `undefined` element and a sparse-array hole both become
 * null, exactly as `JSON.stringify` does), no whitespace. Throws for values JSON cannot represent
 * (NaN, Infinity, bigint, functions, symbols) and for objects that are not plain (prototype other
 * than `Object.prototype` or null: Date, Map, Set, boxed primitives, class instances), because
 * serialising those would silently differ from what a site receives.
 *
 * Arrays are walked by index up to `length`, never through `Symbol.iterator`, so an array with its
 * own or overridden iterator hashes what `JSON.stringify` delivers. A Proxy is always rejected
 * (`util.types.isProxy`): its traps can report a plain prototype and its own keys yet serialise
 * differently under `JSON.stringify` (for example a Date behind a lying `getPrototypeOf`, which
 * would otherwise hash as `{}`), and the two views cannot be made consistent.
 */
export function canonicalJson(v: unknown): string {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'string':
    case 'boolean':
      return JSON.stringify(v);
    case 'number':
      if (!Number.isFinite(v)) throw new Error('canonicalJson: non-finite number');
      return JSON.stringify(v);
    case 'object': {
      if (types.isProxy(v)) throw new Error('canonicalJson: proxies cannot be hashed');
      if (Array.isArray(v)) {
        // Index loop: holes read as `undefined`, which becomes null like JSON.stringify.
        const parts: string[] = [];
        for (let i = 0; i < v.length; i++) {
          const x: unknown = v[i];
          parts.push(x === undefined ? 'null' : canonicalJson(x));
        }
        return `[${parts.join(',')}]`;
      }
      const proto: unknown = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) throw new Error('canonicalJson: not a plain object');
      const entries = Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${canonicalJson(x)}`).join(',')}}`;
    }
    default:
      throw new Error(`canonicalJson: cannot serialise ${typeof v}`);
  }
}

/**
 * Lowercase hex SHA-256 of `canonicalJson(record)`. Hash the complete projected record, including
 * resolved asset URLs and referenced entries' summaries (spec §7.2).
 */
export function contentHash(record: unknown): string {
  return createHash('sha256').update(canonicalJson(record), 'utf8').digest('hex');
}
