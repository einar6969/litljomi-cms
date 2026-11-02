import type { z } from 'zod';
import { isHttpsUrl, isRootRelativePath } from '@litljomi/rich-text';
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
  /** The entry's summary, or null when it is not published (spec §6.2). */
  entry(id: string): EntrySummary | null;
}

/**
 * Asset lookup with the result checked: only `https:` URLs are accepted, anything else counts as
 * unresolved (null). Returns a copy with exactly the `PublicAsset` fields.
 */
export function resolveAsset(ctx: ProjectionContext, id: string): PublicAsset | null {
  const a = ctx.asset(id);
  if (a === null || !isHttpsUrl(a.url)) return null;
  return {
    id: a.id,
    url: a.url,
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
    super(`cannot project ${typeName}: ${issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
    this.name = 'ProjectionError';
    this.issues = issues;
  }
}

/**
 * Validates `data` with the publish validator (throws `ProjectionError` on failure), then
 * projects every field: references resolved, unknown keys dropped. Absent fields project as null.
 */
export function projectEntry(type: ContentType, data: unknown, ctx: ProjectionContext): Record<string, unknown> {
  const parsed = type.publishValidator().safeParse(data);
  if (!parsed.success) throw new ProjectionError(type.name, parsed.error.issues);
  const stored = parsed.data as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries<AnyFieldKind>(type.fields)) out[key] = field.project(stored[key], ctx);
  return out;
}
