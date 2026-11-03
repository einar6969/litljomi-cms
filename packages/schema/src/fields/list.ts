import { z } from 'zod';
import { definedOnly, publishOf, type FieldKind, type FieldOptionOverrides } from '../field-kind.ts';
import { FieldProjectionError } from '../projection.ts';

export interface ListOptions {
  label: string;
  /** A required list needs at least one item on publish. */
  required?: boolean;
  /** Fewest items on publish, inclusive (drafts may hold fewer while the editor fills them in). */
  min?: number;
  /** Most items, inclusive; drafts too. */
  max?: number;
}

/** One stored item: a stable `_key` for reordering and the item's value as its field kind stores it (empty only in drafts). */
export type ListItem<T = unknown> = { _key: string; value: T | null };
/** One delivered item: the same `_key` and the projected value (null when it cannot resolve). */
export type ProjectedListItem<P = unknown> = { _key: string; value: P | null };

/** `withOptions` keeps the type, so the editor can read `of`, `min` and `max` after `extendType`. */
export type ListField<T = unknown, P = unknown> = Omit<FieldKind<ListItem<T>[], ProjectedListItem<P>[]>, 'withOptions'> & {
  of: FieldKind<T, P>;
  min?: number;
  max?: number;
  withOptions(o: FieldOptionOverrides): ListField<T, P>;
};

/**
 * An item key: 1 to 64 letters, digits, `_` or `-`. It is a value, not an object key, but the same
 * pattern as the database's object keys (decision 29) keeps it readable in paths and logs.
 */
const ITEM_KEY = /^[A-Za-z0-9_-]{1,64}$/;

/** A new random item key, for whoever adds an item (the editor). */
export function newItemKey(): string {
  return globalThis.crypto.randomUUID();
}

function assertBound(name: 'min' | 'max', v: number | undefined): void {
  if (v !== undefined && (!Number.isSafeInteger(v) || v < 0)) throw new Error(`list: ${name} must be a whole number of at least 0`);
}

function uniqueKeys(items: ReadonlyArray<{ _key: string }>, ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  items.forEach((item, i) => {
    if (seen.has(item._key)) ctx.addIssue({ code: 'custom', message: `duplicate item key "${item._key}"`, path: [i, '_key'], input: item._key });
    seen.add(item._key);
  });
}

/**
 * An ordered list of values of one field kind (spec §5.2), any kind including `group` and `list`.
 * Stored as `[{ _key, value }]`: the `_key` stays with its item when the list is reordered, so the
 * editor and sites can tell items apart; keys are unique within the list. Validation recurses:
 * a draft checks each item's value leniently and `max`; publish checks each value strictly (and
 * refuses an empty item, whatever `of`'s own required flag), `min` and `max`, and a required list
 * must have at least one item. Delivered as `[{ _key, value }]`
 * with each value projected by `of`, so references and images inside lists resolve like top-level
 * ones (null when they cannot), and item order is kept, so reordering changes the content hash.
 */
export function list<T, P>(of: FieldKind<T, P>, o: ListOptions): ListField<T, P> {
  const required = o.required ?? false;
  assertBound('min', o.min);
  assertBound('max', o.max);
  if (o.min !== undefined && o.max !== undefined && o.min > o.max) throw new Error(`list: min (${o.min}) is greater than max (${o.max})`);
  const items = (value: z.ZodType) => {
    let a = z.array(z.object({ _key: z.string().regex(ITEM_KEY, 'not a valid item key'), value }));
    if (o.max !== undefined) a = a.max(o.max);
    return a.superRefine(uniqueKeys);
  };
  const draftBase = items(of.draftSchema());
  // On publish every item holds a value: an empty item is one the editor has not filled in yet.
  let publishArray = items(of.withOptions({ required: true }).publishSchema());
  const min = Math.max(o.min ?? 0, required ? 1 : 0);
  if (min > 0) publishArray = publishArray.refine((a) => a.length >= min, `needs at least ${min} item${min === 1 ? '' : 's'}`);
  return {
    kind: 'list',
    label: o.label,
    required,
    of,
    min: o.min,
    max: o.max,
    draftSchema: () => draftBase.nullish() as unknown as z.ZodType<ListItem<T>[] | null | undefined>,
    publishSchema: () => publishOf(publishArray as unknown as z.ZodType<ListItem<T>[]>, required),
    project: (v, ctx) =>
      v == null
        ? null
        : v.map((item, i) => {
            try {
              return { _key: item._key, value: of.project(item.value, ctx) };
            } catch (error) {
              if (!(error instanceof FieldProjectionError)) throw error;
              throw new FieldProjectionError(error.issues.map((x) => ({ ...x, path: [i, 'value', ...x.path] })));
            }
          }),
    tsType: () => `Array<{ _key: string; value: ${of.tsType()} }> | null`,
    withOptions: (x) => list(of, { ...o, ...definedOnly(x) }),
  };
}
