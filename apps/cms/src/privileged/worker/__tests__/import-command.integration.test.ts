// The `import` command (tools/cli, docs/plans/import.md section 4) against the local stack, into the
// demo tenant with its module, signed in as editor_demo with its password. It lives beside the
// worker's tests because the import only files requests: its waits are replaced here by the real
// sweep, which a test may run with the stack's secret key. The importer itself never sees that key:
// its env file names the local URL and the publishable key only, through --local (decision 3).
//
// The sweep is the worker's, so the file gives it the worker's environment as the other worker tests
// do (the stack's URL and secret key, stubbed for this file only); the importer reads neither.
//
// Needs L1 on the local stack (api.asset_summary, update_asset_text, asset_list's caption, credit and
// thumb_path): without it every run stops at the probe, which the first test asserts instead.
// A local bundle delivers its images at the stack's own http address (enhancement A4), so the
// report's file half is checked here as on a hosted project: the delivered bytes are the manifest's.
//
// The importer gets L2's thumbnail maker as main.ts passes it (the same module an editor's upload
// runs), and the demo module's `partner` type is ordered by hand (A12): the import puts partners in
// the manifest's order through api.move_entry, and the delivered bundle lists them so.
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runImport, type ImportDeps } from '../../../../../../tools/cli/src/import.ts';
import { LOCAL_ORIGINS } from '../../../../../../tools/cli/src/local.ts';
import { assetIdFor, imageInspector } from '../../../../../../tools/cli/src/import/media.ts';
import { makeThumbnail, thumbnailPath } from '@/editor/server/thumbnail-maker';
import { getModule } from '@/modules/registry';
import { editorClient } from '../../../../../../tests/integration/src/clients.ts';
import { env } from '../../../../../../tests/integration/src/env.ts';
import { PERSONAS, PERSONA_PASSWORD, TENANT } from '../../../../../../tests/integration/src/fixtures.ts';
import { closeAll } from '../../../../../../tests/integration/src/sql.ts';
import { sweep } from '../pipeline';

/** This slot's stack: --local accepts either slot's own address (tools/cli/src/local.ts). */
const LOCAL = env.apiUrl.replace(/\/+$/, '');
const ENV_FILE = '/import-test/.env.local-import';
const MEDIA = '/import-test/media';
/** The live checks' poll and timeout in the sweep (as the pipeline tests); the demo site is not running here. */
const FAST = { pollMs: 100, timeoutMs: 15_000 };
/** Sweeps one run may ask for before the test gives up on the queue (one per wave is the norm). */
const MAX_SWEEPS = 20;

let editor: SupabaseClient;
let jpeg: Uint8Array;
let png: Uint8Array;

beforeAll(async () => {
  expect(LOCAL_ORIGINS).toContain(LOCAL);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', env.apiUrl);
  vi.stubEnv('SUPABASE_SECRET_KEY', env.secretKey);
  editor = await editorClient('editor_demo');
  jpeg = new Uint8Array(await sharp({ create: { width: 16, height: 12, channels: 3, background: { r: 10, g: 90, b: 200 } } }).jpeg().toBuffer());
  png = new Uint8Array(await sharp({ create: { width: 9, height: 9, channels: 3, background: { r: randomByte(), g: 1, b: 2 } } }).png().toBuffer());
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeAll();
});

function randomByte(): number {
  return Math.floor(Math.random() * 256);
}
const sha = async (b: Uint8Array) => (await import('node:crypto')).createHash('sha256').update(b).digest('hex');

interface Fixture {
  manifestPath: string;
  manifest: Record<string, any>;
  files: Map<string, Uint8Array>;
  store: Map<string, string>;
}

/** A small manifest with its own run id, so slugs never meet earlier runs' entries. */
async function fixture(change: (m: Record<string, any>, id: string) => void = () => {}): Promise<Fixture> {
  const id = randomUUID().slice(0, 8);
  const siteInfo = await editor.schema('api').rpc('create_singleton_entry', { p_tenant_id: TENANT.demo, p_type: 'site-info', p_schema_version: 1 });
  const detail = await editor.schema('api').rpc('entry_detail_by_id', { p_entry_id: siteInfo.data });
  // The demo singleton is shared across tests: the manifest gives it exactly the data it holds, or a fresh one.
  const singletonData = detail.data && Object.keys(detail.data.data ?? {}).length > 0 ? detail.data.data : { title: 'Demo', tagline: 'Imported' };
  const manifest: Record<string, any> = {
    format: 1,
    files: [
      { path: `run-${id}/a.jpg`, sha256: await sha(jpeg), bytes: jpeg.byteLength, alt: 'Blue', caption: 'A caption', credit: 'Test' },
      { path: `run-${id}/b.png`, sha256: await sha(png), bytes: png.byteLength },
    ],
    entries: {
      event: [
        {
          key: `event/${id}/a`,
          slug: `import-${id}-a`,
          data: {
            title: `Import ${id} a`,
            startDate: '2019-06-01',
            description: {
              type: 'doc',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Word for word.' }] },
                { type: 'image', attrs: { asset: { $file: `run-${id}/a.jpg` } } },
              ],
            },
          },
        },
        {
          key: `event/${id}/b`,
          slug: `import-${id}-b`,
          data: { title: `Import ${id} b`, startDate: '2019-07-01', related: { $entry: `event/${id}/a` }, program: { highlights: [{ value: { $entry: `event/${id}/a` } }] } },
        },
      ],
    },
    singletons: { 'site-info': { key: 'site-info', data: singletonData } },
  };
  change(manifest, id);
  const files = new Map([
    [`${MEDIA}/run-${id}/a.jpg`, jpeg],
    [`${MEDIA}/run-${id}/b.png`, png],
  ]);
  return { manifestPath: `/import-test/manifest-${id}.json`, manifest, files, store: new Map() };
}

interface Run {
  code: number;
  text: string;
  calls: string[];
  /** Whether `killAfter` fired. */
  killed: boolean;
}

interface Hooks {
  beforeCall?: (path: string) => Promise<void> | void;
  /** True for the call after whose response the connection dies: its answer is lost, and every later call is refused. */
  killAfter?: (path: string, body: unknown) => boolean;
}

/** A request's JSON body, or null (an upload's bytes, no body). */
function jsonBody(body: unknown): unknown {
  if (typeof body !== 'string') return null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

async function run(f: Fixture, hooks: Hooks = {}): Promise<Run> {
  const out: string[] = [];
  const calls: string[] = [];
  let killed = false;
  let sweeps = 0;
  const dirs = (p: string) => p === MEDIA || [...f.files.keys()].some((k) => k.startsWith(`${p}/`));
  const deps: ImportDeps = {
    fetch: async (url, init) => {
      if (killed) throw Object.assign(new Error('killed'), { cause: { code: 'ECONNREFUSED' } });
      const path = new URL(url).pathname;
      calls.push(`${init.method ?? 'GET'} ${path}`);
      await hooks.beforeCall?.(path);
      const response = await fetch(url, init);
      if (hooks.killAfter?.(path, jsonBody(init.body))) {
        killed = true;
        throw Object.assign(new Error('killed'), { cause: { code: 'ECONNRESET' } });
      }
      return response;
    },
    readTextFile: async (p) => {
      if (p === ENV_FILE) return `NEXT_PUBLIC_SUPABASE_URL=${LOCAL}\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${env.publishableKey}\n`;
      if (p === f.manifestPath) return JSON.stringify(f.manifest);
      throw new Error('ENOENT');
    },
    lstat: async (p) => (f.files.has(p) ? { kind: 'file', size: (f.files.get(p) as Uint8Array).byteLength } : dirs(p) ? { kind: 'directory', size: 0 } : null),
    readBytes: async (p) => {
      const b = f.files.get(p);
      if (b === undefined) throw new Error('ENOENT');
      return b;
    },
    read: async (p) => f.store.get(p) ?? null,
    write: async (p, text) => void f.store.set(p, text),
    readPassword: async () => PERSONA_PASSWORD,
    inspectImage: imageInspector((bytes) => sharp(bytes).metadata()),
    thumbnail: async (bytes, tenantId, assetId) => {
      const made = await makeThumbnail(bytes);
      return made === null ? null : { bytes: made, path: thumbnailPath(tenantId, assetId) };
    },
    loadModule: async (slug) => {
      const m = getModule(slug);
      if (m === undefined) throw new Error('no module');
      return m;
    },
    now: () => Date.now(),
    // The importer's waits run the worker's sweep instead. A step that fails (another tenant's
    // retry, say) is shown in the output and the import polls on, as it would beside a real cron.
    sleep: async () => {
      if (++sweeps > MAX_SWEEPS) {
        out.push(`[test] ${MAX_SWEEPS} sweeps did not settle the queue`);
        throw new Error('the queue did not settle');
      }
      try {
        await sweep(FAST);
      } catch (e) {
        if (!(e instanceof AggregateError)) throw e;
        out.push(`[test] sweep: ${e.message}: ${e.errors.map((x) => (x instanceof Error ? x.message : String(x))).join('; ')}`);
      }
    },
  };
  const code = await runImport(
    ['--tenant', 'demo', '--manifest', f.manifestPath, '--media', MEDIA, '--email', PERSONAS.editor_demo.email, '--local', `--env-file=${ENV_FILE}`],
    { log: (l) => out.push(l), error: (l) => out.push(l) },
    deps,
  );
  const text = out.join('\n');
  expect(text).not.toContain(PERSONA_PASSWORD);
  expect(text).not.toContain(env.secretKey);
  return { code, text, calls, killed };
}

const reportOf = (f: Fixture) => JSON.parse(f.store.get(`${f.manifestPath}.local.demo.report.json`) as string);
/** The entry id the ledger holds for the key ending in `suffix`, or undefined. */
const ledgerId = (f: Fixture, suffix: string): string | undefined => {
  const text = f.store.get(`${f.manifestPath}.local.demo.ledger.json`);
  if (text === undefined) return undefined;
  return Object.entries(JSON.parse(text).entries as Record<string, { id: string }>).find(([key]) => key.endsWith(suffix))?.[1].id;
};
const countCalls = (r: Run, fn: string) => r.calls.filter((c) => c.endsWith(`/rpc/${fn}`)).length;

/** The ids of `type` in the order the demo tenant's current public bundle lists them, and its release. */
async function delivered(type: string): Promise<{ release: number; ids: string[] }> {
  const base = `${LOCAL}/storage/v1/object/public/delivery/demo`;
  const pointer = (await (await fetch(`${base}/current.json`, { cache: 'no-store' })).json()) as { release: number; bundle: string };
  const bundle = (await (await fetch(`${base}/${pointer.bundle}`, { cache: 'no-store' })).json()) as { entries: Record<string, { id: string }[]> };
  return { release: pointer.release, ids: (bundle.entries[type] ?? []).map((e) => e.id) };
}

describe('import against the local stack (demo tenant)', () => {
  it('a full run, then a second run that creates nothing', async () => {
    const f = await fixture();
    const first = await run(f);
    expect(first.text).not.toContain('the image library (L1) is not on it');
    expect(first.code, first.text).toBe(0);
    const report = reportOf(f);
    expect(report.differences).toEqual([]);
    expect(report.checked.entries).toBe(3);
    // The one rich-text image use is delivered at the local stack's address and its bytes compared.
    expect(report.checked.files).toBe(1);
    expect(JSON.stringify(report.unchecked)).not.toContain('image');
    expect(first.calls.some((c) => c.includes('/rpc/admin_') || c.includes('/rpc/worker_'))).toBe(false);

    // Both files got their thumbnail from L2's maker, at the one path it may have.
    for (const [name, bytes] of [['a.jpg', jpeg], ['b.png', png]] as const) {
      const id = assetIdFor(TENANT.demo, await sha(bytes));
      const { data, error } = await editor.schema('api').from('asset_list').select('thumb_path').eq('id', id).single();
      expect(error, name).toBeNull();
      expect(data?.thumb_path, name).toBe(thumbnailPath(TENANT.demo, id));
    }
    expect(first.text).not.toContain('comes with L2');

    const second = await run(f);
    expect(second.code, second.text).toBe(0);
    for (const fn of ['create_entry', 'register_asset', 'save_draft', 'request_publish', 'update_asset_text', 'set_asset_thumbnail']) expect(countCalls(second, fn), fn).toBe(0);
  });

  it("partners, ordered by hand: delivered in the manifest's order, and a second run moves nothing", async () => {
    const f = await fixture((m, id) => {
      // Four partners, listed in the order the site must show; an order section moves the last to the front.
      m.entries.partner = ['a', 'b', 'c', 'd'].map((x) => ({ key: `partner/${id}/${x}`, data: { title: `Partner ${id} ${x}` } }));
      m.order = { partner: [`partner/${id}/d`] };
    });
    const id = f.manifestPath.match(/manifest-([0-9a-f]{8})\.json$/)?.[1] as string;
    const wantedKeys = ['d', 'a', 'b', 'c'].map((x) => `partner/${id}/${x}`);
    const first = await run(f);
    expect(first.code, first.text).toBe(0);
    const wanted = wantedKeys.map((k) => ledgerId(f, k) as string);
    expect(wanted.every((x) => typeof x === 'string')).toBe(true);
    // The moves came before the first publish request of the run.
    const lastMove = first.calls.map((c) => c.endsWith('/rpc/move_entry')).lastIndexOf(true);
    expect(lastMove).toBeGreaterThan(-1);
    expect(lastMove).toBeLessThan(first.calls.findIndex((c) => c.endsWith('/rpc/request_publish')));
    const once = await delivered('partner');
    expect(once.ids.filter((x) => wanted.includes(x))).toEqual(wanted);
    const rep = reportOf(f);
    expect(rep.differences).toEqual([]);
    expect(rep.checked.orders).toBe(1);

    const second = await run(f);
    expect(second.code, second.text).toBe(0);
    expect(countCalls(second, 'move_entry')).toBe(0);
    expect(countCalls(second, 'request_publish')).toBe(0);
    expect(second.text).toContain("order partner: already in the manifest's order; nothing moved");
    const twice = await delivered('partner');
    expect(twice.ids.filter((x) => wanted.includes(x))).toEqual(wanted);
    expect(reportOf(f).differences).toEqual([]);
  });

  it('a run killed mid-wave and resumed', async () => {
    const f = await fixture();
    // Dies right after the second wave's first publish request, event b's, is filed: its answer is
    // lost. Chosen by what the call is, not by its number: how many polls a wave takes is the sweep's.
    const killed = await run(f, {
      killAfter: (path, body) =>
        path.endsWith('/rpc/request_publish') && (body as { p_entry_id?: unknown } | null)?.p_entry_id === ledgerId(f, '/b'),
    });
    expect(killed.killed, killed.text).toBe(true);
    expect(killed.code, killed.text).toBe(1);
    const resumed = await run(f);
    expect(resumed.code, resumed.text).toBe(0);
    expect(reportOf(f).differences).toEqual([]);
    expect(countCalls(resumed, 'create_entry')).toBe(0);
    // The request whose answer was lost is waited for, not filed again; wave 1 was done before the kill.
    expect(countCalls(resumed, 'request_publish')).toBe(0);
    expect(resumed.text).toMatch(/publish event\/[0-9a-f]{8}\/b: delivered in release \d+/);
  });

  it('an editor save that moves a slug before publish: reported, not published', async () => {
    const f = await fixture();
    // The editor's calls, checked after the run: anything thrown inside the importer's fetch would
    // reach it as a network error.
    const edits: { step: string; error: unknown }[] = [];
    const r = await run(f, {
      beforeCall: async (path) => {
        if (edits.length > 0 || !path.endsWith('/rpc/request_publish')) return;
        // As the editor's autosave and auto-slug would: a save of event b, then its slug from the new title.
        const b = ledgerId(f, '/b') as string;
        const detail = await editor.schema('api').rpc('entry_detail_by_id', { p_entry_id: b });
        edits.push({ step: 'entry_detail_by_id', error: detail.error });
        const saved = await editor.schema('api').rpc('save_draft', {
          p_entry_id: b,
          p_expected_version: detail.data?.draft_version,
          p_data: { ...detail.data?.data, title: 'Moved' },
          p_schema_version: 1,
          p_title: 'Moved',
          p_sort_at: null,
        });
        edits.push({ step: 'save_draft', error: saved.error });
        const moved = await editor.schema('api').rpc('set_slug', { p_entry_id: b, p_slug: `moved-${randomUUID().slice(0, 8)}` });
        edits.push({ step: 'set_slug', error: moved.error });
      },
    });
    expect(edits).toEqual([
      { step: 'entry_detail_by_id', error: null },
      { step: 'save_draft', error: null },
      { step: 'set_slug', error: null },
    ]);
    expect(r.code, r.text).toBe(1);
    expect(r.text).toMatch(/NOT TOUCHED event\/[0-9a-f]{8}\/b:/);
    expect(reportOf(f).differences.some((d: { key: string }) => d.key.endsWith('/b'))).toBe(true);
  });

  it('a cycle: published without the optional reference first, then with it', async () => {
    const f = await fixture((m, id) => {
      m.entries.event[0].data.related = { $entry: `event/${id}/b` };
    });
    const r = await run(f);
    expect(r.code, r.text).toBe(0);
    expect(r.text).toContain('second pass');
    expect(reportOf(f).differences).toEqual([]);
  });

  it('the singleton is opened through its own function, never create_entry', async () => {
    const f = await fixture();
    const r = await run(f);
    expect(r.code, r.text).toBe(0);
    expect(countCalls(r, 'create_singleton_entry')).toBe(1);
    expect(countCalls(r, 'create_entry')).toBe(2);
  });
});
