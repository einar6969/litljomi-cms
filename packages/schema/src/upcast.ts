// Schema evolution core (spec §5.1 `version` and `transforms`, §5.3; plan M2-05).
//
// A type at version N may ship transforms keyed n (1 ≤ n < N), each turning data written at
// version n into data at version n+1. `upcast` applies them in order from the data's version to
// the type's. It never changes the data it is given: the first transform gets a deep copy, so a
// stored revision read by the release build stays exactly as committed (revisions are never
// rewritten). Unknown keys are tolerated on read (left in place); the validators strip them.

/**
 * The worker's refusal codes for a draft not at the type's current schema version (§5.3, §6.1),
 * recorded as `publish_requests.error.code`. `draft_outdated`: the draft was written at an older
 * version and can be updated (upcast and saved). `draft_schema_ahead`: the draft was written at a
 * version newer than the deployed type (a code rollback); it cannot be published until it is.
 */
export const DRAFT_OUTDATED = 'draft_outdated';
export const DRAFT_SCHEMA_AHEAD = 'draft_schema_ahead';

export type Transform = (data: unknown) => unknown;

/** What `upcast` needs of a type: the definition's own fields. */
export interface Versioned {
  name: string;
  version: number;
  transforms?: Record<number, Transform>;
}

export type UpcastFailure =
  /** `fromVersion` is not a positive integer. */
  | 'version_invalid'
  /** The data is newer than the type. */
  | 'version_ahead'
  /** No transform for `atVersion` → `atVersion + 1` (a gap in the chain). */
  | 'transform_missing'
  /** The transform for `atVersion` threw or returned something other than a JSON object. */
  | 'transform_failed';

export class UpcastError extends Error {
  constructor(
    readonly type: string,
    readonly code: UpcastFailure,
    readonly fromVersion: number,
    readonly toVersion: number,
    readonly atVersion?: number,
    options?: { cause?: unknown },
  ) {
    super(`upcast ${type} from version ${String(fromVersion)} to ${toVersion}: ${code}${atVersion === undefined ? '' : ` at ${atVersion}`}`, options);
    this.name = 'UpcastError';
  }
}

const isPositiveInt = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 1;
const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const own = (o: object, k: number): boolean => Object.prototype.hasOwnProperty.call(o, String(k));

/**
 * Checks a definition's `version` and `transforms` (used by `defineType`): the version is a
 * positive integer, and each transform key is a canonical integer n with 1 ≤ n < version, mapped
 * to a function. A chain may have gaps (old transforms can be dropped); `upcast` refuses them.
 */
export function assertVersioning(d: Versioned): void {
  if (!isPositiveInt(d.version)) throw new Error(`defineType ${d.name}: version must be a positive integer, got ${String(d.version)}`);
  if (d.transforms === undefined) return;
  for (const [key, fn] of Object.entries(d.transforms)) {
    const n = Number(key);
    if (!isPositiveInt(n) || String(n) !== key || n >= d.version) {
      throw new Error(`defineType ${d.name}: transform key "${key}" must be an integer n with 1 ≤ n < version (${d.version}); it upgrades n → n+1`);
    }
    if (typeof fn !== 'function') throw new Error(`defineType ${d.name}: transform ${key} is not a function`);
  }
}

/**
 * The data at the type's current version. `fromVersion` is the version the data was written at
 * (`schema_version`). At the current version the data is returned as given; otherwise every
 * transform from `fromVersion` up must exist (checked before any runs), and each is applied in
 * order to a deep copy. Throws `UpcastError`.
 */
export function upcast(type: Versioned, data: unknown, fromVersion: number): unknown {
  const to = type.version;
  if (!isPositiveInt(fromVersion)) throw new UpcastError(type.name, 'version_invalid', fromVersion, to);
  if (fromVersion > to) throw new UpcastError(type.name, 'version_ahead', fromVersion, to);
  if (fromVersion === to) return data;
  const transforms = type.transforms ?? {};
  for (let n = fromVersion; n < to; n++) {
    if (!own(transforms, n)) throw new UpcastError(type.name, 'transform_missing', fromVersion, to, n);
  }
  let current: unknown = structuredClone(data);
  for (let n = fromVersion; n < to; n++) {
    let next: unknown;
    try {
      next = transforms[n]!(current);
    } catch (cause) {
      throw new UpcastError(type.name, 'transform_failed', fromVersion, to, n, { cause });
    }
    if (!isObject(next)) throw new UpcastError(type.name, 'transform_failed', fromVersion, to, n);
    current = next;
  }
  return current;
}
