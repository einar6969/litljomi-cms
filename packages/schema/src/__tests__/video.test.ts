// A11: the `video` field kind (spec §5.2, §10.2): a link to a video on YouTube or Vimeo, a title and
// a still image. Stored as `{ url, title, still }`; the provider and id are derived from the URL,
// never stored, and delivered beside it.
import { describe, expect, it } from 'vitest';
import { fakeCtx } from './helpers.ts';
import {
  ProjectionError,
  compareSchema,
  defineModule,
  defineType,
  extendType,
  generateDeliveryTypes,
  group,
  image,
  list,
  moduleSnapshot,
  normaliseVideoUrl,
  parseVideoUrl,
  projectEntry,
  text,
  video,
  type AnyFieldKind,
  type PublicAsset,
} from '../index.ts';

const A = '11111111-1111-4111-8111-111111111111';
const YT = 'dQw4w9WgXcQ';

const asset = (o: Partial<PublicAsset> = {}): PublicAsset => ({
  id: A,
  url: 'https://cdn.example.is/a.jpg',
  width: 1600,
  height: 900,
  mime: 'image/jpeg',
  alt: 'Sjálfgefið',
  focal: { x: 0.25, y: 0.75 },
  ...o,
});
const still = (alt = 'Kyrrmynd') => ({ _ref: A, _kind: 'asset' as const, alt });
const value = (o: Partial<{ url: string; title: string; still: ReturnType<typeof still> | null }> = {}) => ({
  url: `https://www.youtube.com/watch?v=${YT}`,
  title: 'Myndband',
  still: still(),
  ...o,
});

describe('parseVideoUrl', () => {
  it.each([
    [`https://www.youtube.com/watch?v=${YT}`, 'youtube', YT],
    [`https://youtube.com/watch?v=${YT}`, 'youtube', YT],
    [`https://m.youtube.com/watch?v=${YT}&t=30s`, 'youtube', YT],
    [`https://www.youtube.com/watch?feature=share&v=${YT}`, 'youtube', YT],
    [`https://youtu.be/${YT}`, 'youtube', YT],
    [`https://youtu.be/${YT}?si=abc`, 'youtube', YT],
    [`https://www.youtube.com/embed/${YT}`, 'youtube', YT],
    [`https://www.youtube.com/shorts/${YT}`, 'youtube', YT],
    [`https://m.youtube.com/shorts/${YT}/`, 'youtube', YT],
    [`https://www.youtube.com/live/${YT}?feature=share`, 'youtube', YT],
    ['https://www.youtube.com/watch?v=a-b_c-d_e-F', 'youtube', 'a-b_c-d_e-F'],
    ['https://vimeo.com/76979871', 'vimeo', '76979871'],
    ['https://www.vimeo.com/76979871/', 'vimeo', '76979871'],
    ['https://player.vimeo.com/video/76979871', 'vimeo', '76979871'],
    ['https://player.vimeo.com/video/76979871?autoplay=1#t=10', 'vimeo', '76979871'],
    ['HTTPS://WWW.YOUTUBE.COM/watch?v=' + YT, 'youtube', YT],
  ])('recognises %s', (url, provider, id) => {
    expect(parseVideoUrl(url)).toEqual({ provider, id });
  });

  it.each([
    ['http, not https', `http://www.youtube.com/watch?v=${YT}`],
    ['no scheme', `www.youtube.com/watch?v=${YT}`],
    ['an id of 10 characters', 'https://www.youtube.com/watch?v=dQw4w9WgXc'],
    ['an id of 12 characters', 'https://youtu.be/dQw4w9WgXcQQ'],
    ['an id with another character', 'https://youtu.be/dQw4w9WgX.Q'],
    ['no id', 'https://www.youtube.com/watch'],
    ['another YouTube page', `https://www.youtube.com/channel/${YT}`],
    ['another host', `https://www.youtube.com.evil.example/watch?v=${YT}`],
    ['a look-alike host', `https://youtube.co/watch?v=${YT}`],
    ['credentials', `https://user@www.youtube.com/watch?v=${YT}`],
    ['credentials that point elsewhere', `https://www.youtube.com@evil.example/watch?v=${YT}`],
    ['a port', `https://www.youtube.com:8443/watch?v=${YT}`],
    ['a path after the short id', `https://youtu.be/${YT}/more`],
    ['a Vimeo id with letters', 'https://vimeo.com/7697987a'],
    ['a Vimeo page that is not a video', 'https://vimeo.com/channels/staffpicks'],
    ['a Vimeo path after the id', 'https://vimeo.com/76979871/abcdef1234'],
    ['a player address without /video/', 'https://player.vimeo.com/76979871'],
    ['a video page on the player host', 'https://vimeo.com/video/76979871'],
    ['whitespace around it', ` https://vimeo.com/76979871`],
    ['not a URL', 'myndband'],
    ['empty', ''],
  ])('refuses %s', (_what, url) => {
    expect(parseVideoUrl(url)).toBeNull();
  });
});

describe('normaliseVideoUrl', () => {
  it.each([
    [`youtu.be/${YT}`, `https://youtu.be/${YT}`],
    [`  www.youtube.com/watch?v=${YT}  `, `https://www.youtube.com/watch?v=${YT}`],
    [`//youtu.be/${YT}`, `https://youtu.be/${YT}`],
    [`http://vimeo.com/76979871`, 'https://vimeo.com/76979871'],
    [`HTTP://vimeo.com/76979871`, 'https://vimeo.com/76979871'],
    [`HTTPS://Vimeo.com/76979871`, 'https://vimeo.com/76979871'],
    ['vimeo.com/76979871', 'https://vimeo.com/76979871'],
  ])('turns %j into %j', (input, url) => {
    expect(normaliseVideoUrl(input)).toBe(url);
  });

  it('keeps the address as typed (trimmed) when it does not parse as an https address', () => {
    expect(normaliseVideoUrl(' ftp://vimeo.com/1 ')).toBe('ftp://vimeo.com/1');
    expect(normaliseVideoUrl('')).toBe('');
  });

  it('keeps an unknown https address too, in canonical form, so the editor sees why it is refused', () => {
    expect(normaliseVideoUrl('example.com/x')).toBe('https://example.com/x');
    expect(parseVideoUrl(normaliseVideoUrl('example.com/x'))).toBeNull();
  });
});

describe('video', () => {
  it('has the kind, label and options, the still optional by default', () => {
    expect(video({ label: 'Myndband' })).toMatchObject({ kind: 'video', label: 'Myndband', required: false, still: 'optional' });
    expect(video({ label: 'M', required: true, still: 'required' })).toMatchObject({ required: true, still: 'required' });
  });

  it('refuses a still option it does not know', () => {
    expect(() => video({ label: 'M', still: 'sometimes' as 'optional' })).toThrow(/still must be "required" or "optional"/);
  });

  it('withOptions keeps the still option', () => {
    const f = video({ label: 'M', still: 'required' }).withOptions({ label: 'N', required: true });
    expect(f).toMatchObject({ label: 'N', required: true, still: 'required' });
  });

  describe('draft: shape only', () => {
    const draft = video({ label: 'M', required: true, still: 'required' }).draftSchema();
    it('accepts an empty or absent value, and any strings in an otherwise valid shape', () => {
      expect(draft.safeParse(undefined).success).toBe(true);
      expect(draft.safeParse(null).success).toBe(true);
      expect(draft.safeParse({ url: '', title: '', still: null }).success).toBe(true);
      expect(draft.safeParse({ url: 'youtu.be/half', title: 'x'.repeat(500), still: null }).success).toBe(true);
      expect(draft.safeParse(value()).success).toBe(true);
    });
    it.each([
      ['a missing url', { title: '', still: null }],
      ['a missing title', { url: '', still: null }],
      ['a missing still', { url: '', title: '' }],
      ['a number for the url', { url: 1, title: '', still: null }],
      ['an unknown key', { url: '', title: '', still: null, provider: 'youtube' }],
      ['a still that is not an asset reference', { url: '', title: '', still: { _ref: A, _kind: 'entry', alt: '' } }],
      ['a still with a malformed id', { url: '', title: '', still: { _ref: 'x', _kind: 'asset', alt: '' } }],
      ['a string', 'https://youtu.be/' + YT],
    ])('refuses %s', (_what, v) => {
      expect(draft.safeParse(v).success).toBe(false);
    });
  });

  describe('publish', () => {
    const optional = video({ label: 'M' }).publishSchema();
    const required = video({ label: 'M', required: true }).publishSchema();
    const withStill = video({ label: 'M', still: 'required' }).publishSchema();

    it('accepts a recognised https address with a title, with or without a still', () => {
      expect(optional.safeParse(value()).success).toBe(true);
      expect(optional.safeParse(value({ still: null })).success).toBe(true);
      expect(optional.safeParse(value({ url: 'https://vimeo.com/76979871' })).success).toBe(true);
    });

    it('a required field needs a value; an optional one may be empty', () => {
      expect(required.safeParse(null).success).toBe(false);
      expect(required.safeParse(undefined).success).toBe(false);
      expect(optional.safeParse(null).success).toBe(true);
      expect(optional.safeParse(undefined).success).toBe(true);
    });

    it.each([
      ['an empty address', { url: '' }, 'url'],
      ['an http address', { url: `http://www.youtube.com/watch?v=${YT}` }, 'url'],
      ['an address without a scheme', { url: `youtu.be/${YT}` }, 'url'],
      ['an unknown provider', { url: 'https://example.com/video/1' }, 'url'],
      ['an empty title', { title: '' }, 'title'],
      ['a title over 200 characters', { title: 'x'.repeat(201) }, 'title'],
    ])('refuses %s, at the part that is wrong', (_what, o, at) => {
      const r = optional.safeParse(value(o));
      expect(r.success).toBe(false);
      expect(r.error!.issues.map((i) => i.path[0])).toEqual([at]);
    });

    it('accepts a title of exactly 200 characters', () => {
      expect(optional.safeParse(value({ title: 'x'.repeat(200) })).success).toBe(true);
    });

    it("requires the still when the option says so, and only then", () => {
      const r = withStill.safeParse(value({ still: null }));
      expect(r.success).toBe(false);
      expect(r.error!.issues.map((i) => i.path[0])).toEqual(['still']);
      expect(withStill.safeParse(value()).success).toBe(true);
    });

    it('does not rewrite the stored value', () => {
      const v = value({ url: `https://YOUTU.BE/${YT}` });
      expect(optional.parse(v)).toEqual(v);
    });
  });
});

const clip = video({ label: 'Myndband', still: 'required' });
const article = defineType({
  name: 'article',
  version: 1,
  label: 'Grein',
  fields: {
    title: text({ label: 'Titill', required: true }),
    clip,
    clips: list(video({ label: 'Myndband' }), { label: 'Myndbönd', max: 3 }),
    media: group({ label: 'Miðlar', fields: { trailer: video({ label: 'Stikla' }) } }),
  },
  preview: { title: 'title' },
  orderBy: 'title',
});

describe('projection', () => {
  const ctx = fakeCtx({ assets: { [A]: asset() } });

  it('delivers the provider and id derived from the address, the canonical address, the title and the still as an image field delivers it', () => {
    const out = projectEntry(article, { title: 'T', clip: value({ url: `https://YOUTU.BE/${YT}?si=x` }) }, ctx);
    expect(out.clip).toEqual({
      provider: 'youtube',
      id: YT,
      url: `https://youtu.be/${YT}?si=x`,
      title: 'Myndband',
      still: { ...asset(), alt: 'Kyrrmynd' },
    });
    // Exactly what an image field gives for the same stored image.
    expect((out.clip as { still: unknown }).still).toEqual(image({ label: 'I' }).project(still(), ctx));
  });

  it('keeps an empty per-use alt text, as an image does', () => {
    const out = projectEntry(article, { title: 'T', clip: value({ still: still('') }) }, ctx);
    expect((out.clip as { still: PublicAsset }).still.alt).toBe('');
  });

  it('delivers a null still when there is none, or when its asset does not resolve', () => {
    expect(projectEntry(article, { title: 'T', clip: value({ url: 'https://vimeo.com/76979871' }), clips: [{ _key: 'k', value: value({ still: null }) }] }, fakeCtx({})).clips).toEqual([
      { _key: 'k', value: { provider: 'youtube', id: YT, url: `https://www.youtube.com/watch?v=${YT}`, title: 'Myndband', still: null } },
    ]);
    const out = projectEntry(article, { title: 'T', clip: value({ url: 'https://vimeo.com/76979871' }) }, fakeCtx({ assets: { [A]: asset({ url: 'http://insecure.example/a.jpg' }) } }));
    expect(out.clip).toEqual({ provider: 'vimeo', id: '76979871', url: 'https://vimeo.com/76979871', title: 'Myndband', still: null });
  });

  it('projects an absent field as null', () => {
    expect(projectEntry(article, { title: 'T', clip: value() }, ctx).media).toBeNull();
    expect(projectEntry(article, { title: 'T', clip: value(), media: {} }, ctx).media).toEqual({ trailer: null });
  });

  it('works inside a list and inside a group', () => {
    const out = projectEntry(
      article,
      {
        title: 'T',
        clip: value(),
        clips: [{ _key: 'a', value: value({ url: 'https://player.vimeo.com/video/1' }) }],
        media: { trailer: value({ url: `https://www.youtube.com/shorts/${YT}` }) },
      },
      ctx,
    );
    expect(out.clips).toEqual([{ _key: 'a', value: { provider: 'vimeo', id: '1', url: 'https://player.vimeo.com/video/1', title: 'Myndband', still: { ...asset(), alt: 'Kyrrmynd' } } }]);
    expect(out.media).toEqual({ trailer: { provider: 'youtube', id: YT, url: `https://www.youtube.com/shorts/${YT}`, title: 'Myndband', still: { ...asset(), alt: 'Kyrrmynd' } } });
  });

  it('refuses, on publish, a bad item inside a list or group under its full path', () => {
    const run = (data: Record<string, unknown>) => {
      try {
        projectEntry(article, { title: 'T', clip: value(), ...data }, ctx);
        return null;
      } catch (error) {
        if (!(error instanceof ProjectionError)) throw error;
        return error.issues.map((i) => i.path.join('.'));
      }
    };
    expect(run({ clips: [{ _key: 'a', value: value({ url: 'https://example.com/1' }) }] })).toEqual(['clips.0.value.url']);
    expect(run({ media: { trailer: value({ title: '' }) } })).toEqual(['media.trailer.title']);
    expect(run({ clip: value({ still: null }) })).toEqual(['clip.still']);
  });

  it('extendType can change the label and required flag and keeps the still option', () => {
    const t2 = extendType(article, { fieldOverrides: { clip: { required: true } } });
    expect((t2.fields as Record<string, AnyFieldKind & { still?: string }>).clip).toMatchObject({ kind: 'video', required: true, still: 'required' });
  });
});

describe('delivery types', () => {
  it('declares the delivered shape once, and uses it for the field, nullable', () => {
    const out = generateDeliveryTypes([article]);
    expect(out).toContain('export interface PublicVideo {');
    expect(out).toContain("  provider: 'youtube' | 'vimeo';");
    expect(out).toContain('  still: PublicAsset | null;');
    expect(out).toContain('  clip: PublicVideo | null;');
    expect(out).toContain('  clips: Array<{ _key: string; value: PublicVideo | null }> | null;');
    expect(out).toContain('  media: { trailer: PublicVideo | null; } | null;');
  });
});

describe('schema snapshot', () => {
  const mod = (still: 'required' | 'optional' | undefined, required = false, version = 1) =>
    defineModule({
      tenant: 'fixture',
      locale: 'is',
      branding: { name: 'F' },
      types: [
        defineType<Record<string, AnyFieldKind>>({
          name: 'page',
          version,
          label: 'P',
          fields: { title: text({ label: 'T' }), clip: video({ label: 'M', required, ...(still ? { still } : {}) }) },
          preview: { title: 'title' },
          orderBy: 'title',
          transforms: version > 1 ? { 1: (d) => d as Record<string, unknown> } : undefined,
        }),
      ],
      structure: [],
      site: {},
    });

  it('records the kind and the still option, the default included', () => {
    expect(moduleSnapshot(mod(undefined)).types.page!.fields.clip).toEqual({ kind: 'video', required: false, still: 'optional' });
    expect(moduleSnapshot(mod('required', true)).types.page!.fields.clip).toEqual({ kind: 'video', required: true, still: 'required' });
  });

  it('a still made required is a breaking change; made optional is allowed', () => {
    const optional = moduleSnapshot(mod('optional'));
    const breaking = compareSchema(optional, mod('required'));
    expect(breaking.errors.join('\n')).toMatch(/page\.clip: still now required: a breaking change; bump page's version to 2/);
    expect(compareSchema(optional, mod('required', false, 2)).errors).toEqual([]);
    const loosened = compareSchema(moduleSnapshot(mod('required')), mod('optional'));
    expect(loosened.errors).toEqual([]);
    expect(loosened.changes).toEqual(['page.clip: still now optional']);
  });

  it('a snapshot without the still option reads it as optional', () => {
    const s = moduleSnapshot(mod('optional'));
    delete s.types.page!.fields.clip!.still;
    expect(compareSchema(s, mod('optional'))).toEqual({ errors: [], changes: [] });
    expect(compareSchema(s, mod('required')).errors.join('\n')).toMatch(/still now required/);
  });

  it('a video field turned into another kind, or another kind into a video, is a kind change', () => {
    const asText = defineModule({
      ...mod('optional'),
      types: [defineType({ name: 'page', version: 1, label: 'P', fields: { title: text({ label: 'T' }), clip: text({ label: 'M' }) }, preview: { title: 'title' }, orderBy: 'title' })],
    });
    expect(compareSchema(moduleSnapshot(mod('optional')), asText).errors.join('\n')).toMatch(/page\.clip: kind changed from video to text/);
    expect(compareSchema(moduleSnapshot(asText), mod('optional')).errors.join('\n')).toMatch(/page\.clip: kind changed from text to video/);
  });
});
