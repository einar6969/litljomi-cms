// The import manifest, format 1 (docs/plans/import.md section 1). `checkFrame` applies the plan's JSON
// Schema (`MANIFEST_SCHEMA`, kept here word for word) by hand, so the CLI needs no schema library, and
// lists every problem rather than the first. The module's validators check each `data` afterwards.

export interface ManifestFile {
  path: string;
  sha256: string;
  bytes: number;
  alt?: string | null;
  caption?: string | null;
  credit?: string | null;
}

export interface ManifestEntry {
  key: string;
  slug?: string;
  data: Record<string, unknown>;
}

export interface ManifestSingleton {
  key: string;
  data: Record<string, unknown>;
}

export interface Manifest {
  format: 1;
  files: ManifestFile[];
  entries: Record<string, ManifestEntry[]>;
  singletons?: Record<string, ManifestSingleton>;
  order?: Record<string, string[]>;
}

/** The plan's JSON Schema (import.md section 1), for anyone who writes a manifest. */
export const MANIFEST_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:litljomi:cms-import:1',
  type: 'object',
  additionalProperties: false,
  required: ['format', 'files', 'entries'],
  properties: {
    format: { const: 1 },
    files: { type: 'array', items: { $ref: '#/$defs/file' } },
    entries: { type: 'object', propertyNames: { $ref: '#/$defs/typeName' }, additionalProperties: { type: 'array', items: { $ref: '#/$defs/entry' } } },
    singletons: { type: 'object', propertyNames: { $ref: '#/$defs/typeName' }, additionalProperties: { $ref: '#/$defs/singleton' } },
    order: {
      type: 'object',
      propertyNames: { $ref: '#/$defs/typeName' },
      additionalProperties: { type: 'array', uniqueItems: true, items: { $ref: '#/$defs/key' } },
    },
  },
  $defs: {
    typeName: { type: 'string', pattern: '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' },
    key: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_./:-]{0,99}$' },
    text: { type: ['string', 'null'] },
    file: {
      type: 'object',
      additionalProperties: false,
      required: ['path', 'sha256', 'bytes'],
      properties: {
        path: { type: 'string', minLength: 1, maxLength: 500, pattern: '^(?!/)(?!.*\\\\)(?!(.*/)?\\.{1,2}(/|$)).+$' },
        sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        bytes: { type: 'integer', minimum: 1, maximum: 20971520 },
        alt: { $ref: '#/$defs/text', maxLength: 1000 },
        caption: { $ref: '#/$defs/text', maxLength: 1000 },
        credit: { $ref: '#/$defs/text', maxLength: 300 },
      },
    },
    entry: {
      type: 'object',
      additionalProperties: false,
      required: ['key', 'data'],
      properties: {
        key: { $ref: '#/$defs/key' },
        data: { type: 'object' },
        slug: { type: 'string', maxLength: 200, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
      },
    },
    singleton: {
      type: 'object',
      additionalProperties: false,
      required: ['key', 'data'],
      properties: { key: { $ref: '#/$defs/key' }, data: { type: 'object' } },
    },
    entryRef: { type: 'object', additionalProperties: false, required: ['$entry'], properties: { $entry: { $ref: '#/$defs/key' } } },
    fileRef: { type: 'object', required: ['$file'], properties: { $file: { type: 'string' } } },
  },
} as const;

export const TYPE_NAME_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
export const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_./:-]{0,99}$/;
// No leading `/`, no backslash, no `.` or `..` segment.
export const PATH_RE = /^(?!\/)(?!.*\\)(?!(.*\/)?\.{1,2}(\/|$)).+$/;
export const SHA256_RE = /^[0-9a-f]{64}$/;
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_FILE_BYTES = 20_971_520;
const TEXT_LIMITS = { alt: 1000, caption: 1000, credit: 300 } as const;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** JSON Schema counts a string's length in code points. */
const length = (s: string) => Array.from(s).length;
const show = (key: string) => JSON.stringify(key.length > 60 ? `${key.slice(0, 60)}…` : key);

export type FrameResult = { ok: true; manifest: Manifest } | { ok: false; problems: string[] };

/** Checks the manifest against the plan's JSON Schema; every problem, with its JSON path. */
export function checkFrame(raw: unknown): FrameResult {
  const problems: string[] = [];
  const at = (path: string, message: string) => problems.push(`${path || '(root)'}: ${message}`);

  if (!isObject(raw)) return { ok: false, problems: ['(root): the manifest must be a JSON object'] };
  for (const k of Object.keys(raw)) if (!['format', 'files', 'entries', 'singletons', 'order'].includes(k)) at('', `unknown property ${show(k)}`);
  if (raw.format !== 1) at('/format', 'must be 1');

  const typeNames = (path: string, value: unknown): Record<string, unknown> | null => {
    if (!isObject(value)) {
      at(path, 'must be an object');
      return null;
    }
    for (const name of Object.keys(value)) if (!TYPE_NAME_RE.test(name)) at(path, `${show(name)} is not a type name`);
    return value;
  };
  const checkKey = (path: string, key: unknown) => {
    if (typeof key !== 'string' || !KEY_RE.test(key)) at(path, 'must be a key: a letter or digit, then up to 99 of A-Z a-z 0-9 _ . / : -');
  };

  if (!Array.isArray(raw.files)) at('/files', 'must be an array');
  else
    raw.files.forEach((file, i) => {
      const p = `/files/${i}`;
      if (!isObject(file)) return at(p, 'must be an object');
      for (const k of Object.keys(file)) if (!['path', 'sha256', 'bytes', 'alt', 'caption', 'credit'].includes(k)) at(p, `unknown property ${show(k)}`);
      if (typeof file.path !== 'string' || file.path.length === 0 || file.path.length > 500) at(`${p}/path`, 'must be a string of 1 to 500 characters');
      else if (!PATH_RE.test(file.path)) at(`${p}/path`, 'must be relative, with no backslash and no . or .. segment');
      if (typeof file.sha256 !== 'string' || !SHA256_RE.test(file.sha256)) at(`${p}/sha256`, 'must be 64 lowercase hex digits');
      if (typeof file.bytes !== 'number' || !Number.isInteger(file.bytes) || file.bytes < 1 || file.bytes > MAX_FILE_BYTES) {
        at(`${p}/bytes`, `must be a whole number from 1 to ${MAX_FILE_BYTES}`);
      }
      for (const [name, max] of Object.entries(TEXT_LIMITS)) {
        const v = file[name];
        if (v === undefined || v === null) continue;
        if (typeof v !== 'string') at(`${p}/${name}`, 'must be a string or null');
        else if (length(v) > max) at(`${p}/${name}`, `must be at most ${max} characters`);
      }
    });

  if (raw.entries === undefined) at('/entries', 'is required');
  else {
    const entries = typeNames('/entries', raw.entries);
    for (const [type, list] of Object.entries(entries ?? {})) {
      const p = `/entries/${type}`;
      if (!Array.isArray(list)) {
        at(p, 'must be an array');
        continue;
      }
      list.forEach((entry, i) => {
        const q = `${p}/${i}`;
        if (!isObject(entry)) return at(q, 'must be an object');
        for (const k of Object.keys(entry)) if (!['key', 'slug', 'data'].includes(k)) at(q, `unknown property ${show(k)}`);
        checkKey(`${q}/key`, entry.key);
        if (!isObject(entry.data)) at(`${q}/data`, 'must be an object');
        if (entry.slug !== undefined && (typeof entry.slug !== 'string' || entry.slug.length > 200 || !SLUG_RE.test(entry.slug))) {
          at(`${q}/slug`, 'must be lowercase letters and digits in hyphenated words, at most 200 characters');
        }
      });
    }
  }

  if (raw.singletons !== undefined) {
    const singletons = typeNames('/singletons', raw.singletons);
    for (const [type, s] of Object.entries(singletons ?? {})) {
      const p = `/singletons/${type}`;
      if (!isObject(s)) {
        at(p, 'must be an object');
        continue;
      }
      for (const k of Object.keys(s)) if (!['key', 'data'].includes(k)) at(p, `unknown property ${show(k)}`);
      checkKey(`${p}/key`, s.key);
      if (!isObject(s.data)) at(`${p}/data`, 'must be an object');
    }
  }

  if (raw.order !== undefined) {
    const order = typeNames('/order', raw.order);
    for (const [type, keys] of Object.entries(order ?? {})) {
      const p = `/order/${type}`;
      if (!Array.isArray(keys)) {
        at(p, 'must be an array');
        continue;
      }
      keys.forEach((k, i) => checkKey(`${p}/${i}`, k));
      if (new Set(keys).size !== keys.length) at(p, 'names a key twice');
    }
  }

  return problems.length > 0 ? { ok: false, problems } : { ok: true, manifest: raw as unknown as Manifest };
}
