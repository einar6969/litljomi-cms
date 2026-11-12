import { z } from 'zod';
import { canonicalHttpsUrl } from '@litljomi/rich-text';
import { definedOnly, draftOf, publishOf, type FieldKind } from '../field-kind.ts';
import { FieldProjectionError, type PublicAsset } from '../projection.ts';
import { image, imageValueSchema, type ImageValue } from './image.ts';

/** Whether a video field's still image must be set before publishing. */
export type StillOption = 'required' | 'optional';

export interface VideoOptions {
  label: string;
  required?: boolean;
  /** Default `'optional'`. */
  still?: StillOption;
}

export type VideoProvider = 'youtube' | 'vimeo';

/**
 * The stored value (spec §5.2): the address as the editor gave it (its canonical form), a title, and
 * a still image stored exactly as an `image` field stores its value. The provider and the video's
 * id are not stored: they are derived from `url` (`parseVideoUrl`), so better parsing later needs no
 * change to stored data.
 */
export type VideoValue = { url: string; title: string; still: ImageValue | null };

/** The delivered value: the provider and id derived from the address, and the still as an `image` field delivers it. */
export interface PublicVideo {
  provider: VideoProvider;
  id: string;
  url: string;
  title: string;
  still: PublicAsset | null;
}

export type VideoField = FieldKind<VideoValue, PublicVideo> & { still: StillOption };

/** The longest title, in characters as zod counts them (UTF-16 code units, as `text`'s `max`). */
export const MAX_VIDEO_TITLE_LENGTH = 200;

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^[0-9]{1,20}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com']);
/** `/embed/<id>`, `/shorts/<id>` and `/live/<id>`, with or without a trailing slash. */
const YOUTUBE_PATH = /^\/(?:embed|shorts|live)\/([^/]+)\/?$/;
/** One path segment, with or without a trailing slash. */
const ONE_SEGMENT = /^\/([^/]+)\/?$/;
const PLAYER_PATH = /^\/video\/([^/]+)\/?$/;

/**
 * The provider and id of a video address, or null when it is not one this kind knows. The address
 * must be an absolute `https:` URL without credentials, whitespace or a port (`canonicalHttpsUrl`).
 * YouTube: `youtube.com` with or without `www.` or `m.`, at `/watch?v=<id>`, `/embed/<id>`,
 * `/shorts/<id>` or `/live/<id>`, or `youtu.be/<id>`; the id is 11 letters, digits, `_` or `-`.
 * Vimeo: `vimeo.com/<digits>` (or `www.vimeo.com`) and `player.vimeo.com/video/<digits>`. Other
 * query parameters and the fragment are ignored.
 */
export function parseVideoUrl(url: string): { provider: VideoProvider; id: string } | null {
  const href = canonicalHttpsUrl(url);
  if (href === null) return null;
  const u = new URL(href);
  if (u.port !== '') return null;
  const host = u.hostname;
  const youtube = (id: string | null | undefined) => (id != null && YOUTUBE_ID.test(id) ? { provider: 'youtube' as const, id } : null);
  const vimeo = (id: string | null | undefined) => (id != null && VIMEO_ID.test(id) ? { provider: 'vimeo' as const, id } : null);
  if (YOUTUBE_HOSTS.has(host)) {
    if (u.pathname === '/watch') return youtube(u.searchParams.get('v'));
    return youtube(YOUTUBE_PATH.exec(u.pathname)?.[1]);
  }
  if (host === 'youtu.be') return youtube(ONE_SEGMENT.exec(u.pathname)?.[1]);
  if (VIMEO_HOSTS.has(host)) return vimeo(ONE_SEGMENT.exec(u.pathname)?.[1]);
  if (host === 'player.vimeo.com') return vimeo(PLAYER_PATH.exec(u.pathname)?.[1]);
  return null;
}

const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/**
 * A pasted address as the editor stores it: trimmed; `https://` added when there is no scheme (or
 * `https:` before a `//` address); `http:` raised to `https:`; then the canonical form when it is
 * an https address. Anything else is returned trimmed, as typed, so the editor can see why it is
 * refused; the publish rule decides.
 */
export function normaliseVideoUrl(input: string): string {
  let s = input.trim();
  if (s.startsWith('//')) s = `https:${s}`;
  else if (s !== '' && !SCHEME.test(s)) s = `https://${s}`;
  else if (/^http:/i.test(s)) s = `https:${s.slice(5)}`;
  return canonicalHttpsUrl(s) ?? input.trim();
}

function assertStill(v: unknown): asserts v is StillOption {
  if (v !== 'required' && v !== 'optional') throw new Error(`video: still must be "required" or "optional" (got ${JSON.stringify(v)})`);
}

/**
 * A link to a video on YouTube or Vimeo, with a title and a still image (spec §5.2; not an upload,
 * §10.2). A draft checks the shape only: the three keys, strings for the address and the title, the
 * still null or an image value. Publishing also requires a known provider's https address with a
 * valid id, a title of 1 to 200 characters, and the still when `still` is `'required'`. The still is
 * an asset reference inside the value, so the database's reference extraction finds it at any depth
 * (`$."<field>"."still"`) and the release build copies it like any other image. Delivered as
 * `PublicVideo`: the provider and id, the canonical address, the title, and the still projected by
 * the `image` kind itself (null when there is none or it cannot resolve).
 */
export function video(o: VideoOptions): VideoField {
  const required = o.required ?? false;
  const stillOption = o.still ?? 'optional';
  assertStill(stillOption);
  const draftBase = z.strictObject({
    url: z.string(),
    title: z.string(),
    still: imageValueSchema.nullable(),
  }) as unknown as z.ZodType<VideoValue>;
  const publishBase = z.strictObject({
    url: z.string().refine((s) => parseVideoUrl(s) !== null, 'url must be an https address of a YouTube or Vimeo video'),
    title: z.string().min(1).max(MAX_VIDEO_TITLE_LENGTH),
    still: stillOption === 'required' ? imageValueSchema : imageValueSchema.nullable(),
  }) as unknown as z.ZodType<VideoValue>;
  // The still is projected by the image kind, so it is delivered exactly as an image field's value.
  const stillKind = image({ label: o.label });
  return {
    kind: 'video',
    label: o.label,
    required,
    still: stillOption,
    draftSchema: () => draftOf(draftBase),
    publishSchema: () => publishOf(publishBase, required),
    project: (v, ctx) => {
      if (v == null) return null;
      const parsed = parseVideoUrl(v.url);
      // Unreachable after the publish validator; kept so a caller that skips it cannot deliver an unknown address.
      if (parsed === null) {
        throw new FieldProjectionError([{ code: 'custom', path: ['url'], message: 'not a known video address', input: v.url }]);
      }
      return { provider: parsed.provider, id: parsed.id, url: canonicalHttpsUrl(v.url)!, title: v.title, still: stillKind.project(v.still, ctx) };
    },
    tsType: () => 'PublicVideo | null',
    withOptions: (x) => video({ ...o, ...definedOnly(x) }),
  };
}
