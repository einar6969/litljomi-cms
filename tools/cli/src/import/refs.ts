// Turns a manifest item's `data` into the type's stored shape (import plan section 1, "References
// inside data"): `{"$entry": key}` becomes an entry reference and `{"$file": path, ...rest}` an asset
// reference with `rest` kept. Walks by field kind where the kind matters (an image's default alt, a
// list item's derived `_key`, a reference's allowed types, which references a first pass can leave
// out) and replaces generically everywhere else, so a kind it does not know (the video kind's still
// image) still gets its references replaced; the type's validators then judge the result.
import type { AnyFieldKind, ContentType } from '@litljomi/cms-schema';

export type Path = (string | number)[];

export interface Lookup {
  /** The entry with this manifest key: its id and type; null for an unknown key. */
  entry(key: string): { id: string; type: string } | null;
  /** The file with this manifest path: its asset id and default alt; null for an unknown path. */
  file(path: string): { id: string; alt: string } | null;
}

/** One `$entry` in an item's data. */
export interface EntryUse {
  key: string;
  at: Path;
  /** True when a first pass can leave it out (a reference field, a list item, a link, a link mark). */
  removable: boolean;
}

export interface Resolved {
  data: Record<string, unknown>;
  entries: EntryUse[];
  /** Every `$file` path, once per use. */
  files: string[];
  problems: string[];
}

const DROP = Symbol('drop');
type Out = unknown | typeof DROP;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const own = (o: object, k: string) => Object.hasOwn(o, k);

/** A JSON Pointer for a path, for messages. */
export const pointer = (path: Path): string => (path.length === 0 ? '(root)' : '/' + path.map((p) => String(p).replace(/~/g, '~0').replace(/\//g, '~1')).join('/'));

interface Walk {
  lookup: Lookup;
  /** Keys whose removable uses are left out (a cycle's first pass). */
  drop: ReadonlySet<string>;
  out: Resolved;
}

function problem(w: Walk, at: Path, message: string): void {
  w.out.problems.push(`${pointer(at)}: ${message}`);
}

/** `{"$entry": key}` → `{ _ref, _kind: 'entry' }`, or DROP when it is removable and its key is dropped. */
function entryRef(w: Walk, v: Record<string, unknown>, at: Path, removable: boolean, allowed: readonly string[] | undefined): Out {
  const keys = Object.keys(v);
  const key = v.$entry;
  if (keys.length !== 1 || typeof key !== 'string') {
    problem(w, at, 'an entry reference must be exactly {"$entry": "<key>"}');
    return v;
  }
  const target = w.lookup.entry(key);
  if (target === null) {
    problem(w, at, `"$entry" names no entry or singleton of the manifest: ${JSON.stringify(key)}`);
    return v;
  }
  if (allowed !== undefined && !allowed.includes(target.type)) {
    problem(w, at, `${JSON.stringify(key)} is of type "${target.type}"; this field allows ${allowed.map((t) => `"${t}"`).join(', ')}`);
  }
  w.out.entries.push({ key, at, removable });
  if (removable && w.drop.has(key)) return DROP;
  return { _ref: target.id, _kind: 'entry' };
}

/** `{"$file": path, ...rest}` → `{ _ref, _kind: 'asset', ...rest }`; `fillAlt` adds the file's default alt when `alt` is absent. */
function fileRef(w: Walk, v: Record<string, unknown>, at: Path, fillAlt: boolean): Out {
  const { $file: path, ...rest } = v;
  if (typeof path !== 'string') {
    problem(w, at, '"$file" must be a string');
    return v;
  }
  if (own(rest, '$entry')) problem(w, at, 'an object cannot be both "$file" and "$entry"');
  const file = w.lookup.file(path);
  if (file === null) {
    problem(w, at, `"$file" names no file of the manifest: ${JSON.stringify(path)}`);
    return v;
  }
  w.out.files.push(path);
  const restOut = Object.fromEntries(Object.entries(rest).map(([k, x]) => [k, generic(w, x, [...at, k])]));
  const ref: Record<string, unknown> = { _ref: file.id, _kind: 'asset', ...restOut };
  if (fillAlt && !own(rest, 'alt')) ref.alt = file.alt;
  return ref;
}

/** Replaces `$entry` and `$file` anywhere below `v`; nothing here can be left out. */
function generic(w: Walk, v: unknown, at: Path): unknown {
  if (Array.isArray(v)) return v.map((x, i) => generic(w, x, [...at, i]));
  if (!isObject(v)) return v;
  if (own(v, '_ref')) problem(w, at, 'a manifest names entries by "$entry" and files by "$file", never by id ("_ref")');
  if (own(v, '$entry')) return entryRef(w, v, at, false, undefined);
  if (own(v, '$file')) return fileRef(w, v, at, false);
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, generic(w, x, [...at, k])]));
}

function checkHref(w: Walk, href: unknown, at: Path): void {
  if (typeof href !== 'string') return;
  let canonical: string;
  try {
    canonical = new URL(href).href;
  } catch {
    return; // Not a URL at all: the validator names it.
  }
  if (canonical !== href) problem(w, at, `href is not in canonical form; write ${JSON.stringify(canonical)}`);
}

function richTextNode(w: Walk, node: unknown, at: Path): Out {
  if (Array.isArray(node)) return node.map((x, i) => richTextNode(w, x, [...at, i])).filter((x) => x !== DROP);
  if (!isObject(node)) return node;
  if (own(node, '_ref')) problem(w, at, 'a manifest names entries by "$entry" and files by "$file", never by id ("_ref")');
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(node)) {
    const here = [...at, k];
    if (k === 'attrs' && node.type === 'image' && isObject(x)) {
      const attrs: Record<string, unknown> = {};
      for (const [ak, ax] of Object.entries(x)) {
        attrs[ak] = ak === 'asset' && isObject(ax) && own(ax, '$file') ? fileRef(w, ax, [...here, ak], false) : generic(w, ax, [...here, ak]);
      }
      // The image node's alt, as the image field's: the file's default when left out.
      if (!own(x, 'alt') && isObject(x.asset) && typeof x.asset.$file === 'string') {
        const file = w.lookup.file(x.asset.$file);
        if (file !== null) attrs.alt = file.alt;
      }
      out[k] = attrs;
    } else if (k === 'marks' && Array.isArray(x)) {
      const marks = x
        .map((m, i) => {
          const mAt = [...here, i];
          if (!isObject(m) || m.type !== 'link' || !isObject(m.attrs)) return generic(w, m, mAt);
          checkHref(w, m.attrs.href, [...mAt, 'attrs', 'href']);
          if (!isObject(m.attrs.entry) || !own(m.attrs.entry, '$entry')) return generic(w, m, mAt);
          const entry = entryRef(w, m.attrs.entry, [...mAt, 'attrs', 'entry'], true, undefined);
          if (entry === DROP) return DROP;
          const { entry: _entry, ...attrs } = m.attrs;
          return { ...m, attrs: { ...(generic(w, attrs, [...mAt, 'attrs']) as object), entry } };
        })
        .filter((m) => m !== DROP);
      // A text node whose only mark was left out keeps no empty `marks`.
      if (marks.length > 0 || x.length === 0) out[k] = marks;
    } else if (k === 'content') {
      out[k] = richTextNode(w, x, here);
    } else {
      out[k] = generic(w, x, here);
    }
  }
  return out;
}

function field(w: Walk, f: AnyFieldKind, v: unknown, at: Path): Out {
  if (v === null || v === undefined) return v;
  const kind = f.kind;
  if (kind === 'reference' && isObject(v) && own(v, '$entry')) {
    return entryRef(w, v, at, true, (f as { to?: readonly string[] }).to);
  }
  if (kind === 'image' && isObject(v) && own(v, '$file')) return fileRef(w, v, at, true);
  if (kind === 'link' && isObject(v)) {
    checkHref(w, v.href, [...at, 'href']);
    if (isObject(v.entry) && own(v.entry, '$entry')) {
      const allowed = (f as { entryTypes?: readonly string[] }).entryTypes;
      const entry = entryRef(w, v.entry, [...at, 'entry'], true, allowed);
      if (entry === DROP) return DROP;
      const { entry: _entry, ...rest } = v;
      return { ...(generic(w, rest, at) as object), entry };
    }
    return generic(w, v, at);
  }
  if (kind === 'list' && Array.isArray(v)) {
    const of = (f as unknown as { of: AnyFieldKind }).of;
    return v
      .map((item, i): Out => {
        const here = [...at, i];
        if (!isObject(item)) return generic(w, item, here);
        // `_key` derived from the item's position, so a re-run saves the same data.
        const out: Record<string, unknown> = own(item, '_key') ? {} : { _key: `i${i}` };
        for (const [k, x] of Object.entries(item)) {
          if (k !== 'value') {
            out[k] = generic(w, x, [...here, k]);
            continue;
          }
          const value = field(w, of, x, [...here, 'value']);
          if (value === DROP) return DROP;
          out.value = value;
        }
        return out;
      })
      .filter((x) => x !== DROP);
  }
  if (kind === 'group' && isObject(v)) return fields(w, (f as unknown as { fields: Record<string, AnyFieldKind> }).fields, v, at);
  if (kind === 'richText') return richTextNode(w, v, at);
  return generic(w, v, at);
}

function fields(w: Walk, defs: Record<string, AnyFieldKind>, v: Record<string, unknown>, at: Path): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    const def = Object.hasOwn(defs, k) ? defs[k] : undefined;
    const value = def === undefined ? generic(w, x, [...at, k]) : field(w, def, x, [...at, k]);
    if (value !== DROP) out[k] = value;
  }
  return out;
}

/**
 * The stored shape of `data` for `type`, every reference replaced through `lookup`. Removable uses of
 * a key in `drop` are left out (the first pass of a cycle). The input is never modified.
 */
export function resolveData(type: ContentType, data: Record<string, unknown>, lookup: Lookup, drop: ReadonlySet<string> = new Set()): Resolved {
  const out: Resolved = { data: {}, entries: [], files: [], problems: [] };
  out.data = fields({ lookup, drop, out }, type.fields as Record<string, AnyFieldKind>, data, []);
  return out;
}
