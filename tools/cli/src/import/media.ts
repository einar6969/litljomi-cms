// What the importer derives from a file, exactly as the CMS derives it, so the worker's re-check of
// every asset at publish (`asset_mismatch`, apps/cms/src/privileged/worker/process-request.ts) agrees.
//
// `safeFilename`, `slugBase` and `slugFits` are copies of the CMS's own (apps/cms/src/editor/upload.ts
// and editor/server/auto-slug.ts); `inspectImage` is the CMS's (editor/server/image-metadata.ts), with
// sharp passed in so that unit tests need no image library. A parity test in apps/cms
// (src/editor/__tests__/import-parity.test.ts) runs both copies on the same input. Import decision 2
// moves all of them into one workspace package in L2; until then the copies must not drift.
import { createHash } from 'node:crypto';
import { slugify } from '@litljomi/cms-schema';

export const MAX_UPLOAD_BYTES = 20_971_520;

export const EXTENSION_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

export type AcceptedMime = keyof typeof EXTENSION_BY_MIME;

export type ImageMetadata = { ok: true; mime: AcceptedMime; bytes: number; width: number; height: number; sha256: string };
export type ImageRejection = { ok: false; reason: 'type' | 'size' };
export type InspectImage = (bytes: Uint8Array) => Promise<ImageMetadata | ImageRejection>;

/** The part of sharp's `metadata()` that `inspectImage` reads. */
export interface ImageHeader {
  format?: string;
  width?: number;
  height?: number;
  autoOrient?: { width?: number; height?: number };
}

const MIME_BY_FORMAT: Record<string, AcceptedMime> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const isPositiveInt = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;

/** `inspectImage` over a header reader (sharp's `metadata()` in main.ts). */
export function imageInspector(readHeader: (bytes: Uint8Array) => Promise<ImageHeader>): InspectImage {
  return async (bytes) => {
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) return { ok: false, reason: 'size' };
    let meta: ImageHeader;
    try {
      meta = await readHeader(bytes);
    } catch {
      return { ok: false, reason: 'type' };
    }
    const mime = meta.format ? MIME_BY_FORMAT[meta.format] : undefined;
    const width = meta.autoOrient?.width ?? meta.width;
    const height = meta.autoOrient?.height ?? meta.height;
    if (!mime || !isPositiveInt(width) || !isPositiveInt(height)) return { ok: false, reason: 'type' };
    return { ok: true, mime, bytes: bytes.byteLength, width, height, sha256: sha256Hex(bytes) };
  };
}

export const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const MAX_STEM_LENGTH = 80;

/** The storage file name of an upload (apps/cms/src/editor/upload.ts `safeFilename`). */
export function safeFilename(name: string, mime: AcceptedMime): string {
  const base = name.split(/[/\\]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  const stem = slugify(dot === -1 ? base : base.slice(0, dot))
    .slice(0, MAX_STEM_LENGTH)
    .replace(/-+$/, '');
  return `${stem === '' ? 'mynd' : stem}.${EXTENSION_BY_MIME[mime]}`;
}

// Room for "-999" in the database's 200 characters (auto-slug.ts).
const MAX_BASE_LENGTH = 190;

/** The title as a slug, as the editor makes it (apps/cms/src/editor/server/auto-slug.ts `slugBase`). */
export function slugBase(title: string | null): string {
  return slugify(title ?? '')
    .slice(0, MAX_BASE_LENGTH)
    .replace(/-+$/, '');
}

/** True when `slug` is the base, or the base with a number (auto-slug.ts `slugFits`). */
export function slugFits(slug: string | null, base: string): boolean {
  if (slug === null) return false;
  return slug === base || (slug.startsWith(`${base}-`) && /^\d+$/.test(slug.slice(base.length + 1)));
}

// ---------------------------------------------------------------------------------------------
// Derived asset ids (import plan section 2.3): UUID v5 of `tenant id + "/" + sha256`, so a re-run
// finds a file it registered before with no memory of its own.

const URL_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

/** RFC 9562 UUID version 5 (SHA-1, name-based). */
export function uuidV5(namespace: string, name: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(ns).update(name, 'utf8').digest();
  const b = hash.subarray(0, 16);
  b[6] = ((b[6] as number) & 0x0f) | 0x50;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The importer's own namespace, derived from its manifest's URN. */
export const IMPORT_NAMESPACE = uuidV5(URL_NAMESPACE, 'urn:litljomi:cms-import:1');

/** The id of a file in a tenant's library: the same bytes always get the same id in that tenant. */
export const assetIdFor = (tenantId: string, sha256: string): string => uuidV5(IMPORT_NAMESPACE, `${tenantId}/${sha256}`);
