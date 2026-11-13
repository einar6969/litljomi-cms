// The dry run (docs/plans/import.md section 2.1): each check failing on its own, the counts, and
// the text the report will compare. Offline: no fetch, no env file, no password.
import { describe, expect, it } from 'vitest';
import { runImport, type ImportDeps } from '../import.ts';
import { dryRun, jsonbText } from '../import/plan.ts';
import { MEDIA, exampleManifest, exampleMedia, fakeImage, fakeInspect, sha, testModule, txt, para, doc, type FakeMedia } from './import-fixture.ts';

type M = Record<string, any>;
const MANIFEST = '/work/site.manifest.json';

async function check(change: (m: M, media: FakeMedia) => void = () => {}) {
  const m = exampleManifest() as M;
  const media = exampleMedia();
  change(m, media);
  return dryRun(JSON.stringify(m), testModule, MEDIA, media, fakeInspect);
}

async function problems(change: (m: M, media: FakeMedia) => void): Promise<string> {
  const result = await check(change);
  expect(result.ok).toBe(false);
  return result.ok ? '' : result.problems.join('\n');
}

describe('dry run', () => {
  it('passes the example and derives its waves', async () => {
    const result = await check();
    expect(result.ok ? [] : result.problems).toEqual([]);
    if (!result.ok) return;
    // home refers only to the project, so it shares the second wave with the news post.
    expect(result.plan.waves).toEqual([['project/harbour'], ['news/opening', 'home']]);
    expect(result.plan.items.find((i) => i.key === 'news/opening')?.slug).toBe('the-path-opens');
    expect(result.plan.slugsAtRisk).toEqual([]);
  });

  it('refuses invalid JSON and a bad frame before reading any file', async () => {
    const media = exampleMedia();
    expect(await dryRun('{', testModule, MEDIA, media, fakeInspect)).toEqual({ ok: false, problems: ['the manifest is not valid JSON'] });
    const result = await dryRun(JSON.stringify({ format: 2, files: [], entries: {} }), testModule, MEDIA, media, fakeInspect);
    expect(result.ok).toBe(false);
    expect(media.reads).toBe(0);
  });

  describe('files', () => {
    it('a file missing under --media', async () => {
      expect(await problems((_, media) => media.files.delete(`${MEDIA}/news/opening.png`))).toContain('file "news/opening.png": not found under --media');
    });
    it('a symlink, at the file or on its path', async () => {
      expect(await problems((_, media) => media.symlinks.add(`${MEDIA}/news/opening.png`))).toContain('"news/opening.png": is or passes through a symlink');
      expect(await problems((_, media) => media.symlinks.add(`${MEDIA}/projects`))).toContain('"projects/harbour/01.jpg": is or passes through a symlink');
    });
    it('bytes that differ', async () => {
      expect(await problems((m) => (m.files[1].bytes += 1))).toContain('"news/opening.png": is 80 bytes on disk, the manifest says 81');
    });
    it('a sha256 that differs', async () => {
      expect(await problems((m) => (m.files[1].sha256 = 'f'.repeat(64)))).toContain('"news/opening.png": its sha256 is not the manifest\'s');
    });
    it('an image the CMS does not accept', async () => {
      const gif = fakeImage('GIF', 'x');
      expect(
        await problems((m, media) => {
          media.put('news/opening.png', gif);
          m.files[1] = { ...m.files[1], sha256: sha(gif), bytes: gif.byteLength };
        }),
      ).toContain('"news/opening.png": is not a JPEG, PNG or WebP image');
    });
    it('two paths with the same bytes (decision 8)', async () => {
      expect(
        await problems((m, media) => {
          media.put('copy.jpg', media.files.get(`${MEDIA}/projects/harbour/01.jpg`) as Uint8Array);
          m.files.push({ ...m.files[0], path: 'copy.jpg' });
        }),
      ).toContain('"copy.jpg": has the same sha256 as "projects/harbour/01.jpg"');
    });
  });

  it('a type not in the module', async () => {
    expect(await problems((m) => (m.entries.event = [{ key: 'e', data: {} }]))).toContain('/entries/event/0: type "event" is not in the module');
  });

  it('a singleton under entries, and an entry type under singletons', async () => {
    expect(await problems((m) => (m.entries.home = [{ key: 'h2', data: {} }]))).toContain('type "home" is a singleton; give it under "singletons"');
    expect(await problems((m) => (m.singletons.news = { key: 'n2', data: { title: 'x' } }))).toContain('type "news" is not a singleton');
  });

  it('a key used twice', async () => {
    expect(await problems((m) => m.entries.news.push({ key: 'project/harbour', data: { title: 'Other' } }))).toContain('key "project/harbour" is used twice');
  });

  it('an unknown $entry or $file', async () => {
    expect(await problems((m) => (m.entries.news[0].data.project = { $entry: 'project/nope' }))).toContain('/project: "$entry" names no entry');
    expect(await problems((m) => (m.entries.news[0].data.image = { $file: 'nope.jpg' }))).toContain('/image: "$file" names no file');
  });

  it('a field the validator would strip is an error, not a silent loss', async () => {
    expect(await problems((m) => (m.entries.news[0].data.subtitle = 'lost'))).toContain('news "news/opening": draft: /subtitle: the validator would strip or change this value');
  });

  it('a missing required field', async () => {
    expect(await problems((m) => delete m.entries.news[0].data.title)).toContain('news "news/opening": publish: /title:');
  });

  it('a wrong value type', async () => {
    expect(await problems((m) => (m.entries.news[0].data.date = 2019))).toContain('news "news/opening": draft: /date:');
  });

  it('rich text outside v1, and a non-canonical href', async () => {
    expect(await problems((m) => (m.entries.news[0].data.body = doc({ type: 'table', content: [] })))).toContain('/body');
    expect(await problems((m) => (m.entries.news[0].data.body = doc(para(txt('x', [{ type: 'link', attrs: { href: 'https://Example.com' } }])))))).toContain(
      'href is not in canonical form; write "https://example.com/"',
    );
  });

  it('duplicate slugs per type, and an explicit slug the title would not give (at risk, not an error)', async () => {
    expect(
      await problems((m) => m.entries.project.push({ key: 'project/two', slug: 'harbour-path', data: { title: 'Two' } })),
    ).toContain('slug "harbour-path" is also "project/harbour"\'s');
    const result = await check((m) => (m.entries.project[0].slug = 'old-address'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan.slugsAtRisk).toEqual([{ key: 'project/harbour', slug: 'old-address', fromTitle: 'harbour-path' }]);
  });

  it('a slug from the key when there is no title', async () => {
    const result = await check((m) => m.entries.project.push({ key: 'project/Untitled_7', data: { title: '…' } }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan.byKey.get('project/Untitled_7')?.slug).toBe('project-untitled-7');
  });

  it('an order that names a key of another type', async () => {
    expect(await problems((m) => (m.order.project = ['news/opening']))).toContain('/order/project: "news/opening" is not an entry of type "project"');
  });

  it('a cycle: broken at an optional reference, refused when every reference is required', async () => {
    const ok = await check((m) => (m.entries.project[0].data.related = { $entry: 'project/harbour' }));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.plan.secondPass).toEqual(['project/harbour']);
    expect(
      await problems((m) => {
        m.entries.pair = [
          { key: 'pair/a', data: { title: 'A', other: { $entry: 'pair/b' } } },
          { key: 'pair/b', data: { title: 'B', other: { $entry: 'pair/a' } } },
        ];
      }),
    ).toContain('a cycle of required references cannot be broken: "pair/a", "pair/b"');
  });

  it('a draft over 1 MiB', async () => {
    expect(await problems((m) => (m.entries.news[0].data.title = 'x'.repeat(1_048_600)))).toContain('its draft would be');
  });

  it('measures a draft as Postgres prints jsonb', () => {
    expect(jsonbText({ a: [1, 'b'], c: { d: null } })).toBe('{"a": [1, "b"], "c": {"d": null}}');
  });

  it('as a command: prints counts and the comparison text, and sends nothing', async () => {
    const out: string[] = [];
    const err: string[] = [];
    const media = exampleMedia();
    const unexpected = async () => {
      throw new Error('the dry run must not do this');
    };
    const deps: ImportDeps = {
      fetch: unexpected,
      readTextFile: async (p) => {
        if (p !== MANIFEST) throw new Error('the dry run reads the manifest only');
        return JSON.stringify(exampleManifest());
      },
      lstat: (p) => media.lstat(p),
      readBytes: (p) => media.readBytes(p),
      read: unexpected,
      write: unexpected,
      readPassword: unexpected,
      inspectImage: fakeInspect,
      loadModule: async () => testModule,
      now: () => 0,
      sleep: unexpected,
    };
    const code = await runImport(['--tenant', 'acme', '--manifest', MANIFEST, '--media', MEDIA, '--dry-run'], { log: (l) => out.push(l), error: (l) => err.push(l) }, deps);
    expect(err).toEqual([]);
    expect(code).toBe(0);
    const text = out.join('\n');
    expect(text).toContain('files: 3 (216 bytes)');
    expect(text).toContain('entries: project 1, news 1, home 1');
    expect(text).toContain('waves: 2');
    expect(text).toContain('project project/harbour /harbour-path');
    expect(text).toContain('  /body/content/0/content/0/text: A path along the harbour.');
    expect(text).toContain('  /project: → project/harbour');
    expect(text).toContain('  /cover: file projects/harbour/01.jpg');
    expect(text).toContain('dry run: no problems; nothing was sent');
  });

  it('as a command: refuses network flags', async () => {
    const err: string[] = [];
    const code = await runImport(
      ['--tenant', 'acme', '--manifest', MANIFEST, '--media', MEDIA, '--dry-run', '--expect-ref', 'x'],
      { log: () => {}, error: (l) => err.push(l) },
      {} as ImportDeps,
    );
    expect(code).toBe(2);
    expect(err[0]).toContain('--dry-run is offline');
  });
});
