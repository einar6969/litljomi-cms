// The import's offline parts (docs/plans/import.md sections 1 and 2.1): the frame, reference
// replacement, wave derivation, derived ids and the copies of the CMS's own derivations.
import { describe, expect, it } from 'vitest';
import { checkFrame } from '../import/manifest.ts';
import { IMPORT_NAMESPACE, assetIdFor, safeFilename, slugBase, slugFits, uuidV5 } from '../import/media.ts';
import { resolveData, type Lookup } from '../import/refs.ts';
import { deriveWaves } from '../import/waves.ts';
import { doc, exampleManifest, homeType, newsType, para, projectType, txt } from './import-fixture.ts';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const lookup: Lookup = {
  entry: (key) => ({ 'project/a': { id: ID(1), type: 'project' }, 'project/b': { id: ID(2), type: 'project' }, 'news/a': { id: ID(3), type: 'news' } })[key] ?? null,
  file: (path) => ({ 'a.jpg': { id: ID(10), alt: 'Default A' }, 'b.jpg': { id: ID(11), alt: '' } })[path] ?? null,
};

describe('checkFrame (the JSON Schema)', () => {
  it('accepts the example manifest', () => {
    expect(checkFrame(exampleManifest())).toMatchObject({ ok: true });
  });

  const broken: [string, (m: Record<string, any>) => void, string][] = [
    ['format', (m) => (m.format = 2), '/format: must be 1'],
    ['unknown top-level property', (m) => (m.tenant = 'x'), '(root): unknown property "tenant"'],
    ['files missing', (m) => delete m.files, '/files: must be an array'],
    ['entries missing', (m) => delete m.entries, '/entries: is required'],
    ['leading slash', (m) => (m.files[0].path = '/abs.jpg'), '/files/0/path'],
    ['dot-dot segment', (m) => (m.files[0].path = 'a/../b.jpg'), '/files/0/path'],
    ['dot segment', (m) => (m.files[0].path = './b.jpg'), '/files/0/path'],
    ['backslash', (m) => (m.files[0].path = 'a\\b.jpg'), '/files/0/path'],
    ['sha256 form', (m) => (m.files[0].sha256 = 'ABC'), '/files/0/sha256'],
    ['bytes over 20 MB', (m) => (m.files[0].bytes = 20_971_521), '/files/0/bytes'],
    ['bytes zero', (m) => (m.files[0].bytes = 0), '/files/0/bytes'],
    ['alt over 1,000', (m) => (m.files[0].alt = 'x'.repeat(1001)), '/files/0/alt: must be at most 1000'],
    ['credit over 300', (m) => (m.files[0].credit = 'ð'.repeat(301)), '/files/0/credit: must be at most 300'],
    ['caption not text', (m) => (m.files[0].caption = 3), '/files/0/caption: must be a string or null'],
    ['unknown file property', (m) => (m.files[0].title = 'x'), '/files/0: unknown property "title"'],
    ['type name', (m) => (m.entries.Project = []), '/entries: "Project" is not a type name'],
    ['key form', (m) => (m.entries.project[0].key = '-bad'), '/entries/project/0/key'],
    ['slug form', (m) => (m.entries.project[0].slug = 'Bad Slug'), '/entries/project/0/slug'],
    ['data not an object', (m) => (m.entries.project[0].data = []), '/entries/project/0/data: must be an object'],
    ['unknown entry property', (m) => (m.entries.project[0].id = 'x'), '/entries/project/0: unknown property "id"'],
    ['singleton unknown property', (m) => (m.singletons.home.slug = 'x'), '/singletons/home: unknown property "slug"'],
    ['order duplicates', (m) => (m.order.project = ['project/harbour', 'project/harbour']), '/order/project: names a key twice'],
  ];
  for (const [name, change, expected] of broken) {
    it(`refuses: ${name}`, () => {
      const m = exampleManifest() as Record<string, any>;
      change(m);
      const result = checkFrame(m);
      expect(result.ok).toBe(false);
      expect(result.ok ? [] : result.problems.join('\n')).toContain(expected);
    });
  }

  it('lists every problem, not the first', () => {
    const m = exampleManifest() as Record<string, any>;
    m.format = 2;
    m.files[0].sha256 = 'x';
    m.entries.project[0].key = '';
    const result = checkFrame(m);
    expect(result.ok ? 0 : result.problems.length).toBe(3);
  });
});

describe('resolveData (references inside data)', () => {
  it('replaces $entry and $file in fields, fills an image\'s default alt and keeps an empty one', () => {
    const r = resolveData(newsType, { title: 'T', image: { $file: 'a.jpg' }, project: { $entry: 'project/a' } }, lookup);
    expect(r.problems).toEqual([]);
    expect(r.data).toEqual({ title: 'T', image: { _ref: ID(10), _kind: 'asset', alt: 'Default A' }, project: { _ref: ID(1), _kind: 'entry' } });
    expect(resolveData(newsType, { image: { $file: 'a.jpg', alt: '' } }, lookup).data.image).toEqual({ _ref: ID(10), _kind: 'asset', alt: '' });
  });

  it('derives list keys from position and keeps given ones', () => {
    const r = resolveData(projectType, { gallery: [{ value: { $file: 'a.jpg' } }, { _key: 'x', value: { $file: 'b.jpg', alt: 'B' } }] }, lookup);
    expect(r.data.gallery).toEqual([
      { _key: 'i0', value: { _ref: ID(10), _kind: 'asset', alt: 'Default A' } },
      { _key: 'x', value: { _ref: ID(11), _kind: 'asset', alt: 'B' } },
    ]);
  });

  it('replaces inside groups and checks a reference field\'s allowed types', () => {
    const ok = resolveData(projectType, { meta: { client: 'C', partner: { $entry: 'project/b' } } }, lookup);
    expect(ok.data.meta).toEqual({ client: 'C', partner: { _ref: ID(2), _kind: 'entry' } });
    const wrong = resolveData(projectType, { related: { $entry: 'news/a' } }, lookup);
    expect(wrong.problems.join()).toContain('/related: "news/a" is of type "news"; this field allows "project"');
  });

  it('replaces generically inside a kind it does not know (the video kind\'s still image)', () => {
    const r = resolveData(newsType, { video: { url: 'https://vimeo.com/1', still: { $file: 'a.jpg', alt: 'Still' } } }, lookup);
    expect(r.data.video).toEqual({ url: 'https://vimeo.com/1', still: { _ref: ID(10), _kind: 'asset', alt: 'Still' } });
    expect(r.files).toEqual(['a.jpg']);
  });

  it('replaces rich-text images (alt defaulted) and entry links, and names non-canonical hrefs', () => {
    const body = doc(
      { type: 'image', attrs: { asset: { $file: 'a.jpg' } } },
      para(txt('see '), txt('this', [{ type: 'link', attrs: { entry: { $entry: 'project/b' } } }]), txt('x', [{ type: 'link', attrs: { href: 'HTTPS://Example.com' } }])),
    );
    const r = resolveData(projectType, { body }, lookup);
    expect(r.data.body).toEqual(
      doc(
        { type: 'image', attrs: { asset: { _ref: ID(10), _kind: 'asset' }, alt: 'Default A' } },
        para(txt('see '), txt('this', [{ type: 'link', attrs: { entry: { _ref: ID(2), _kind: 'entry' } } }]), txt('x', [{ type: 'link', attrs: { href: 'HTTPS://Example.com' } }])),
      ),
    );
    expect(r.problems.join()).toContain('href is not in canonical form; write "https://example.com/"');
    expect(r.entries.map((u) => [u.key, u.removable])).toEqual([['project/b', true]]);
  });

  it('refuses ids, unknown keys and paths, and malformed references', () => {
    const r = resolveData(newsType, { image: { _ref: ID(10), _kind: 'asset', alt: '' }, project: { $entry: 'nope' }, video: { url: 'u', still: { $file: 'nope.jpg' } } }, lookup);
    const text = r.problems.join('\n');
    expect(text).toContain('/image: a manifest names entries by "$entry" and files by "$file", never by id');
    expect(text).toContain('/project: "$entry" names no entry');
    expect(text).toContain('/video/still: "$file" names no file');
    expect(resolveData(newsType, { project: { $entry: 'project/a', extra: 1 } }, lookup).problems.join()).toContain('must be exactly {"$entry": "<key>"}');
  });

  it('leaves out removable uses of dropped keys: a field, a list item, a link mark', () => {
    const data = {
      title: 'T',
      related: { $entry: 'project/b' },
      body: doc(para(txt('a', [{ type: 'link', attrs: { entry: { $entry: 'project/b' } } }]))),
    };
    const r = resolveData(projectType, data, lookup, new Set(['project/b']));
    expect(r.data).toEqual({ title: 'T', body: doc(para(txt('a'))) });
    const home = resolveData(homeType, { featured: [{ value: { $entry: 'project/a' } }, { value: { $entry: 'project/b' } }] }, lookup, new Set(['project/b']));
    expect(home.data.featured).toEqual([{ _key: 'i0', value: { _ref: ID(1), _kind: 'entry' } }]);
  });

  it('never changes its input', () => {
    const data = { title: 'T', gallery: [{ value: { $file: 'a.jpg' } }] };
    const copy = structuredClone(data);
    resolveData(projectType, data, lookup);
    expect(data).toEqual(copy);
  });
});

describe('deriveWaves', () => {
  const use = (key: string, removable = true) => ({ key, at: [], removable });

  it('orders targets before referrers, by depth', () => {
    const plan = deriveWaves(
      [
        { key: 'news', uses: [use('project')] },
        { key: 'project', uses: [] },
        { key: 'home', uses: [use('project')] },
        { key: 'digest', uses: [use('news')] },
      ],
      () => true,
    );
    expect(plan.waves).toEqual([['project'], ['news', 'home'], ['digest']]);
    expect(plan.secondPass).toEqual([]);
  });

  it('breaks a cycle at an optional reference and publishes it again after the last wave', () => {
    // a → b is required (a cannot do without b); b → a is optional.
    const plan = deriveWaves([{ key: 'a', uses: [use('b')] }, { key: 'b', uses: [use('a')] }], (key) => key === 'b');
    expect(plan.waves).toEqual([['b'], ['a']]);
    expect(plan.secondPass).toEqual(['b']);
    expect([...(plan.dropped.get('b') ?? [])]).toEqual(['a']);
    expect(plan.problems).toEqual([]);
  });

  it('breaks a self-reference', () => {
    const plan = deriveWaves([{ key: 'a', uses: [use('a')] }], () => true);
    expect(plan.waves).toEqual([['a']]);
    expect(plan.secondPass).toEqual(['a']);
  });

  it('refuses a cycle of required references', () => {
    const plan = deriveWaves([{ key: 'a', uses: [use('b')] }, { key: 'b', uses: [use('a')] }], () => false);
    expect(plan.problems).toEqual(['a cycle of required references cannot be broken: "a", "b"']);
    const generic = deriveWaves([{ key: 'a', uses: [use('b', false)] }, { key: 'b', uses: [use('a', false)] }], () => true);
    expect(generic.problems).toHaveLength(1);
  });
});

describe('derived ids and the CMS\'s derivations', () => {
  it('is RFC 9562 UUID v5', () => {
    // The RFC's DNS namespace and the well-known vector uuid5(NAMESPACE_DNS, "python.org").
    expect(uuidV5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'python.org')).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d');
  });

  it('gives the same bytes the same id in one tenant, and another in another', () => {
    const hash = 'a'.repeat(64);
    const t1 = '11111111-1111-4111-8111-111111111111';
    const t2 = '22222222-2222-4222-8222-222222222222';
    expect(assetIdFor(t1, hash)).toBe(assetIdFor(t1, hash));
    expect(assetIdFor(t1, hash)).not.toBe(assetIdFor(t2, hash));
    expect(assetIdFor(t1, hash)).toBe(uuidV5(IMPORT_NAMESPACE, `${t1}/${hash}`));
    expect(assetIdFor(t1, hash)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('makes file names and slugs as the editor does', () => {
    expect(safeFilename('projects/Höfnin Þín.JPG', 'image/jpeg')).toBe('hofnin-thin.jpg');
    expect(safeFilename('...', 'image/png')).toBe('mynd.png');
    expect(slugBase('Göngustígur við höfnina')).toBe('gongustigur-vid-hofnina');
    expect(slugFits('harbour-path-2', 'harbour-path')).toBe(true);
    expect(slugFits('harbour', 'harbour-path')).toBe(false);
  });
});
