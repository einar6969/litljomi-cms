import type { z } from 'zod';
import { canonicalHttpsUrl, isRootRelativePath } from '@litljomi/rich-text';
import type { AnyFieldKind, ContentType } from './define-type.ts';

/** An asset as delivered to sites (spec §7.1). */
export interface PublicAsset {
  id: string;
  url: string;
  width: number;
  height: number;
  mime: string;
  alt: string;
  focal: { x: number; y: number } | null;
}

/** A referenced entry as delivered to sites (spec §4.3, §7.1). */
export interface EntrySummary {
  id: string;
  type: string;
  slug: string | null;
  title: string | null;
  path: string | null;
}

/**
 * The lookups projection needs. The build step supplies the real implementation (published
 * revisions, copied media); tests supply a fake. Callers of `FieldKind.project` reach the data
 * only through the helpers `resolveAsset` and `resolveEntry` below, which check what comes back.
 */
export interface ProjectionContext {
  /** The asset with its public URL, or null when it is unknown. */
  asset(id: string): PublicAsset | null;
  /**
   * The entry's summary, or null unless the entry is published and not archived: exactly the
   * release inclusion rule of spec §7.1 (`published_rev_id IS NOT NULL AND archived_at IS NULL`),
   * and, in a release build, also null for an entry that the build leaves out (fail closed).
   */
  entry(id: string): EntrySummary | null;
}

/**
 * Asset lookup with the result checked: only `https:` URLs without credentials are accepted,
 * anything else counts as unresolved (null). Returns a copy with exactly the `PublicAsset` fields,
 * the URL in its canonical form (`new URL(url).href`).
 */
export function resolveAsset(ctx: ProjectionContext, id: string): PublicAsset | null {
  const a = ctx.asset(id);
  const url = a === null ? null : canonicalHttpsUrl(a.url);
  if (a === null || url === null) return null;
  return {
    id: a.id,
    url,
    width: a.width,
    height: a.height,
    mime: a.mime,
    alt: a.alt,
    focal: a.focal === null ? null : { x: a.focal.x, y: a.focal.y },
  };
}

/**
 * Entry lookup with the result checked: a path that is not root-relative (`/x`, not `//x` or
 * `/\x`) becomes null, so the summary stays but cannot be linked. Returns a copy with exactly
 * the `EntrySummary` fields.
 */
export function resolveEntry(ctx: ProjectionContext, id: string): EntrySummary | null {
  const e = ctx.entry(id);
  if (e === null) return null;
  return {
    id: e.id,
    type: e.type,
    slug: e.slug,
    title: e.title,
    path: e.path !== null && isRootRelativePath(e.path) ? e.path : null,
  };
}

export class ProjectionError extends Error {
  readonly issues: z.core.$ZodIssue[];
  constructor(typeName: string, issues: z.core.$ZodIssue[]) {
    // String() names a symbol path segment; Array.join would throw a TypeError on it.
    const where = (path: ReadonlyArray<PropertyKey>) => path.map((p) => String(p)).join('.') || '(root)';
    super(`cannot project ${typeName}: ${issues.map((i) => `${where(i.path)}: ${i.message}`).join('; ')}`);
    this.name = 'ProjectionError';
    this.issues = issues;
  }
}

/**
 * Thrown by a field's `project` when a value that passed the publish validator still cannot be
 * delivered, for a reason only the projection context can tell (a reference to an entry of a type
 * the field does not allow). Its issue paths are relative to the field; `projectEntry` prefixes the
 * field key and rethrows it as a `ProjectionError`.
 */
export class FieldProjectionError extends Error {
  readonly issues: z.core.$ZodIssue[];
  constructor(issues: z.core.$ZodIssue[]) {
    super(issues.map((i) => i.message).join('; '));
    this.name = 'FieldProjectionError';
    this.issues = issues;
  }
}

/**
 * Projects every field of a field set from already validated `stored` data: absent fields project
 * as null, keys not in `fields` are dropped. A field's `FieldProjectionError` is rethrown with the
 * field's key in front of its issue paths, so nested fields (`group`, `list`) report the full path
 * relative to the outermost field set.
 */
export function projectFields(
  fields: Record<string, AnyFieldKind>,
  stored: Record<string, unknown>,
  ctx: ProjectionContext,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries<AnyFieldKind>(fields)) {
    try {
      out[key] = field.project(stored[key], ctx);
    } catch (error) {
      if (!(error instanceof FieldProjectionError)) throw error;
      throw new FieldProjectionError(error.issues.map((i) => ({ ...i, path: [key, ...i.path] })));
    }
  }
  return out;
}

/**
 * Validates `data` with the publish validator, then projects every field: references resolved,
 * unknown keys dropped. Absent fields project as null. Throws `ProjectionError` when validation
 * fails or a field cannot be projected (`FieldProjectionError`, reported under the field's key).
 */
export function projectEntry(type: ContentType, data: unknown, ctx: ProjectionContext): Record<string, unknown> {
  const parsed = type.publishValidator().safeParse(data);
  if (!parsed.success) throw new ProjectionError(type.name, parsed.error.issues);
  try {
    return projectFields(type.fields, parsed.data as Record<string, unknown>, ctx);
  } catch (error) {
    if (!(error instanceof FieldProjectionError)) throw error;
    throw new ProjectionError(type.name, error.issues);
  }
}
