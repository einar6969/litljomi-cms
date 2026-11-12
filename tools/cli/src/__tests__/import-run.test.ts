// The writing run and the report (docs/plans/import.md sections 2.2 to 2.7 and 3), against an
// in-memory Hub over HTTP: a full run, a second run that creates nothing, a run killed after every
// call and resumed, an editor's save before publish, batch waits on a fake clock, and report
// differences. Every run checks the section 3 rules: no secret key, no admin or worker call, no
// request outside the target, no password or token in any output.
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../cli.ts';
import { IMPORT_USAGE, runImport, type ImportDeps } from '../import.ts';
import { assetIdFor } from '../import/media.ts';
import { POLL_MS, STALL_MS } from '../import/run.ts';
import { EMAIL, FakeHub, ORIGIN, OTHER_TENANT_ID, PASSWORD, PUBLISHABLE, REF, TENANT_ID } from './import-fake-hub.ts';
import { MEDIA, exampleManifest, exampleMedia, sha, testModule, type FakeMedia } from './import-fixture.ts';

const MANIFEST = '/work/site.manifest.json';
const ENV_FILE = '/work/.env.test';
const LEDGER = `${MANIFEST}.${REF}.acme.ledger.json`;
const REPORT = `${MANIFEST}.${REF}.acme.report.json`;
const SECRET_KEY = 'sb_secret_TESTONLY_never_read';
const ENV = `NEXT_PUBLIC_SUPABASE_URL=${ORIGIN}\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${PUBLISHABLE}\nSUPABASE_SECRET_KEY=${SECRET_KEY}\n`;
const ARGS = ['--tenant', 'acme', '--manifest', MANIFEST, '--media', MEDIA, '--email', EMAIL, '--expect-ref', REF, `--env-file=${ENV_FILE}`];

interface World {
  hub: FakeHub;
  media: FakeMedia;
  manifest: Record<string, any>;
  files: Map<string, string>;
  writes: string[];
  password: string | null;
  sweep: boolean;
}

interface Run {
  code: number;
  out: string[];
  err: string[];
  text: string;
}

const worlds: { world: World; runs: Run[] }[] = [];

function world(change: (w: World) => void = () => {}): World {
  const w: World = { hub: new FakeHub(testModule), media: exampleMedia(), manifest: exampleManifest(), files: new Map(), writes: [], password: PASSWORD, sweep: true };
  change(w);
  worlds.push({ world: w, runs: [] });
  return w;
}

async function run(w: World, extra: string[] = []): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const deps: ImportDeps = {
    fetch: w.hub.fetch,
    readTextFile: async (p) => {
      if (p === MANIFEST) return JSON.stringify(w.manifest);
      if (p === ENV_FILE) return ENV;
      throw new Error('ENOENT');
    },
    lstat: (p) => w.media.lstat(p),
    readBytes: (p) => w.media.readBytes(p),
    read: async (p) => w.files.get(p) ?? null,
    write: async (p, text) => {
      w.writes.push(p);
      w.files.set(p, text);
    },
    readPassword: async () => w.password,
    inspectImage: (await import('./import-fixture.ts')).fakeInspect,
    loadModule: async () => testModule,
    now: () => w.hub.clock,
    sleep: async (ms) => {
      w.hub.clock += ms;
      if (w.sweep) w.hub.sweep();
    },
  };
  const code = await runImport([...ARGS, ...extra], { log: (l) => out.push(l), error: (l) => err.push(l) }, deps);
  const result = { code, out, err, text: [...out, ...err].join('\n') };
  worlds.find((x) => x.world === w)?.runs.push(result);
  return result;
}

const ledger = (w: World) => JSON.parse(w.files.get(LEDGER) as string) as { entries: Record<string, { id: string; savedVersion?: number }> };
const report = (w: World) => JSON.parse(w.files.get(REPORT) as string) as { differences: { key: string; at: string; what: string; expected?: string; actual?: string }[]; unchecked: { what: string; count: number }[]; checked: { entries: number; files: number }; release: number };
const creates = (w: World) => w.hub.count('POST', '/rest/v1/rpc/create_entry') + w.hub.count('POST', '/rest/v1/rpc/create_singleton_entry');

// Section 3, after every test: an editor only, one origin, nothing secret printed.
afterEach(() => {
  for (const { world: w, runs } of worlds.splice(0)) {
    for (const call of w.hub.calls) {
      expect(call.path).not.toMatch(/\/rpc\/(admin_|worker_)/);
      expect(call.path).not.toMatch(/\/rest\/v1\/(entries|drafts|assets|publish_requests)\b/);
      expect(JSON.stringify(call.headers)).not.toContain(SECRET_KEY);
      if (call.headers.apikey !== undefined) expect(call.headers.apikey).toBe(PUBLISHABLE);
    }
    for (const r of runs) {
      expect(r.text).not.toContain(PASSWORD);
      expect(r.text).not.toContain(SECRET_KEY);
      expect(r.text).not.toMatch(/access-[0-9a-f-]{36}|refresh-[0-9a-f-]{36}/);
      expect(r.text).not.toContain('A path along the harbour');
    }
    for (const text of w.files.values()) {
      expect(text).not.toContain(PASSWORD);
      expect(text).not.toMatch(/access-[0-9a-f-]{36}|refresh-[0-9a-f-]{36}/);
    }
  }
});

describe('import: a full run', () => {
  it('uploads, registers, creates, saves and publishes in waves, then reports no difference', async () => {
    const w = world();
    const r = await run(w);
    expect(r.err).toEqual([]);
    expect(r.code).toBe(0);
    const hub = w.hub;
    // Files: derived ids, texts set, no thumbnail yet (L2).
    const coverId = assetIdFor(TENANT_ID, sha(exampleMedia().files.get(`${MEDIA}/projects/harbour/01.jpg`) as Uint8Array));
    expect(hub.assets.get(coverId)).toMatchObject({ default_alt: 'The harbour path at dusk', caption: 'The new path', credit: 'Photo: A. Person', thumb_path: null });
    expect(hub.assets.size).toBe(3);
    expect(r.text).toContain('thumbnails: 3 file(s) without one');
    // Entries: the slug as given, the derived one, and the singleton through its own function.
    const bySlug = (slug: string) => [...hub.entries.values()].find((e) => e.slug === slug);
    expect(bySlug('harbour-path')?.published_draft_version).toBe(2);
    expect(bySlug('the-path-opens')?.published_draft_version).toBe(2);
    expect(hub.count('POST', '/rest/v1/rpc/create_singleton_entry')).toBe(1);
    expect([...hub.entries.values()].filter((e) => e.singleton)).toHaveLength(1);
    // Waves: the project's request is filed and delivered before the news post and home are requested.
    const requests = hub.calls.filter((c) => c.path === '/rest/v1/rpc/request_publish').map((c) => (c.body as { p_entry_id: string }).p_entry_id);
    expect(requests[0]).toBe(bySlug('harbour-path')?.id);
    expect(requests).toHaveLength(3);
    // The report: everything compared, nothing different; captions and order counted as unchecked.
    const rep = report(w);
    expect(rep.differences).toEqual([]);
    expect(rep.checked).toEqual({ entries: 3, files: 3 });
    expect(rep.unchecked).toEqual([
      { what: 'file captions and credits (not delivered until L3)', count: 1 },
      { what: 'order: validated, not applied (manual ordering, A12, does not exist yet)', count: 1 },
    ]);
    expect(r.text).toContain('first batch: 1 request(s), 2 new image(s), 136 bytes');
    // The ledger names ids only.
    expect(Object.keys(ledger(w).entries).sort()).toEqual(['home', 'news/opening', 'project/harbour']);
    expect(w.files.get(LEDGER)).not.toContain('harbour path');
  });

  it('a second run creates and writes nothing', async () => {
    const w = world();
    expect((await run(w)).code).toBe(0);
    const before = { calls: w.hub.calls.length, creates: creates(w), objects: w.hub.objects.size, releases: w.hub.release };
    const second = await run(w);
    expect(second.code).toBe(0);
    const newCalls = w.hub.calls.slice(before.calls);
    const writes = newCalls.filter((c) => c.method === 'POST' && !/\/rpc\/(entry_detail_by_id|asset_summary)$/.test(c.path) && !c.path.startsWith('/auth/'));
    expect(writes.map((c) => c.path)).toEqual([]);
    expect(w.hub.release).toBe(before.releases);
  });

  it('a lost ledger: entries are found again by slug and singleton, with nothing duplicated', async () => {
    const w = world();
    expect((await run(w)).code).toBe(0);
    w.files.delete(LEDGER);
    const before = w.hub.entries.size;
    const second = await run(w);
    expect(second.code).toBe(0);
    expect(w.hub.entries.size).toBe(before);
    expect(w.hub.count('POST', '/rest/v1/rpc/create_entry')).toBe(2);
  });
});

describe('import: killed after every call, then resumed', () => {
  it('finishes without duplicates whatever call the process died after', async () => {
    const reference = world();
    expect((await run(reference)).code).toBe(0);
    const total = reference.hub.calls.length;
    for (let n = 1; n <= total; n++) {
      const w = world();
      w.hub.killAfter = n;
      const first = await run(w);
      expect(first.code, `killed after call ${n}`).toBe(1);
      w.hub.killAfter = null;
      w.hub.killed = false;
      const resumed = await run(w);
      expect(resumed.code, `resumed after a kill at call ${n}:\n${resumed.text}`).toBe(0);
      expect(w.hub.entries.size, `entries after a kill at call ${n}`).toBe(3);
      expect(w.hub.assets.size).toBe(3);
      expect(w.hub.requests.filter((r) => r.status === 'committed')).toHaveLength(3);
      expect(report(w).differences).toEqual([]);
    }
  }, 60_000);
});

describe('import: someone else\'s edits are reported, not overwritten', () => {
  it('an editor\'s save that moves a slug before publish: not published, reported', async () => {
    const w = world();
    w.hub.before = (_n, method, path) => {
      // After the drafts are saved, while the first wave is published, an editor saves the news post.
      if (method === 'POST' && path === '/rest/v1/rpc/request_publish' && w.hub.requests.length === 0) {
        const news = [...w.hub.entries.values()].find((e) => e.slug === 'the-path-opens');
        if (news !== undefined) w.hub.editorSave(news.id, (d) => (d.title = 'A new title'), 'a-new-title');
      }
    };
    const r = await run(w);
    expect(r.code).toBe(1);
    expect(r.text).toContain('NOT TOUCHED news/opening:');
    expect(r.text).toContain('the run stops before the next wave');
    const news = [...w.hub.entries.values()].find((e) => e.slug === 'a-new-title');
    expect(news?.published_draft_version).toBeNull();
    expect(news?.data.title).toBe('A new title');
    expect(report(w).differences.some((d) => d.key === 'news/opening')).toBe(true);
  });

  it('a slug taken by an entry with content that is not the manifest\'s: the run stops before writing drafts', async () => {
    const w = world();
    expect((await run(w)).code).toBe(0);
    w.files.delete(LEDGER);
    const project = [...w.hub.entries.values()].find((e) => e.slug === 'harbour-path');
    w.hub.editorSave(project?.id as string, (d) => (d.title = 'Edited'));
    const saves = w.hub.count('POST', '/rest/v1/rpc/save_draft');
    const r = await run(w);
    expect(r.code).toBe(1);
    expect(r.text).toContain('already has slug harbour-path and content that is not the manifest\'s');
    expect(w.hub.count('POST', '/rest/v1/rpc/save_draft')).toBe(saves);
  });

  it('a manifest changed for a published entry: reported, not republished (decision 6)', async () => {
    const w = world();
    expect((await run(w)).code).toBe(0);
    w.manifest.entries.project[0].data.meta.client = 'Another client';
    const releases = w.hub.release;
    const r = await run(w);
    expect(r.code).toBe(1);
    expect(r.text).toContain('NOT TOUCHED project/harbour: it is published, and the manifest differs');
    expect(w.hub.release).toBe(releases);
  });

  it('library texts an editor changed are not overwritten', async () => {
    const w = world();
    expect((await run(w)).code).toBe(0);
    w.manifest.files[0].caption = 'Another caption';
    const r = await run(w);
    expect(r.text).toContain('NOT TOUCHED file projects/harbour/01.jpg');
    // Two of the three files have texts; the third has none to write.
    expect(w.hub.count('POST', '/rest/v1/rpc/update_asset_text')).toBe(2);
  });
});

// The ledger is a local file beside the client's manifest, and the editor may be a member of several
// tenants: an id it names, or an entry found on the server, is checked against the server's tenant
// and type before anything is written.
describe('import: an entry of another tenant or type is refused before any write', () => {
  /** A planted ledger naming three empty entries, as the reviewer's probe did. */
  function planted(rewrite: (w: World, ids: Record<string, string>) => FakeHub['rewriteDetail']): World {
    const w = world();
    const ids = {
      'project/harbour': w.hub.plantEntry('project', 'harbour-path'),
      'news/opening': w.hub.plantEntry('news', 'the-path-opens'),
      home: w.hub.plantEntry('home', null, true),
    };
    const types: Record<string, string> = { 'project/harbour': 'project', 'news/opening': 'news', home: 'home' };
    const entries = Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, { id, type: types[k] }]));
    w.files.set(LEDGER, JSON.stringify({ format: 1, ref: REF, tenant: 'acme', tenantId: TENANT_ID, entries }));
    w.hub.rewriteDetail = rewrite(w, ids);
    return w;
  }
  const writes = (w: World) =>
    w.hub.calls.filter((c) => (c.method === 'POST' || c.method === 'PUT') && !/\/rpc\/(entry_detail_by_id|asset_summary)$/.test(c.path) && !c.path.startsWith('/auth/'));

  it('a ledger record whose entry the server places in another tenant', async () => {
    const w = planted(() => (d) => ({ ...d, tenant_id: OTHER_TENANT_ID }));
    const r = await run(w);
    expect(r.code).toBe(1);
    expect(r.text).toContain(`is in tenant ${OTHER_TENANT_ID}, not ${TENANT_ID}`);
    expect(w.hub.count('POST', '/rest/v1/rpc/save_draft')).toBe(0);
    expect(w.hub.count('POST', '/rest/v1/rpc/request_publish')).toBe(0);
    expect(writes(w).map((c) => c.path)).toEqual([]);
    expect(w.hub.objects.size).toBe(0);
  });

  it('a ledger record whose entry the server has as another type', async () => {
    const w = planted((_w, ids) => (d) => (d.id === ids['project/harbour'] ? { ...d, type: 'news' } : d));
    const r = await run(w);
    expect(r.code).toBe(1);
    expect(r.text).toContain('is a news entry on the server, not project');
    expect(writes(w).map((c) => c.path)).toEqual([]);
  });

  it('an entry found again by slug that the server places in another tenant', async () => {
    const w = world();
    expect((await run(w)).code).toBe(0);
    w.files.delete(LEDGER);
    const project = [...w.hub.entries.values()].find((e) => e.slug === 'harbour-path');
    w.hub.rewriteDetail = (d) => (d.id === project?.id ? { ...d, tenant_id: OTHER_TENANT_ID } : d);
    const before = w.hub.calls.length;
    const r = await run(w);
    expect(r.code).toBe(1);
    expect(r.text).toContain(`is in tenant ${OTHER_TENANT_ID}, not ${TENANT_ID}`);
    const later = w.hub.calls.slice(before).filter((c) => /\/rpc\/(save_draft|request_publish)$/.test(c.path));
    expect(later).toEqual([]);
  });
});

describe('import: cycles', () => {
  it('publishes a self-referring project without the reference first, then with it', async () => {
    const w = world((x) => (x.manifest.entries.project[0].data.related = { $entry: 'project/harbour' }));
    const r = await run(w);
    expect(r.code).toBe(0);
    const project = [...w.hub.entries.values()].find((e) => e.slug === 'harbour-path');
    expect(project?.published?.data.related).toEqual({ _ref: project?.id, _kind: 'entry' });
    expect(w.hub.requests.filter((q) => q.entry_id === project?.id)).toHaveLength(2);
    expect(report(w).differences).toEqual([]);
    // And a re-run leaves it alone.
    const releases = w.hub.release;
    expect((await run(w)).code).toBe(0);
    expect(w.hub.release).toBe(releases);
  });
});

describe('import: batches and waits', () => {
  it('never queues more than one batch, of at most --batch-size requests from one wave', async () => {
    const w = world((x) => {
      x.manifest.entries.project.push(...Array.from({ length: 6 }, (_, i) => ({ key: `project/p${i}`, data: { title: `Project ${i}` } })));
    });
    let maxPending = 0;
    w.hub.before = () => {
      maxPending = Math.max(maxPending, w.hub.requests.filter((r) => r.status === 'pending').length);
    };
    const r = await run(w, ['--batch-size', '3']);
    expect(r.code).toBe(0);
    expect(maxPending).toBeLessThanOrEqual(3);
    expect(r.text).toMatch(/first batch: 3 request\(s\)/);
  });

  it('waits in steps of ten seconds and stops after ten minutes without progress (B11)', async () => {
    const w = world();
    w.hub.sweepStopped = true;
    const start = w.hub.clock;
    const r = await run(w);
    expect(r.code).toBe(1);
    expect(r.text).toContain('the sweep may have stopped (B11)');
    expect(w.hub.clock - start).toBeGreaterThanOrEqual(STALL_MS);
    expect(w.hub.clock - start).toBeLessThan(STALL_MS + 15 * 60_000);
    expect((w.hub.clock - start) % POLL_MS).toBe(0);
    // The request is waited for, not filed again, on the next run.
    w.hub.sweepStopped = false;
    expect((await run(w)).code).toBe(0);
    const project = [...w.hub.entries.values()].find((e) => e.slug === 'harbour-path');
    expect(w.hub.requests.filter((q) => q.entry_id === project?.id)).toHaveLength(1);
  });

  it('--first-batch-only stops after the measured first batch', async () => {
    const w = world();
    const r = await run(w, ['--first-batch-only']);
    expect(r.code).toBe(0);
    expect(r.text).toContain('stopped after the first batch');
    expect(w.hub.requests).toHaveLength(1);
    expect(r.text).toMatch(/project\/harbour: requested \+0s, committed \+10s, release 1 built \+10s, delivered \+10s/);
  });

  it('refreshes the token when a run outlasts it', async () => {
    const w = world();
    // Under the five-minute margin after the first polls.
    w.hub.tokenSeconds = 320;
    const r = await run(w);
    expect(r.code).toBe(0);
    expect(w.hub.calls.filter((c) => c.path.includes('grant_type=refresh_token')).length).toBeGreaterThan(0);
  });

  it('a request that fails validation is reported with its field, and not retried until the manifest changes', async () => {
    const w = world();
    // The fake server's validator is stricter than the dry run's for one field: a changed module.
    const strict = { ...testModule, types: testModule.types.map((t) => (t.name === 'news' ? { ...t, publishValidator: () => ({ safeParse: () => ({ success: false, error: { issues: [{ path: ['date'], message: 'x' }] } }) }) } : t)) };
    (w.hub as unknown as { module: unknown }).module = strict;
    const r = await run(w);
    expect(r.code).toBe(1);
    expect(r.text).toContain('publish failed (failed_validation: invalid_data at /date)');
    const filed = w.hub.count('POST', '/rest/v1/rpc/request_publish');
    const again = await run(w);
    expect(again.text).toContain('not retried until the manifest changes');
    expect(w.hub.count('POST', '/rest/v1/rpc/request_publish')).toBe(filed);
  });
});

describe('import: the report', () => {
  it('names one changed word with five words either side', async () => {
    const w = world((x) => (x.manifest.entries.news[0].data.title = 'One two three four five six seven eight nine ten eleven twelve'));
    let tampered = false;
    w.hub.before = (_n, method, path) => {
      // The report is the only reader of the pointer.
      if (method === 'GET' && path.endsWith('/current.json') && !tampered) {
        tampered = true;
        w.hub.tamperBundle('seven eight', 'seven EIGHT');
      }
    };
    const r = await run(w);
    expect(r.code).toBe(1);
    const diff = report(w).differences.find((d) => d.at === '/title');
    expect(diff).toEqual({
      key: 'news/opening',
      type: 'news',
      at: '/title',
      what: 'text differs',
      expected: 'three four five six seven eight nine ten eleven twelve',
      actual: 'three four five six seven EIGHT nine ten eleven twelve',
    });
    expect(r.text).toContain('news/opening /title: text differs');
    expect(r.text).not.toContain('EIGHT');
  });

  it('names one changed byte in a delivered image', async () => {
    const w = world();
    w.hub.tamperPublic = (path, bytes) => {
      if (!path.endsWith('01.jpg')) return bytes;
      const copy = new Uint8Array(bytes);
      copy[10] = (copy[10] as number) ^ 1;
      return copy;
    };
    const r = await run(w);
    expect(r.code).toBe(1);
    const diffs = report(w).differences.filter((d) => d.what.includes('not the manifest\'s file'));
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.what).toContain('projects/harbour/01.jpg');
  });

  it('a published slug that differs from the manifest, and entries the manifest does not name', async () => {
    const w = world();
    expect((await run(w)).code).toBe(0);
    const extra = w.hub.publishedExtra('project', 'made-by-an-editor', { title: 'Made by an editor' });
    w.manifest.entries.project[0].slug = 'harbour-path-new';
    const r = await run(w);
    expect(r.code).toBe(1);
    const rep = report(w) as ReturnType<typeof report> & { extras: { id: string }[] };
    expect(rep.differences).toEqual([
      { key: 'project/harbour', type: 'project', at: '(slug)', what: 'published slug differs from the manifest', expected: 'harbour-path-new', actual: 'harbour-path' },
    ]);
    expect(rep.extras.map((e) => e.id)).toEqual([extra]);
    expect(w.hub.entries.size).toBe(4);
  });
});

describe('import: signing in and refusals', () => {
  it('stops for an account with a verified second factor', async () => {
    const w = world();
    w.hub.factors = [{ id: 'f', factor_type: 'totp', status: 'verified' }];
    const r = await run(w);
    expect(r.code).toBe(1);
    expect(r.text).toContain('would need a TOTP step-up');
    expect(w.hub.count('POST', '/rest/v1/rpc/')).toBe(0);
  });

  it('stops before writing anything when L1 is not on the target', async () => {
    const w = world();
    w.hub.l1 = false;
    const r = await run(w);
    expect(r.code).toBe(1);
    expect(r.text).toContain('the image library (L1) is not on it; nothing was written');
    expect(w.hub.objects.size).toBe(0);
    expect(w.writes).toEqual([]);
  });

  it('refuses a tenant the editor is not a member of, and an inactive one', async () => {
    const w = world();
    w.hub.member = false;
    expect((await run(w)).text).toContain('is not an editor of tenant acme');
    const v = world();
    v.hub.tenantStatus = 'suspended';
    expect((await run(v)).text).toContain('tenant acme is not active');
  });

  it('refuses a wrong password without printing it', async () => {
    const w = world((x) => (x.password = 'wrong-password-9876'));
    const r = await run(w);
    expect(r.code).toBe(1);
    expect(r.text).toContain('sign-in as editor@example.test');
    expect(r.text).not.toContain('wrong-password-9876');
  });

  it('refuses no password', async () => {
    const w = world((x) => (x.password = null));
    expect((await run(w)).text).toContain('no password');
    expect(w.hub.calls).toEqual([]);
  });

  // Import plan section 2: the password comes from standard input only, never the environment.
  it('points the operator at standard input only, never an environment variable', async () => {
    const r = await run(world((x) => (x.password = null)));
    const failure = r.text.split('\n').find((l) => l.includes('no password')) ?? '';
    expect(failure).toContain('pipe or type it on standard input');
    for (const text of [failure, IMPORT_USAGE]) {
      expect(text).not.toMatch(/CMS_IMPORT_PASSWORD|environment|\bset\b/i);
    }
    expect(IMPORT_USAGE).toContain('the password is read from standard input only');
  });

  it('refuses an env file for another project, and never reads the secret key', async () => {
    const w = world();
    const r = await run(w, []);
    expect(r.code).toBe(0);
    const other = world();
    const out: string[] = [];
    const code = await runImport(
      ['--tenant', 'acme', '--manifest', MANIFEST, '--media', MEDIA, '--email', EMAIL, '--expect-ref', 'zzzzzzzzzzzzzzzzzzzz', `--env-file=${ENV_FILE}`],
      { log: (l) => out.push(l), error: (l) => out.push(l) },
      {
        ...({} as ImportDeps),
        fetch: other.hub.fetch,
        readTextFile: async (p) => (p === ENV_FILE ? ENV : JSON.stringify(other.manifest)),
        lstat: (p) => other.media.lstat(p),
        readBytes: (p) => other.media.readBytes(p),
        inspectImage: (await import('./import-fixture.ts')).fakeInspect,
        loadModule: async () => testModule,
        readPassword: async () => PASSWORD,
      },
    );
    expect(code).toBe(1);
    expect(out.join('\n')).toContain(`points at ${REF}.supabase.co, not zzzzzzzzzzzzzzzzzzzz.supabase.co; nothing was sent`);
    expect(other.hub.calls).toEqual([]);
  });

  it('refuses a ledger it cannot read, and leaves it as it is', async () => {
    const w = world();
    w.files.set(LEDGER, '{ not json');
    const r = await run(w);
    expect(r.code).toBe(1);
    expect(r.text).toContain('is not valid JSON; it was left as it is');
    expect(w.files.get(LEDGER)).toBe('{ not json');
  });

  it('usage: --local needs --env-file; --expect-ref and --local exclude each other; batch size 1 to 9', async () => {
    const usage = async (args: string[]) => {
      const err: string[] = [];
      const code = await runImport(args, { log: () => {}, error: (l) => err.push(l) }, {} as ImportDeps);
      return { code, text: err.join('\n') };
    };
    const base = ['--tenant', 'acme', '--manifest', MANIFEST, '--media', MEDIA, '--email', EMAIL];
    expect(await usage([...base, '--local'])).toMatchObject({ code: 2, text: expect.stringContaining('--local needs --env-file') });
    expect(await usage([...base, '--local', '--expect-ref', REF])).toMatchObject({ code: 2, text: expect.stringContaining('exactly one of --expect-ref and --local') });
    expect(await usage([...base, '--expect-ref', REF, '--batch-size', '10'])).toMatchObject({ code: 2, text: expect.stringContaining('--batch-size must be 1 to 9') });
    expect(await usage([...base, '--expect-ref', REF, '--manifest', 'x'])).toMatchObject({ code: 2 });
    expect(await usage(['--tenant', 'acme', '--manifest', 'relative.json', '--media', MEDIA, '--dry-run'])).toMatchObject({ code: 2, text: expect.stringContaining('absolute') });
  });

  it('is routed by the CLI', async () => {
    const err: string[] = [];
    expect(await runCli(['import', '--tenant', 'acme'], { log: () => {}, error: (l) => err.push(l) })).toBe(1);
    expect(err[0]).toContain('import: no network, file or password access was given');
  });
});
