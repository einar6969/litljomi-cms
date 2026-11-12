// The projection context the worker builds from the database (spec §6.2, §7.1; decision 35): the
// pre-commit projection (Task 19) and the release build (Task 20) resolve references the same way.
import type { ModuleManifest, ProjectionContext } from '@litljomi/cms-schema';
import { loopbackHttpOrigin } from '@litljomi/rich-text';

/** A published, not archived entry that references may resolve to. */
export interface ContextEntry {
  id: string;
  type: string;
  slug: string | null;
  title: string | null;
  sortAt: string | null;
}

/** An asset row as the worker functions return it (snake_case columns). */
export interface ContextAsset {
  id: string;
  filename: string;
  mime: string;
  width: number;
  height: number;
  focal_x: number | null;
  focal_y: number | null;
  default_alt: string | null;
  public_path: string | null;
}

/**
 * Lookups over the given entries and assets. An entry that is not in `entries` (not published,
 * archived or unknown) resolves to null (spec §6.2). An entry's path comes from the module's site
 * integration for its type; it is null when the type has no site pages or the integration cannot
 * compute one (for example, no slug). An asset resolves only once it has a public path; its URL is
 * `mediaUrl(public_path)`, and `resolveAsset` in the schema package keeps it only if it is https,
 * or http on exactly `localMediaOrigin`: `localStackOrigin` of the worker's own Supabase URL, which
 * is null on a hosted project (enhancement A4).
 */
export function buildProjectionContext(o: {
  module: ModuleManifest;
  entries: ContextEntry[];
  assets: ContextAsset[];
  mediaUrl: (publicPath: string) => string;
  localMediaOrigin: string | null;
}): ProjectionContext {
  const entries = new Map(o.entries.map((e) => [e.id, e]));
  const assets = new Map(o.assets.map((a) => [a.id, a]));
  const pathOf = (e: ContextEntry): string | null => {
    const integration = o.module.site[e.type];
    if (!integration) return null;
    try {
      return integration.path({ id: e.id, type: e.type, slug: e.slug, sortAt: e.sortAt });
    } catch {
      return null;
    }
  };
  return {
    localMediaOrigin: o.localMediaOrigin,
    entry(id) {
      const e = entries.get(id);
      return e ? { id: e.id, type: e.type, slug: e.slug, title: e.title, path: pathOf(e) } : null;
    },
    asset(id) {
      const a = assets.get(id);
      if (!a || a.public_path === null) return null;
      return {
        id: a.id,
        url: o.mediaUrl(a.public_path),
        width: a.width,
        height: a.height,
        mime: a.mime,
        alt: a.default_alt ?? '',
        focal: a.focal_x !== null && a.focal_y !== null ? { x: a.focal_x, y: a.focal_y } : null,
      };
    },
  };
}

/** One reference of `api.worker_read_request` (decision 34.2), with its target's metadata. */
export type ReadRef =
  | { path: string; kind: 'entry'; id: string; published: boolean; archived: boolean; type: string | null; slug: string | null; title: string | null }
  | ({ path: string; kind: 'asset'; id: string; published: boolean; archived: boolean } & Omit<ContextAsset, 'id'>);

/**
 * The context for the pre-commit projection, from `worker_read_request`'s references: published,
 * not archived entries (the read gives the published revision's title; it has no sort date, which
 * no M1 path needs), and not archived assets.
 */
export function contextFromRead(
  refs: ReadRef[],
  module: ModuleManifest,
  mediaUrl: (publicPath: string) => string,
  localMediaOrigin: string | null,
): ProjectionContext {
  const entries: ContextEntry[] = [];
  const assets: ContextAsset[] = [];
  for (const r of refs) {
    if (r.archived) continue;
    if (r.kind === 'entry') {
      if (r.published && r.type !== null) entries.push({ id: r.id, type: r.type, slug: r.slug, title: r.title, sortAt: null });
    } else {
      assets.push({
        id: r.id,
        filename: r.filename,
        mime: r.mime,
        width: r.width,
        height: r.height,
        focal_x: r.focal_x,
        focal_y: r.focal_y,
        default_alt: r.default_alt,
        public_path: r.public_path,
      });
    }
  }
  return buildProjectionContext({ module, entries, assets, mediaUrl, localMediaOrigin });
}

/** The public URL of a `media-public` object (spec §5.6): `{supabaseUrl}/storage/v1/object/public/media-public/{path}`. */
export function publicMediaUrl(supabaseUrl: string, publicPath: string): string {
  const base = supabaseUrl.replace(/\/+$/, '');
  return `${base}/storage/v1/object/public/media-public/${publicPath.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * The origin of a local stack, from the Supabase URL the worker itself uses: its origin when that
 * URL is http on a loopback host, and null otherwise, so null on every hosted project (whose URL is
 * `https://<ref>.supabase.co`). Only then are a release's or a preview's media delivered over http
 * (enhancement A4). It is read from the stack's own address, never from a setting: pointing it at a
 * loopback address means talking to a local stack, not to a hosted one.
 */
export function localStackOrigin(supabaseUrl: string): string | null {
  return loopbackHttpOrigin(supabaseUrl);
}
