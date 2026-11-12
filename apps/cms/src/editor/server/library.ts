import 'server-only';
import type { SupabaseClient } from '@/lib/supabase/types';
import { MEDIA_PRIVATE_BUCKET, PREVIEW_SECONDS, previewUrl } from '../upload';
import type { AssetFile, AssetUse } from '../media/AssetDetail';
import { applyLibraryFilter, LIBRARY_PAGE_SIZE, libraryRange, orderLibrary, type LibraryState } from '../media/library-filter';
import { formatUploadDate } from '../media/library-format';

// The media library's reads (docs/plans/media-library.md sections 4 and 6.1, slice L4), with the
// editor's own session: api.asset_summary, api.asset_list and api.asset_usage are security_invoker
// or check the membership, so RLS decides what any of them returns, and every query also names the
// tenant of the URL. Thumbnails are signed in one call per page. A database error is thrown with
// its code only, never read as "nothing", and the page answers with the app's error page.

export type LibrarySummary = { files: number; bytes: number; unused: number };

/** The tenant's head line (`api.asset_summary`): its files, their total size and how many are unused. */
export async function loadLibrarySummary(client: SupabaseClient, tenantId: string): Promise<LibrarySummary> {
  const { data, error } = await client.rpc('asset_summary', { p_tenant_id: tenantId });
  if (error) throw new Error(`asset_summary: ${error.code}`);
  const summary = data as { files?: number; bytes?: number; unused?: number } | null;
  return { files: Number(summary?.files ?? 0), bytes: Number(summary?.bytes ?? 0), unused: Number(summary?.unused ?? 0) };
}

export type ListedFile = {
  id: string;
  filename: string;
  mime: string;
  kind: 'image' | 'document';
  width: number | null;
  height: number | null;
  bytes: number;
  created_at: string;
  default_alt: string | null;
  thumb_path: string | null;
};

const LIST_COLUMNS = 'id, filename, mime, kind, width, height, bytes, created_at, default_alt, thumb_path';

/**
 * The files the state lists, every page up to its own (`libraryRange`), and whether there are more.
 * `thumbUrls` holds a signed URL for each listed thumbnail that could be signed; a file without one
 * asks for it from the browser.
 */
export async function loadLibraryFiles(
  client: SupabaseClient,
  tenantId: string,
  state: LibraryState,
): Promise<{ files: ListedFile[]; hasMore: boolean; thumbUrls: Map<string, string> }> {
  const { from, to } = libraryRange(state.page);
  const query = applyLibraryFilter(client.from('asset_list').select(LIST_COLUMNS).eq('tenant_id', tenantId), state);
  const { data, error } = await orderLibrary(query, state.sort).range(from, to);
  if (error) throw new Error(`asset_list: ${error.code}`);
  const rows = (data ?? []) as ListedFile[];
  const files = rows.slice(0, state.page * LIBRARY_PAGE_SIZE);
  return { files, hasMore: rows.length > files.length, thumbUrls: await signThumbnails(client, files) };
}

/** One call signs every listed thumbnail, valid 600 seconds like every editor preview (§5.6). */
async function signThumbnails(client: SupabaseClient, files: readonly ListedFile[]): Promise<Map<string, string>> {
  const paths = files.flatMap((f) => (f.thumb_path === null ? [] : [f.thumb_path]));
  const urls = new Map<string, string>();
  if (paths.length === 0) return urls;
  const { data, error } = await client.storage.from(MEDIA_PRIVATE_BUCKET).createSignedUrls(paths, PREVIEW_SECONDS);
  // A thumbnail that cannot be signed is asked for again from the browser, which signs or remakes it.
  if (error || !data) return urls;
  for (const signed of data) if (signed.path && signed.signedUrl && !signed.error) urls.set(signed.path, signed.signedUrl);
  return urls;
}

/** The asset_usage queries name at most this many files each, so the URL stays short. */
const USAGE_CHUNK = 60;

/** How many entries use each of the files (`api.asset_usage`), for the list view's column. */
export async function loadUsageCounts(client: SupabaseClient, tenantId: string, ids: readonly string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>(ids.map((id) => [id, 0]));
  const chunks = [];
  for (let i = 0; i < ids.length; i += USAGE_CHUNK) chunks.push(ids.slice(i, i + USAGE_CHUNK));
  const answers = await Promise.all(chunks.map((chunk) => client.from('asset_usage').select('asset_id').eq('tenant_id', tenantId).in('asset_id', chunk)));
  for (const { data, error } of answers) {
    if (error) throw new Error(`asset_usage: ${error.code}`);
    for (const row of (data ?? []) as { asset_id: string }[]) counts.set(row.asset_id, (counts.get(row.asset_id) ?? 0) + 1);
  }
  return counts;
}

export type UsageRow = { entry_id: string; type: string; title: string | null; in_draft: boolean; in_published: boolean };

/** A usage row as the panel shows it: a link to the entry, its type's label, and whether the site shows it. */
export const assetUse = (row: UsageRow, tenantPath: string, typeLabel: (type: string) => string | undefined): AssetUse => ({
  entryId: row.entry_id,
  href: `${tenantPath}/${encodeURIComponent(row.type)}/${row.entry_id}`,
  title: row.title,
  typeLabel: typeLabel(row.type) ?? row.type,
  live: row.in_published,
});

type FileRow = ListedFile & { focal_x: number | null; focal_y: number | null; caption: string | null; credit: string | null; width: number; height: number };

/**
 * One file's details for the panel, if it is in the tenant and not taken out of the library:
 * the file, a signed URL of its thumbnail (null when it has none or it cannot be signed: the panel
 * then asks for its preview), and the entries that use it, by title.
 */
export async function loadLibraryFile(
  client: SupabaseClient,
  tenantId: string,
  id: string,
): Promise<{ file: AssetFile; url: string | null; usage: UsageRow[] } | null> {
  const [file, usage] = await Promise.all([
    client
      .from('asset_list')
      .select(`${LIST_COLUMNS}, focal_x, focal_y, caption, credit`)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .is('archived_at', null)
      .maybeSingle(),
    client.from('asset_usage').select('entry_id, type, title, in_draft, in_published').eq('asset_id', id).eq('tenant_id', tenantId).order('title').order('entry_id'),
  ]);
  if (file.error) throw new Error(`asset_list: ${file.error.code}`);
  if (usage.error) throw new Error(`asset_usage: ${usage.error.code}`);
  if (!file.data) return null;
  const row = file.data as FileRow;
  const url = row.thumb_path === null ? null : await previewUrl(client, row.thumb_path);
  return {
    file: {
      id: row.id,
      filename: row.filename,
      mime: row.mime,
      width: row.width,
      height: row.height,
      bytes: row.bytes,
      createdAt: row.created_at,
      uploaded: formatUploadDate(row.created_at),
      focal: row.focal_x !== null && row.focal_y !== null ? { x: row.focal_x, y: row.focal_y } : null,
      defaultAlt: row.default_alt,
      caption: row.caption,
      credit: row.credit,
    },
    url,
    usage: (usage.data ?? []) as UsageRow[],
  };
}
