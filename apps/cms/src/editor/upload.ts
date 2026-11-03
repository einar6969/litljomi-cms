import { slugify } from '@litljomi/cms-schema/src/slugify.ts';
import type { SupabaseClient } from '@/lib/supabase/types';

// Image upload rules shared by the browser (checked before upload) and the server (checked again on
// the real object, editor/server/image-metadata.ts). Accepted: JPEG, PNG, WebP; at most 20 MB
// (spec §5.6). The `media-private` bucket enforces the same limits, and the asset row's constraints
// are the database's own check. (A deep import of slugify: the schema package's barrel loads
// node:crypto, which a browser cannot.)

export const MEDIA_PRIVATE_BUCKET = 'media-private';
export const MAX_UPLOAD_BYTES = 20_971_520;
/** Editor previews of originals are signed for 10 minutes (spec §5.6). */
export const PREVIEW_SECONDS = 600;

export const EXTENSION_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

export type AcceptedMime = keyof typeof EXTENSION_BY_MIME;

export const isAcceptedMime = (mime: unknown): mime is AcceptedMime => typeof mime === 'string' && Object.hasOwn(EXTENSION_BY_MIME, mime);

/** What safeFilename produces: one lowercase ASCII segment and the extension of an accepted type. */
export const SAFE_FILENAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\.(?:jpg|png|webp)$/;

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_STEM_LENGTH = 80;

/**
 * The storage file name of an upload: the original name's last path segment without its
 * extension, transliterated like slugs (decision 2), at most 80 characters, then the extension of
 * its type. Never empty, never `.` or `..`, never a path.
 */
export function safeFilename(name: string, mime: AcceptedMime): string {
  const base = name.split(/[/\\]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  const stem = slugify(dot === -1 ? base : base.slice(0, dot))
    .slice(0, MAX_STEM_LENGTH)
    .replace(/-+$/, '');
  return `${stem === '' ? 'mynd' : stem}.${EXTENSION_BY_MIME[mime]}`;
}

export type PreparedUpload = { ok: true; assetId: string; filename: string; path: string } | { ok: false; reason: 'type' | 'size' };

/**
 * Checks a chosen file before it is uploaded (unsupported or oversized images are refused before
 * upload) and names it: a fresh asset id (`crypto.randomUUID()`, spec §4.3), its storage file name
 * (`safeFilename`) and the path `${tenantId}/${assetId}/${filename}` in `media-private` (§5.6). The
 * type is the browser's (from the file name); the server checks the real bytes after upload.
 * `tenantId` is the tenant the page resolved through `api.my_tenants`.
 */
export function prepareUpload(file: File, tenantId: string): PreparedUpload {
  if (!CANONICAL_UUID.test(tenantId)) throw new Error('prepareUpload: tenant id is not a canonical UUID');
  if (!isAcceptedMime(file.type)) return { ok: false, reason: 'type' };
  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) return { ok: false, reason: 'size' };
  const assetId = crypto.randomUUID();
  const filename = safeFilename(file.name, file.type);
  return { ok: true, assetId, filename, path: `${tenantId}/${assetId}/${filename}` };
}

/**
 * Uploads the original from the browser with the editor's own session; Storage RLS allows it only
 * under a tenant the editor is a member of. Never overwrites (editors have no update policy).
 */
export async function uploadOriginal(client: SupabaseClient, path: string, file: File): Promise<boolean> {
  const { error } = await client.storage.from(MEDIA_PRIVATE_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  return !error;
}

/** A short-lived signed URL of an original in `media-private` (§5.6), or null. */
export async function previewUrl(client: SupabaseClient, path: string): Promise<string | null> {
  const { data, error } = await client.storage.from(MEDIA_PRIVATE_BUCKET).createSignedUrl(path, PREVIEW_SECONDS);
  return error || !data ? null : data.signedUrl;
}
