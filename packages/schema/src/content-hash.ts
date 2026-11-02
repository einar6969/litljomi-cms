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
 * would otherwise hash as `{}`), and the two views cannot be made consistent. For the same reason a
 * value with a `toJSON` method (own or inherited, which `JSON.stringify` would call) and an accessor
 * property (a getter, which may return something different on each read) are rejected
 * (Task 18 security r1).
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
        rejectToJsonAndAccessors(v);
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
      rejectToJsonAndAccessors(v);
      const entries = Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${canonicalJson(x)}`).join(',')}}`;
    }
    default:
      throw new Error(`canonicalJson: cannot serialise ${typeof v}`);
  }
}

function rejectToJsonAndAccessors(v: object): void {
  if ((v as { toJSON?: unknown }).toJSON !== undefined) throw new Error('canonicalJson: values with toJSON cannot be hashed');
  for (const d of Object.values(Object.getOwnPropertyDescriptors(v))) {
    if (d.get !== undefined || d.set !== undefined) throw new Error('canonicalJson: accessor properties cannot be hashed');
  }
}

/**
 * Lowercase hex SHA-256 of `canonicalJson(record)`. Hash the complete projected record, including
 * resolved asset URLs and referenced entries' summaries (spec §7.2).
 */
export function contentHash(record: unknown): string {
  return createHash('sha256').update(canonicalJson(record), 'utf8').digest('hex');
}

/**
 * A bundle entry's `contentHash` (spec §7.2): `contentHash` over the entry's complete delivered
 * record (id, revisionId, slug, title, sortAt, timestamps, schemaVersion and the projected data)
 * minus the `contentHash` field itself. The release build and the fixture bundles use this one
 * helper, so the hash changes whenever anything a site receives for the entry changes.
 */
export function entryContentHash(entry: Record<string, unknown>): string {
  const { contentHash: _ignored, ...record } = entry;
  return contentHash(record);
}
