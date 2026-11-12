import { slugify } from '@litljomi/cms-schema/src/slugify.ts';
import { supabasePublicEnv } from '@/lib/supabase/env';
import type { SupabaseClient } from '@/lib/supabase/types';

// Image upload rules shared by the browser (checked before upload) and the server (checked again on
// the real object, editor/server/image-metadata.ts). Accepted: JPEG, PNG, WebP; at most 20 MB
// (spec §5.6). The `media-private` bucket enforces the same limits, and the asset row's constraints
// are the database's own check. (A deep import of slugify: the schema package's barrel loads
// node:crypto, which a browser cannot.)

export const MEDIA_PRIVATE_BUCKET = 'media-private';
export const MAX_UPLOAD_BYTES = 20_971_520;
/** Editor previews (thumbnails, and an original only where a file has none) are signed for 10 minutes (spec §5.6). */
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

/** The request `uploadWithProgress` sends: the part of `XMLHttpRequest` it uses. */
export type UploadRequest = Pick<XMLHttpRequest, 'open' | 'setRequestHeader' | 'send' | 'status' | 'responseText' | 'upload' | 'onload' | 'onerror' | 'onabort' | 'ontimeout'>;

/** The only paths `uploadWithProgress` sends to: an original's, as `prepareUpload` makes it. */
const UPLOAD_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-z0-9]+(?:-[a-z0-9]+)*\.(?:jpg|png|webp)$/;

/** Storage's refusal of the token itself (expired, malformed), as against a refusal by its policies. */
const TOKEN_REFUSED = /jwt|token|\bexp\b/i;

/**
 * Uploads an original as `uploadOriginal` does, with the editor's own session, and reports how much
 * has been sent (docs/plans/media-library.md section 6.2): Storage's client reports no progress, so
 * this is the same request, `POST /storage/v1/object/media-private/{path}` without upsert, sent with
 * `XMLHttpRequest`. It carries the editor's access token from the browser client's session (which
 * refreshes an expired one first), only to the project's own Storage URL (`connect-src` allows no
 * other), and only for a path of the upload form; Storage RLS decides as for any upload. 'auth' when
 * there is no session or Storage refuses the token, so the queue can stop; 'error' for anything
 * else, a policy refusal included.
 */
export async function uploadWithProgress(
  client: SupabaseClient,
  path: string,
  file: File,
  onProgress: (fraction: number) => void,
  env: { url: string; publishableKey: string } = supabasePublicEnv(),
  createRequest: () => UploadRequest = () => new XMLHttpRequest(),
): Promise<'ok' | 'auth' | 'error'> {
  if (!UPLOAD_PATH.test(path)) return 'error';
  const { data, error } = await client.auth.getSession();
  const token = error ? null : data.session?.access_token;
  if (!token) return 'auth';
  return new Promise((resolve) => {
    const request = createRequest();
    request.open('POST', `${env.url.replace(/\/+$/, '')}/storage/v1/object/${MEDIA_PRIVATE_BUCKET}/${path}`);
    request.setRequestHeader('authorization', `Bearer ${token}`);
    request.setRequestHeader('apikey', env.publishableKey);
    request.setRequestHeader('x-upsert', 'false');
    request.setRequestHeader('content-type', file.type);
    request.setRequestHeader('cache-control', 'max-age=3600');
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve('ok');
      else resolve(request.status === 401 || ((request.status === 400 || request.status === 403) && TOKEN_REFUSED.test(request.responseText)) ? 'auth' : 'error');
    };
    request.onerror = request.onabort = request.ontimeout = () => resolve('error');
    request.send(file);
  });
}

/** A short-lived signed URL of an object in `media-private` (§5.6), a thumbnail or an original, or null. */
export async function previewUrl(client: SupabaseClient, path: string): Promise<string | null> {
  const { data, error } = await client.storage.from(MEDIA_PRIVATE_BUCKET).createSignedUrl(path, PREVIEW_SECONDS);
  return error || !data ? null : data.signedUrl;
}
