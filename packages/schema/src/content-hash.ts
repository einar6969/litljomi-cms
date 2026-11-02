import { createHash } from 'node:crypto';

/**
 * Canonical JSON: object keys sorted by UTF-16 code unit at every depth, `undefined` object
 * values dropped, array order kept (an `undefined` element becomes null, as in JSON), no
 * whitespace. Throws for values JSON cannot represent (NaN, Infinity, bigint, functions, symbols).
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
      if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : canonicalJson(x))).join(',')}]`;
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
