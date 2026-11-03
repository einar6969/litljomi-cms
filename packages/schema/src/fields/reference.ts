import { definedOnly, draftOf, publishOf, type FieldKind } from '../field-kind.ts';
import { refSchema, type Ref } from '../ref.ts';
import { FieldProjectionError, resolveEntry, type EntrySummary } from '../projection.ts';

export interface ReferenceOptions {
  label: string;
  required?: boolean;
  /** The content types the reference may point to (type names of the same module), at least one. */
  to: readonly string[];
}

/** `{ _ref, _kind: 'entry' }`: the standard entry reference (spec §4.3). */
export type ReferenceValue = Ref<'entry'>;
export type ReferenceField = FieldKind<ReferenceValue, EntrySummary> & { to: readonly string[] };

// The same rule as type names in codegen.ts (lower-case kebab).
const TYPE_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

function targetTypes(to: readonly string[]): readonly string[] {
  if (to.length === 0) throw new Error('reference: `to` must name at least one content type');
  for (const name of to) {
    if (typeof name !== 'string' || !TYPE_NAME.test(name)) throw new Error(`reference: target type ${JSON.stringify(name)} is not a lower-case kebab name`);
  }
  if (new Set(to).size !== to.length) throw new Error('reference: `to` has a duplicate type name');
  return Object.freeze([...to]);
}

/**
 * A reference to one entry of the given types (spec §5.2). Stored as `{ _ref, _kind: 'entry' }`, so
 * the refs trigger extracts it and `worker_commit_publish` checks that the target is in the same
 * tenant and published (§4.3, §6.2 step 5). Delivered as the target's summary, or null when the
 * target is not in the release (unpublished, archived or left out; §6.2 "Unpublish", §7.1).
 *
 * The stored value does not carry the target's type, so the type is checked where the target is
 * known: the projection refuses a resolved target whose type is not in `to` (`FieldProjectionError`).
 * The worker projects every draft before committing it, so such a draft fails validation
 * (`projection_failed`) and is never committed.
 */
export function reference(o: ReferenceOptions): ReferenceField {
  const required = o.required ?? false;
  const to = targetTypes(o.to);
  const base = refSchema('entry');
  return {
    kind: 'reference',
    label: o.label,
    required,
    to,
    draftSchema: () => draftOf(base),
    publishSchema: () => publishOf(base, required),
    project: (v, ctx) => {
      if (v == null) return null;
      const target = resolveEntry(ctx, v._ref);
      if (target !== null && !to.includes(target.type)) {
        throw new FieldProjectionError([
          {
            code: 'custom',
            path: ['_ref'],
            message: `references an entry of type "${target.type}"; allowed: ${to.join(', ')}`,
            input: v,
          },
        ]);
      }
      return target;
    },
    tsType: () => 'EntrySummary | null',
    withOptions: (x) => reference({ ...o, ...definedOnly(x) }),
  };
}
