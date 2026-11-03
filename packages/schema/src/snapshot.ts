// Schema snapshots (spec §5.3, last bullet; plan M2-18).
//
// Each module commits a snapshot of its types: version, transform keys and fields with kind and
// options (labels left out: they are copy, not shape). `compareSchema` checks the module's current
// definition against the committed snapshot and fails on a breaking change that ships without a
// version bump and the transforms for it, and on a field name reused with another kind (§5.3: "A
// field name is never reused with a different meaning"). Each type's snapshot keeps the paths of
// the fields it has dropped (`retired`), so a reuse is caught however many versions later.

import type { AnyFieldKind } from './define-type.ts';
import type { ModuleManifest } from './module.ts';

/** One field: its kind, whether it is required, and the options that limit the stored value. */
export interface FieldSnapshot {
  kind: string;
  required: boolean;
  /** text, number, list. */
  min?: number;
  max?: number;
  /** text. */
  multiline?: boolean;
  /** number. */
  integer?: boolean;
  /** select: the stored values, in display order. */
  values?: string[];
  /** reference: the allowed target types. */
  to?: string[];
  /** link: the allowed entry types, null when any type is allowed. */
  entryTypes?: string[] | null;
  /** list: the item field. */
  of?: FieldSnapshot;
  /** group: the nested fields. */
  fields?: Record<string, FieldSnapshot>;
}

export interface TypeSnapshot {
  version: number;
  /** The keys n of the type's transforms (n → n+1), ascending. */
  transforms: number[];
  fields: Record<string, FieldSnapshot>;
  /** Paths of fields the type no longer has, with the kind they had (`a.b` in a group, `a[]` for list items). */
  retired: Record<string, string>;
}

export interface ModuleSnapshot {
  tenant: string;
  /** By type name, sorted. */
  types: Record<string, TypeSnapshot>;
}

export interface SchemaComparison {
  /** Breaking changes without their version bump and transforms, and reused field names. Non-empty fails the check. */
  errors: string[];
  /** Every difference from the snapshot that is allowed, so the snapshot should be updated. */
  changes: string[];
}

type Loose = AnyFieldKind & Record<string, unknown>;

function fieldSnapshot(field: AnyFieldKind): FieldSnapshot {
  const f = field as Loose;
  const s: FieldSnapshot = { kind: f.kind, required: f.required };
  const num = (key: 'min' | 'max') => {
    if (typeof f[key] === 'number') s[key] = f[key];
  };
  switch (f.kind) {
    case 'text':
      num('max');
      s.multiline = f.multiline === true;
      break;
    case 'number':
      num('min');
      num('max');
      s.integer = f.integer === true;
      break;
    case 'select':
      s.values = (f.options as ReadonlyArray<{ value: string }>).map((o) => o.value);
      break;
    case 'reference':
      s.to = [...(f.to as readonly string[])];
      break;
    case 'link':
      s.entryTypes = f.entryTypes === undefined ? null : [...(f.entryTypes as string[])];
      break;
    case 'list':
      num('min');
      num('max');
      s.of = fieldSnapshot(f.of as AnyFieldKind);
      break;
    case 'group':
      s.fields = fieldsSnapshot(f.fields as Record<string, AnyFieldKind>);
      break;
  }
  return s;
}

function fieldsSnapshot(fields: Record<string, AnyFieldKind>): Record<string, FieldSnapshot> {
  return Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, fieldSnapshot(field)]));
}

/** The snapshot of a module's current definition, with no retired fields (see `updateSnapshot`). */
export function moduleSnapshot(m: ModuleManifest): ModuleSnapshot {
  const types: Record<string, TypeSnapshot> = {};
  for (const t of [...m.types].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    types[t.name] = {
      version: t.version,
      transforms: Object.keys(t.transforms ?? {})
        .map(Number)
        .sort((a, b) => a - b),
      fields: fieldsSnapshot(t.fields),
      retired: {},
    };
  }
  return { tenant: m.tenant, types };
}

/** Every field path with its kind: `a`, `a.b` inside a group, `a[]` for a list's items. */
function paths(fields: Record<string, FieldSnapshot>, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  for (const [key, f] of Object.entries(fields)) {
    const path = prefix + key;
    out[path] = f.kind;
    let inner: FieldSnapshot | undefined = f;
    let at = path;
    // A list's items, and a list of lists' items, then a group's fields at the end of the chain.
    while (inner.kind === 'list' && inner.of !== undefined) {
      at += '[]';
      inner = inner.of;
      out[at] = inner.kind;
    }
    if (inner.kind === 'group' && inner.fields !== undefined) paths(inner.fields, at + '.', out);
  }
  return out;
}

/**
 * The snapshot to commit: `next` with each type's `retired` carried over from `previous`, plus the
 * paths `previous` had and `next` no longer has.
 */
export function updateSnapshot(previous: ModuleSnapshot | null, next: ModuleSnapshot): ModuleSnapshot {
  const types: Record<string, TypeSnapshot> = {};
  for (const [name, t] of Object.entries(next.types)) {
    const before = previous?.types[name];
    const retired: Record<string, string> = { ...(before?.retired ?? {}) };
    if (before !== undefined) {
      const now = paths(t.fields);
      for (const [path, kind] of Object.entries(paths(before.fields))) {
        if (!(path in now)) retired[path] = kind;
      }
    }
    types[name] = { ...t, retired: Object.fromEntries(Object.entries(retired).sort(([a], [b]) => (a < b ? -1 : 1))) };
  }
  return { tenant: next.tenant, types };
}

/** The breaking and the allowed differences between one field's two snapshots, at `path`. */
function compareField(path: string, a: FieldSnapshot, b: FieldSnapshot, breaking: string[], allowed: string[], isItem = false): void {
  if (a.kind !== b.kind) {
    breaking.push(`${path}: kind changed from ${a.kind} to ${b.kind}`);
    return;
  }
  // A list's items are always required on publish, whatever the item field says.
  if (!isItem && !a.required && b.required) breaking.push(`${path}: now required`);
  if (!isItem && a.required && !b.required) allowed.push(`${path}: now optional`);
  const lowered = (key: 'max') => {
    const x = a[key];
    const y = b[key];
    if (y !== undefined && (x === undefined || y < x)) breaking.push(`${path}: ${key} lowered from ${x ?? 'none'} to ${y}`);
    else if (x !== y) allowed.push(`${path}: ${key} raised from ${x} to ${y ?? 'none'}`);
  };
  const raised = (key: 'min') => {
    const x = a[key];
    const y = b[key];
    if (y !== undefined && (x === undefined || y > x)) breaking.push(`${path}: ${key} raised from ${x ?? 'none'} to ${y}`);
    else if (x !== y) allowed.push(`${path}: ${key} lowered from ${x} to ${y ?? 'none'}`);
  };
  const removedFrom = (what: string, x: string[] = [], y: string[] = []) => {
    for (const v of x) if (!y.includes(v)) breaking.push(`${path}: ${what} "${v}" removed`);
    for (const v of y) if (!x.includes(v)) allowed.push(`${path}: ${what} "${v}" added`);
  };
  switch (a.kind) {
    case 'text':
      lowered('max');
      if (a.multiline === true && b.multiline !== true) breaking.push(`${path}: no longer multiline`);
      if (a.multiline !== true && b.multiline === true) allowed.push(`${path}: now multiline`);
      break;
    case 'number':
      raised('min');
      lowered('max');
      if (a.integer !== true && b.integer === true) breaking.push(`${path}: now whole numbers only`);
      if (a.integer === true && b.integer !== true) allowed.push(`${path}: no longer whole numbers only`);
      break;
    case 'select':
      removedFrom('value', a.values, b.values);
      break;
    case 'reference':
      removedFrom('target type', a.to, b.to);
      break;
    case 'link':
      if (a.entryTypes === null || a.entryTypes === undefined) {
        if (Array.isArray(b.entryTypes)) breaking.push(`${path}: entry types narrowed from any to ${b.entryTypes.join(', ')}`);
      } else if (b.entryTypes === null || b.entryTypes === undefined) {
        allowed.push(`${path}: entry types widened to any`);
      } else {
        const gone = a.entryTypes.filter((t) => !b.entryTypes!.includes(t));
        if (gone.length > 0) breaking.push(`${path}: entry types narrowed (removed ${gone.join(', ')})`);
        else if (b.entryTypes.length !== a.entryTypes.length) allowed.push(`${path}: entry types widened`);
      }
      break;
    case 'list':
      raised('min');
      lowered('max');
      if (a.of !== undefined && b.of !== undefined) compareField(`${path}[]`, a.of, b.of, breaking, allowed, true);
      break;
    case 'group':
      compareFields(path + '.', a.fields ?? {}, b.fields ?? {}, breaking, allowed);
      break;
  }
}

function compareFields(prefix: string, a: Record<string, FieldSnapshot>, b: Record<string, FieldSnapshot>, breaking: string[], allowed: string[]): void {
  for (const [key, fa] of Object.entries(a)) {
    const fb = b[key];
    if (fb === undefined) breaking.push(`${prefix}${key}: field removed (a rename is a removal and an addition)`);
    else compareField(prefix + key, fa, fb, breaking, allowed);
  }
  for (const [key, fb] of Object.entries(b)) {
    if (key in a) continue;
    if (fb.required) breaking.push(`${prefix}${key}: new required field (existing entries do not have it)`);
    else allowed.push(`${prefix}${key}: new optional field`);
  }
}

/**
 * Compares a module's current definition with its committed snapshot. A type with a breaking
 * change passes only when its version is higher than the snapshot's and it has a transform for
 * every step from the snapshot's version up; a version raised without those transforms fails too,
 * since old drafts could not be upcast. A field name in the type's `retired` list that comes back
 * with another kind always fails. A removed type and a lowered version fail.
 */
export function compareSchema(previous: ModuleSnapshot, current: ModuleManifest): SchemaComparison {
  const next = moduleSnapshot(current);
  const errors: string[] = [];
  const changes: string[] = [];
  for (const name of Object.keys(previous.types)) {
    if (!(name in next.types)) errors.push(`${name}: type removed (entries of it would have no type)`);
  }
  for (const [name, b] of Object.entries(next.types)) {
    const a = previous.types[name];
    if (a === undefined) {
      changes.push(`${name}: new type`);
      continue;
    }
    if (b.version < a.version) {
      errors.push(`${name}: version lowered from ${a.version} to ${b.version}`);
      continue;
    }
    const missing: number[] = [];
    for (let n = a.version; n < b.version; n++) if (!b.transforms.includes(n)) missing.push(n);
    if (missing.length > 0) errors.push(`${name}: version raised from ${a.version} to ${b.version} without transform ${missing.join(', ')}`);
    else if (b.version > a.version) changes.push(`${name}: version raised from ${a.version} to ${b.version}`);

    const breaking: string[] = [];
    const allowed: string[] = [];
    compareFields(`${name}.`, a.fields, b.fields, breaking, allowed);
    if (b.version > a.version) {
      // Covered by the version bump (its transforms were checked above).
      changes.push(...breaking, ...allowed);
    } else {
      const steps = `bump ${name}'s version to ${a.version + 1} and add transform ${a.version} (${a.version} → ${a.version + 1})`;
      errors.push(...breaking.map((m) => `${m}: a breaking change; ${steps}`));
      changes.push(...allowed);
    }

    const now = paths(b.fields);
    for (const [path, kind] of Object.entries(a.retired ?? {})) {
      if (path in now && now[path] !== kind) errors.push(`${name}.${path}: field name reused with kind ${now[path]} (it was ${kind}); a field name is never reused with another meaning`);
    }
  }
  return { errors, changes };
}
