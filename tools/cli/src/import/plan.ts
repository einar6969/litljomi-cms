// The dry run (import plan section 2.1): every check that needs no network, listing every problem
// rather than the first. The real run starts with the same checks, so nothing is written for a
// manifest the dry run would refuse.
import { isManuallyOrdered, isSingleton, type ContentType, type ModuleManifest } from '@litljomi/cms-schema';
import { richTextDocSchema } from '@litljomi/rich-text';
import { checkFrame, type Manifest } from './manifest.ts';
import { IMPORT_NAMESPACE, safeFilename, sha256Hex, slugBase, slugFits, uuidV5, type ImageMetadata, type InspectImage } from './media.ts';
import { pointer, resolveData, type EntryUse, type Lookup, type Path } from './refs.ts';
import { deriveWaves } from './waves.ts';
import { slugify } from '@litljomi/cms-schema';

/** The file access of the dry run; main.ts passes Node's, tests pass fakes. */
export interface MediaFs {
  /** What is at `path` without following a symlink; null when nothing is. */
  lstat(path: string): Promise<{ kind: 'file' | 'directory' | 'symlink' | 'other'; size: number } | null>;
  /** The file's bytes, refusing a symlink as the last component. */
  readBytes(path: string): Promise<Uint8Array>;
}

export interface PlanFile {
  path: string;
  sha256: string;
  bytes: number;
  /** The file's default alt; '' when the manifest gives none. */
  alt: string;
  caption: string | null;
  credit: string | null;
  meta: ImageMetadata;
  /** The storage file name, `safeFilename` of the path's last segment. */
  filename: string;
}

export interface PlanItem {
  key: string;
  type: string;
  contentType: ContentType;
  singleton: boolean;
  /** The slug the entry is created with; null for a singleton. */
  slug: string | null;
  /** The manifest's data, references by key. */
  data: Record<string, unknown>;
  uses: EntryUse[];
  /** The `$file` paths the data names. */
  files: string[];
}

export interface Plan {
  items: PlanItem[];
  byKey: Map<string, PlanItem>;
  files: Map<string, PlanFile>;
  waves: string[][];
  secondPass: string[];
  dropped: Map<string, Set<string>>;
  /** Explicit slugs the editor's save would re-derive from the title (2.4). */
  slugsAtRisk: { key: string; slug: string; fromTitle: string }[];
  /** The manifest's `order`, as written. */
  order: Record<string, string[]>;
  /**
   * The wanted order of each type the module orders by hand (`orderBy: 'manual'`) that has entries
   * in the manifest: the keys `order.<type>` names, then the type's other entries as listed. Step 5
   * puts the type's entries in this order (./order.ts); the report checks it.
   */
  manualOrder: Record<string, string[]>;
  problems: string[];
}

// The database's limits on a draft (`drafts.data` check; refs trigger).
export const MAX_DRAFT_BYTES = 1_048_576;
export const MAX_DRAFT_REFS = 1000;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `data::text` as Postgres prints a jsonb value: `{"k": v, "l": [1, 2]}`. Its UTF-8 length is what the check limits. */
export function jsonbText(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return `[${v.map(jsonbText).join(', ')}]`;
  if (typeof v === 'object') {
    return `{${Object.entries(v)
      .filter(([, x]) => x !== undefined)
      .map(([k, x]) => `${JSON.stringify(k)}: ${jsonbText(x)}`)
      .join(', ')}}`;
  }
  return JSON.stringify(v);
}

/** Deep equality of JSON values; an `undefined` property counts as absent. */
export function sameJson(a: unknown, b: unknown): boolean {
  return firstDifference(a, b, []) === null;
}

/** The path of the first place where `a` and `b` differ, or null. */
export function firstDifference(a: unknown, b: unknown, at: Path): Path | null {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return at;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (i >= a.length || i >= b.length) return [...at, i];
      const d = firstDifference(a[i], b[i], [...at, i]);
      if (d !== null) return d;
    }
    return null;
  }
  if (isObject(a) || isObject(b)) {
    if (!isObject(a) || !isObject(b)) return at;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => a[k] !== undefined || b[k] !== undefined));
    for (const k of [...keys].sort()) {
      const d = firstDifference(a[k], b[k], [...at, k]);
      if (d !== null) return d;
    }
    return null;
  }
  return Object.is(a, b) || (a === null && b === null) ? null : at;
}

/** A placeholder id for the dry run, of the same form as a real one. */
const placeholderId = (what: string) => uuidV5(IMPORT_NAMESPACE, `placeholder/${what}`);

/** Checks a value with a validator; any change it would make (a stripped key, a rewritten value) is a problem. */
function validates(label: string, schema: { safeParse(v: unknown): { success: true; data: unknown } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }, value: unknown): string[] {
  const parsed = schema.safeParse(value);
  if (!parsed.success) return parsed.error.issues.map((i) => `${label}: ${pointer(i.path.map((p) => (typeof p === 'number' ? p : String(p))))}: ${i.message}`);
  const diff = firstDifference(parsed.data, value, []);
  return diff === null ? [] : [`${label}: ${pointer(diff)}: the validator would strip or change this value (unknown field, or a value it rewrites)`];
}

const fileLabel = (path: string) => `file ${JSON.stringify(path)}`;

/** Every file: under the media folder, no symlink on the way, its size and hash as written, an accepted image. */
export async function checkFiles(manifest: Manifest, media: string, fs: MediaFs, inspectImage: InspectImage): Promise<{ files: Map<string, PlanFile>; problems: string[] }> {
  const problems: string[] = [];
  const files = new Map<string, PlanFile>();
  const root = await fs.lstat(media);
  if (root === null || (root.kind !== 'directory' && root.kind !== 'symlink')) return { files, problems: [`--media ${media} is not a folder`] };
  const seenHash = new Map<string, string>();
  for (const f of manifest.files) {
    const label = fileLabel(f.path);
    if (files.has(f.path)) {
      problems.push(`${label}: listed twice`);
      continue;
    }
    const other = seenHash.get(f.sha256);
    if (other !== undefined) {
      problems.push(`${label}: has the same sha256 as ${JSON.stringify(other)}; one library file has one caption and credit (decision 8)`);
      continue;
    }
    seenHash.set(f.sha256, f.path);
    const segments = f.path.split('/').filter((s) => s !== '');
    let here = media;
    let refused: string | null = null;
    let size = 0;
    for (const [i, segment] of segments.entries()) {
      here = `${here.replace(/\/+$/, '')}/${segment}`;
      const st = await fs.lstat(here);
      const last = i === segments.length - 1;
      if (st === null) refused = 'not found under --media';
      else if (st.kind === 'symlink') refused = 'is or passes through a symlink';
      else if (!last && st.kind !== 'directory') refused = 'a folder on its path is not a folder';
      else if (last && st.kind !== 'file') refused = 'is not a regular file';
      else size = st.size;
      if (refused !== null) break;
    }
    if (refused !== null) {
      problems.push(`${label}: ${refused}`);
      continue;
    }
    if (size !== f.bytes) {
      problems.push(`${label}: is ${size} bytes on disk, the manifest says ${f.bytes}`);
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = await fs.readBytes(here);
    } catch {
      problems.push(`${label}: could not be read`);
      continue;
    }
    if (bytes.byteLength !== f.bytes) {
      problems.push(`${label}: read ${bytes.byteLength} bytes, the manifest says ${f.bytes}`);
      continue;
    }
    if (sha256Hex(bytes) !== f.sha256) {
      problems.push(`${label}: its sha256 is not the manifest's`);
      continue;
    }
    const meta = await inspectImage(bytes);
    if (!meta.ok) {
      problems.push(`${label}: ${meta.reason === 'size' ? 'is empty or over 20 MB' : 'is not a JPEG, PNG or WebP image the CMS accepts'}`);
      continue;
    }
    files.set(f.path, {
      path: f.path,
      sha256: f.sha256,
      bytes: f.bytes,
      alt: f.alt ?? '',
      caption: f.caption ?? null,
      credit: f.credit ?? null,
      meta,
      filename: safeFilename(f.path, meta.mime),
    });
  }
  return { files, problems };
}

/** The slug an entry is created with: the manifest's, else the title's as the editor makes it, else the key's. */
export function entrySlug(type: ContentType, data: unknown, key: string, explicit: string | undefined): string {
  if (explicit !== undefined) return explicit;
  const fromTitle = slugBase(type.queryColumns(data).title);
  return fromTitle !== '' ? fromTitle : slugify(key).slice(0, 190).replace(/-+$/, '');
}

/** The data an item is saved with, references resolved through `lookup`; `first` leaves out what a cycle's first pass drops. */
export function itemData(plan: Pick<Plan, 'dropped'>, item: PlanItem, lookup: Lookup, pass: 'first' | 'full'): Record<string, unknown> {
  const drop = pass === 'first' ? (plan.dropped.get(item.key) ?? new Set<string>()) : new Set<string>();
  return resolveData(item.contentType, item.data, lookup, drop).data;
}

/** Every check of section 2.1 but the files' own (`checkFiles`), over the frame-checked manifest. */
export function planImport(manifest: Manifest, module: ModuleManifest, files: Map<string, PlanFile>, fileProblems: string[] = []): Plan {
  const problems: string[] = [...fileProblems];
  const types = new Map(module.types.map((t) => [t.name, t]));
  const items: PlanItem[] = [];
  const byKey = new Map<string, PlanItem>();
  const add = (type: string, key: string, data: Record<string, unknown>, slug: string | undefined, singleton: boolean, where: string) => {
    const contentType = types.get(type);
    if (contentType === undefined) {
      problems.push(`${where}: type "${type}" is not in the module`);
      return;
    }
    if (isSingleton(module, type) !== singleton) {
      problems.push(singleton ? `${where}: type "${type}" is not a singleton; list it under "entries"` : `${where}: type "${type}" is a singleton; give it under "singletons"`);
      return;
    }
    if (byKey.has(key)) {
      problems.push(`${where}: key ${JSON.stringify(key)} is used twice`);
      return;
    }
    const item: PlanItem = { key, type, contentType, singleton, slug: null, data, uses: [], files: [] };
    if (!singleton) item.slug = entrySlug(contentType, data, key, slug);
    items.push(item);
    byKey.set(key, item);
  };
  for (const [type, list] of Object.entries(manifest.entries)) list.forEach((e, i) => add(type, e.key, e.data, e.slug, false, `/entries/${type}/${i}`));
  for (const [type, s] of Object.entries(manifest.singletons ?? {})) add(type, s.key, s.data, undefined, true, `/singletons/${type}`);

  const lookup: Lookup = {
    entry: (key) => {
      const item = byKey.get(key);
      return item === undefined ? null : { id: placeholderId(`entry/${key}`), type: item.type };
    },
    file: (path) => {
      if (files.has(path)) return { id: placeholderId(`file/${path}`), alt: files.get(path)?.alt ?? '' };
      // A file the manifest lists but that failed its own checks is already a problem; resolve it anyway.
      const listed = manifest.files.find((f) => f.path === path);
      return listed === undefined ? null : { id: placeholderId(`file/${path}`), alt: listed.alt ?? '' };
    },
  };

  const slugs = new Map<string, Map<string, string>>();
  const slugsAtRisk: Plan['slugsAtRisk'] = [];
  for (const item of items) {
    const label = `${item.type} ${JSON.stringify(item.key)}`;
    const resolved = resolveData(item.contentType, item.data, lookup);
    item.uses = resolved.entries;
    item.files = resolved.files;
    problems.push(...resolved.problems.map((p) => `${label}: ${p}`));
    problems.push(...validates(`${label}: draft`, item.contentType.draftValidator(), resolved.data));
    problems.push(...validates(`${label}: publish`, item.contentType.publishValidator(), resolved.data));
    // Rich text is checked by its own schema as well as through the field, so a bad document is named once more with its field.
    for (const [name, field] of Object.entries(item.contentType.fields as Record<string, { kind: string }>)) {
      const value = resolved.data[name];
      if (field.kind === 'richText' && value !== undefined && value !== null && !richTextDocSchema.safeParse(value).success) {
        problems.push(`${label}: /${name}: not a v1 rich-text document`);
      }
    }
    const bytes = Buffer.byteLength(jsonbText(resolved.data), 'utf8');
    if (bytes > MAX_DRAFT_BYTES) problems.push(`${label}: its draft would be ${bytes} bytes; the limit is ${MAX_DRAFT_BYTES}`);
    const refs = resolved.entries.length + resolved.files.length;
    if (refs > MAX_DRAFT_REFS) problems.push(`${label}: its draft would hold ${refs} references; the limit is ${MAX_DRAFT_REFS}`);
    if (item.slug !== null) {
      const perType = slugs.get(item.type) ?? new Map<string, string>();
      slugs.set(item.type, perType);
      const other = perType.get(item.slug);
      if (other !== undefined) problems.push(`${label}: slug "${item.slug}" is also ${JSON.stringify(other)}'s`);
      else perType.set(item.slug, item.key);
      if (item.slug === '') problems.push(`${label}: no slug can be derived; give one`);
      const explicit = manifest.entries[item.type]?.find((e) => e.key === item.key)?.slug;
      const fromTitle = slugBase(item.contentType.queryColumns(resolved.data).title);
      if (explicit !== undefined && fromTitle !== '' && !slugFits(explicit, fromTitle)) slugsAtRisk.push({ key: item.key, slug: explicit, fromTitle });
    }
  }

  const order: Record<string, string[]> = {};
  for (const [type, keys] of Object.entries(manifest.order ?? {})) {
    const contentType = types.get(type);
    if (contentType === undefined) {
      problems.push(`/order/${type}: type "${type}" is not in the module`);
      continue;
    }
    // Only a type editors put in order has an order to apply; any other is listed by its field.
    if (!isManuallyOrdered(contentType)) {
      problems.push(`/order/${type}: type "${type}" is not ordered by hand in the module (its orderBy is "${String(contentType.orderBy)}", not "manual"), so no order can be applied to it`);
    }
    for (const key of keys) {
      const item = byKey.get(key);
      if (item === undefined || item.type !== type || item.singleton) problems.push(`/order/${type}: ${JSON.stringify(key)} is not an entry of type "${type}"`);
    }
    order[type] = keys;
  }
  const manualOrder: Record<string, string[]> = {};
  for (const contentType of module.types) {
    if (!isManuallyOrdered(contentType)) continue;
    const listed = items.filter((i) => i.type === contentType.name && !i.singleton).map((i) => i.key);
    if (listed.length === 0) continue;
    const first = (order[contentType.name] ?? []).filter((k) => listed.includes(k));
    manualOrder[contentType.name] = [...first, ...listed.filter((k) => !first.includes(k))];
  }

  const plan = deriveWaves(items, (key, leftOut) => {
    const item = byKey.get(key) as PlanItem;
    const data = resolveData(item.contentType, item.data, lookup, leftOut).data;
    return item.contentType.publishValidator().safeParse(data).success;
  });
  problems.push(...plan.problems);
  return { items, byKey, files, waves: plan.waves, secondPass: plan.secondPass, dropped: plan.dropped, slugsAtRisk, order, manualOrder, problems };
}

/** The frame, the files and the plan, in that order; a frame problem stops before the files are read. */
export async function dryRun(
  manifestText: string,
  module: ModuleManifest,
  media: string,
  fs: MediaFs,
  inspectImage: InspectImage,
): Promise<{ ok: true; plan: Plan } | { ok: false; problems: string[]; plan?: Plan }> {
  let raw: unknown;
  try {
    raw = JSON.parse(manifestText);
  } catch {
    return { ok: false, problems: ['the manifest is not valid JSON'] };
  }
  const frame = checkFrame(raw);
  if (!frame.ok) return { ok: false, problems: frame.problems };
  const checked = await checkFiles(frame.manifest, media, fs, inspectImage);
  const plan = planImport(frame.manifest, module, checked.files, checked.problems);
  return plan.problems.length > 0 ? { ok: false, problems: plan.problems, plan } : { ok: true, plan };
}

/** The text the report compares, from the manifest's side: every scalar of every item, by path. */
export function comparisonText(plan: Plan): string[] {
  const lines: string[] = [];
  const walk = (v: unknown, at: Path) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, [...at, i]));
    if (isObject(v)) {
      if (typeof v.$entry === 'string') return lines.push(`  ${pointer(at)}: → ${v.$entry}`);
      if (typeof v.$file === 'string') {
        lines.push(`  ${pointer(at)}: file ${v.$file}`);
        for (const [k, x] of Object.entries(v)) if (k !== '$file') walk(x, [...at, k]);
        return;
      }
      for (const [k, x] of Object.entries(v)) if (k !== '_key') walk(x, [...at, k]);
      return;
    }
    if (v !== undefined) lines.push(`  ${pointer(at)}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  };
  for (const wave of plan.waves) {
    for (const key of wave) {
      const item = plan.byKey.get(key) as PlanItem;
      lines.push(`${item.type} ${key}${item.slug === null ? ' (singleton)' : ` /${item.slug}`}`);
      walk(item.data, []);
    }
  }
  return lines;
}
