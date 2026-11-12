// A test module and manifest for the import tests: no real tenant. `acme` has projects, news (with a
// video field of a kind the importer does not know) and a singleton home page.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { defineModule, defineType, group, image, link, list, reference, richText, text, date, type FieldKind, type SiteEntry } from '@litljomi/cms-schema';
import type { InspectImage } from '../import/media.ts';
import type { MediaFs } from '../import/plan.ts';

/** A field kind the importer has no special case for, with an image inside (as A11's video kind). */
export function video(o: { label: string; required?: boolean }): FieldKind<unknown, unknown> {
  const base = z.strictObject({ url: z.string(), still: z.strictObject({ _ref: z.string(), _kind: z.literal('asset'), alt: z.string() }).optional() });
  const required = o.required ?? false;
  return {
    kind: 'video',
    label: o.label,
    required,
    draftSchema: () => base.nullish(),
    publishSchema: () => (required ? base : base.nullish()) as z.ZodType<unknown>,
    project: (v) => (v == null ? null : { url: (v as { url: string }).url }),
    tsType: () => 'unknown',
    withOptions: (x) => video({ ...o, ...x }),
  };
}

export const projectType = defineType({
  name: 'project',
  version: 1,
  label: 'Project',
  fields: {
    title: text({ label: 'Title', required: true }),
    cover: image({ label: 'Cover' }),
    body: richText({ label: 'Body' }),
    related: reference({ label: 'Related', to: ['project'] }),
    gallery: list(image({ label: 'Image' }), { label: 'Gallery' }),
    meta: group({ label: 'Meta', fields: { client: text({ label: 'Client' }), partner: reference({ label: 'Partner', to: ['project'] }) } }),
  },
  preview: { title: 'title' },
  orderBy: 'title',
});

export const newsType = defineType({
  name: 'news',
  version: 1,
  label: 'News',
  fields: {
    title: text({ label: 'Title', required: true }),
    date: date({ label: 'Date' }),
    image: image({ label: 'Image' }),
    project: reference({ label: 'Project', to: ['project'] }),
    more: link({ label: 'More' }),
    body: richText({ label: 'Body' }),
    video: video({ label: 'Video' }),
  },
  preview: { title: 'title' },
  orderBy: 'date',
});

/** A type whose reference is required, for cycles that cannot be broken. */
export const pairType = defineType({
  name: 'pair',
  version: 1,
  label: 'Pair',
  fields: { title: text({ label: 'Title', required: true }), other: reference({ label: 'Other', to: ['pair'], required: true }) },
  preview: { title: 'title' },
  orderBy: 'title',
});

export const homeType = defineType({
  name: 'home',
  version: 1,
  label: 'Home',
  fields: { title: text({ label: 'Title' }), featured: list(reference({ label: 'Project', to: ['project'] }), { label: 'Featured' }) },
  preview: { title: 'title' },
  orderBy: 'title',
});

const path = (prefix: string) => (e: SiteEntry) => {
  if (e.slug === null) throw new Error('no slug');
  return `${prefix}/${e.slug}`;
};

export const testModule = defineModule({
  tenant: 'acme',
  locale: 'is',
  branding: { name: 'Acme' },
  types: [projectType, newsType, pairType, homeType],
  structure: [
    { type: 'project', label: 'Projects' },
    { type: 'news', label: 'News' },
    { type: 'pair', label: 'Pairs' },
    { type: 'home', label: 'Home', singleton: true },
  ],
  site: {
    project: { path: path('/projects'), checks: () => [] },
    news: { path: path('/news'), checks: () => [] },
  },
});

// Fake images: a three-letter signature the fake inspector reads, then filler.
export const fakeImage = (sig: 'JPG' | 'PNG' | 'GIF', seed: string, size = 64): Uint8Array => {
  const out = new Uint8Array(size);
  out.set(new TextEncoder().encode(sig));
  const fill = createHash('sha256').update(seed).digest();
  for (let i = 3; i < size; i++) out[i] = fill[i % fill.length] as number;
  return out;
};

export const fakeInspect: InspectImage = async (bytes) => {
  const sig = new TextDecoder().decode(bytes.slice(0, 3));
  if (bytes.byteLength === 0 || bytes.byteLength > 20_971_520) return { ok: false, reason: 'size' };
  const mime = sig === 'JPG' ? 'image/jpeg' : sig === 'PNG' ? 'image/png' : null;
  if (mime === null) return { ok: false, reason: 'type' };
  return { ok: true, mime, bytes: bytes.byteLength, width: 400, height: 300, sha256: createHash('sha256').update(bytes).digest('hex') };
};

export const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

export const MEDIA = '/media';

/** An in-memory media folder: files by path below MEDIA, symlinks by path. */
export class FakeMedia implements MediaFs {
  readonly files = new Map<string, Uint8Array>();
  readonly symlinks = new Set<string>();
  reads = 0;

  put(path: string, bytes: Uint8Array): this {
    this.files.set(`${MEDIA}/${path}`, bytes);
    return this;
  }

  async lstat(p: string) {
    if (this.symlinks.has(p)) return { kind: 'symlink' as const, size: 0 };
    const file = this.files.get(p);
    if (file !== undefined) return { kind: 'file' as const, size: file.byteLength };
    if (p === MEDIA || [...this.files.keys()].some((k) => k.startsWith(`${p}/`))) return { kind: 'directory' as const, size: 0 };
    return null;
  }

  async readBytes(p: string) {
    this.reads += 1;
    if (this.symlinks.has(p)) throw new Error('ELOOP');
    const file = this.files.get(p);
    if (file === undefined) throw new Error('ENOENT');
    return file;
  }
}

export const harbour = fakeImage('JPG', 'harbour');
export const opening = fakeImage('PNG', 'opening', 80);
export const detail = fakeImage('JPG', 'detail', 72);

export const doc = (...content: unknown[]) => ({ type: 'doc', content });
export const para = (...content: unknown[]) => ({ type: 'paragraph', content });
export const txt = (t: string, marks?: unknown[]) => (marks === undefined ? { type: 'text', text: t } : { type: 'text', text: t, marks });

/** The plan's example manifest (import.md section 1), with the test module's fields. */
export function exampleManifest(): Record<string, unknown> {
  return {
    format: 1,
    files: [
      { path: 'projects/harbour/01.jpg', sha256: sha(harbour), bytes: harbour.byteLength, alt: 'The harbour path at dusk', caption: 'The new path', credit: 'Photo: A. Person' },
      { path: 'news/opening.png', sha256: sha(opening), bytes: opening.byteLength, alt: '' },
      { path: 'projects/harbour/02.jpg', sha256: sha(detail), bytes: detail.byteLength, alt: 'A detail' },
    ],
    entries: {
      project: [
        {
          key: 'project/harbour',
          slug: 'harbour-path',
          data: {
            title: 'Harbour path',
            cover: { $file: 'projects/harbour/01.jpg' },
            body: doc(para(txt('A path along the harbour.')), { type: 'image', attrs: { asset: { $file: 'projects/harbour/02.jpg' } } }),
            gallery: [{ value: { $file: 'projects/harbour/02.jpg', alt: 'Close up' } }],
            meta: { client: 'The town' },
          },
        },
      ],
      news: [
        {
          key: 'news/opening',
          data: {
            title: 'The path opens',
            date: '2019-06-01',
            image: { $file: 'news/opening.png', alt: 'Opening day' },
            project: { $entry: 'project/harbour' },
            body: doc(para(txt('Read about '), txt('the project', [{ type: 'link', attrs: { entry: { $entry: 'project/harbour' } } }]))),
          },
        },
      ],
    },
    singletons: { home: { key: 'home', data: { featured: [{ _key: 'a', value: { $entry: 'project/harbour' } }] } } },
    order: { project: ['project/harbour'] },
  };
}

export function exampleMedia(): FakeMedia {
  return new FakeMedia().put('projects/harbour/01.jpg', harbour).put('news/opening.png', opening).put('projects/harbour/02.jpg', detail);
}
