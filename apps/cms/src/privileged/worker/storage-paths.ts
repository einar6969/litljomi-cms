// Storage paths of the worker (spec §4.1 rule 6, §5.6, §7.2). Every path starts with its tenant
// (the slug in the public buckets, the id in media-private), and every segment is validated here,
// so a path is never built from a value that could add or climb a folder.
//
// Filenames come from api.register_asset, which refuses '', '.', '..' and '/' only; this module
// also refuses backslashes and control characters (Task 8 security r1 Minor 2, Task 10 security r1
// Minor 3), so the worker never copies to or from such a name.

/** The private bucket holding asset originals; shared by the build and the request check. */
export const MEDIA_PRIVATE = 'media-private';

/**
 * §7.2: how long a CDN may serve the pointer; shared by the build (its cache header) and the live
 * check, whose resend waits it out (§7.4, decision 48).
 */
export const POINTER_MAX_AGE_S = 30;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/; // decision 2
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/; // canonical text form
// Control characters (C0 and DEL).
const CONTROL = /[\u0000-\u001f\u007f]/;

function slug(s: string): string {
  if (!SLUG.test(s)) throw new Error(`storage path: invalid tenant slug ${JSON.stringify(s)}`);
  return s;
}

function uuid(s: string, what: 'tenant id' | 'asset id'): string {
  if (!UUID.test(s)) throw new Error(`storage path: invalid ${what} ${JSON.stringify(s)}`);
  return s;
}

function releaseNumber(n: number): number {
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`storage path: invalid release number ${String(n)}`);
  return n;
}

function filename(s: string): string {
  if (s === '' || s === '.' || s === '..' || s.includes('/') || s.includes('\\') || CONTROL.test(s)) {
    throw new Error(`storage path: invalid filename ${JSON.stringify(s)}`);
  }
  return s;
}

/** The bundle as the pointer names it, relative to the tenant's folder (§7.2): `releases/{N}.json`. */
export function pointerBundlePath(n: number): string {
  return `releases/${releaseNumber(n)}.json`;
}

/** A release bundle in the `delivery` bucket: `{tenant_slug}/releases/{N}.json` (§5.6). */
export function deliveryBundlePath(tenantSlug: string, n: number): string {
  return `${slug(tenantSlug)}/${pointerBundlePath(n)}`;
}

/** The tenant's pointer in the `delivery` bucket: `{tenant_slug}/current.json` (§5.6). */
export function deliveryPointerPath(tenantSlug: string): string {
  return `${slug(tenantSlug)}/current.json`;
}

/** A published asset in `media-public`: `{tenant_slug}/{asset_id}/{filename}` (§5.6). */
export function publicMediaPath(tenantSlug: string, assetId: string, name: string): string {
  return `${slug(tenantSlug)}/${uuid(assetId, 'asset id')}/${filename(name)}`;
}

/** An original in `media-private`: `{tenant_id}/{asset_id}/{filename}` (§5.6). */
export function privateMediaPath(tenantId: string, assetId: string, name: string): string {
  return `${uuid(tenantId, 'tenant id')}/${uuid(assetId, 'asset id')}/${filename(name)}`;
}
