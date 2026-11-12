// The `import` command (tools/cli, docs/plans/import.md section 4) against the local stack, into the
// demo tenant with its module, signed in as editor_demo with its password. It lives beside the
// worker's tests because the import only files requests: its waits are replaced here by the real
// sweep, which a test may run with the stack's secret key. The importer itself never sees that key:
// its env file names the local URL and the publishable key only, through --local (decision 3).
//
// Needs L1 on the local stack (api.asset_summary, update_asset_text, asset_list's caption, credit and
// thumb_path): without it every run stops at the probe, which the first test asserts instead.
// A local bundle delivers every image as null (A4), so the report's file half is unchecked here and
// the test asserts that count rather than a pass.
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runImport, type ImportDeps } from '../../../../../../tools/cli/src/import.ts';
import { imageInspector } from '../../../../../../tools/cli/src/import/media.ts';
import { getModule } from '@/modules/registry';
import { editorClient } from '../../../../../../tests/integration/src/clients.ts';
import { env } from '../../../../../../tests/integration/src/env.ts';
import { PERSONAS, PERSONA_PASSWORD, TENANT } from '../../../../../../tests/integration/src/fixtures.ts';
import { closeAll } from '../../../../../../tests/integration/src/sql.ts';
import { sweep } from '../pipeline';

const LOCAL = 'http://127.0.0.1:54321';
const ENV_FILE = '/import-test/.env.local-import';
const MEDIA = '/import-test/media';

let editor: SupabaseClient;
let jpeg: Uint8Array;
let png: Uint8Array;

beforeAll(async () => {
  expect(env.apiUrl.replace(/\/+$/, '')).toBe(LOCAL);
  editor = await editorClient('editor_demo');
  jpeg = new Uint8Array(await sharp({ create: { width: 16, height: 12, channels: 3, background: { r: 10, g: 90, b: 200 } } }).jpeg().toBuffer());
  png = new Uint8Array(await sharp({ create: { width: 9, height: 9, channels: 3, background: { r: randomByte(), g: 1, b: 2 } } }).png().toBuffer());
});
afterAll(async () => {
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
}

async function run(f: Fixture, hooks: { beforeCall?: (path: string, n: number) => Promise<void> | void; killAfter?: number } = {}): Promise<Run> {
  const out: string[] = [];
  const calls: string[] = [];
  let killed = false;
  const dirs = (p: string) => p === MEDIA || [...f.files.keys()].some((k) => k.startsWith(`${p}/`));
  const deps: ImportDeps = {
    fetch: async (url, init) => {
      if (killed) throw Object.assign(new Error('killed'), { cause: { code: 'ECONNREFUSED' } });
      const path = new URL(url).pathname;
      calls.push(`${init.method ?? 'GET'} ${path}`);
      await hooks.beforeCall?.(path, calls.length);
      const response = await fetch(url, init);
      if (hooks.killAfter !== undefined && calls.length >= hooks.killAfter) {
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
    loadModule: async (slug) => {
      const m = getModule(slug);
      if (m === undefined) throw new Error('no module');
      return m;
    },
    now: () => Date.now(),
    sleep: async () => {
      await sweep();
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
  return { code, text, calls };
}

const reportOf = (f: Fixture) => JSON.parse(f.store.get(`${f.manifestPath}.local.demo.report.json`) as string);
const countCalls = (r: Run, fn: string) => r.calls.filter((c) => c.endsWith(`/rpc/${fn}`)).length;

describe('import against the local stack (demo tenant)', () => {
  it('a full run, then a second run that creates nothing', async () => {
    const f = await fixture();
    const first = await run(f);
    expect(first.text).not.toContain('the image library (L1) is not on it');
    expect(first.code, first.text).toBe(0);
    const report = reportOf(f);
    expect(report.differences).toEqual([]);
    expect(report.checked.entries).toBe(3);
    // Local images are delivered as null until A4: one rich-text image use, counted as unchecked.
    expect(report.unchecked).toContainEqual({ what: 'image uses not compared on the local stack (local images are delivered as null until A4)', count: 1 });
    expect(first.calls.some((c) => c.includes('/rpc/admin_') || c.includes('/rpc/worker_'))).toBe(false);

    const second = await run(f);
    expect(second.code, second.text).toBe(0);
    for (const fn of ['create_entry', 'register_asset', 'save_draft', 'request_publish', 'update_asset_text']) expect(countCalls(second, fn), fn).toBe(0);
  });

  it('a run killed mid-wave and resumed', async () => {
    const f = await fixture();
    // Dies right after the second wave's first publish request is filed (its answer is lost).
    let publishes = 0;
    let killAt: number | undefined;
    const killed = await run(f, {
      beforeCall: (path, call) => {
        if (path.endsWith('/rpc/request_publish') && ++publishes === 2) killAt = call;
      },
      killAfter: undefined,
    });
    // The hook above only measures; the same manifest in a fresh tenant state would differ, so the
    // kill is replayed on a second fixture at the same call number.
    expect(killed.code, killed.text).toBe(0);
    expect(killAt).toBeDefined();
    const g = await fixture();
    expect((await run(g, { killAfter: killAt })).code).toBe(1);
    const resumed = await run(g);
    expect(resumed.code, resumed.text).toBe(0);
    expect(reportOf(g).differences).toEqual([]);
    expect(countCalls(resumed, 'create_entry')).toBe(0);
    // The request whose answer was lost is waited for, not filed again: one more for the singleton at most.
    expect(countCalls(resumed, 'request_publish')).toBeLessThanOrEqual(1);
  });

  it('an editor save that moves a slug before publish: reported, not published', async () => {
    const f = await fixture();
    let done = false;
    const r = await run(f, {
      beforeCall: async (path) => {
        if (done || !path.endsWith('/rpc/request_publish')) return;
        done = true;
        // As the editor's autosave and auto-slug would: a save of event b, then its slug from the new title.
        const ledger = JSON.parse(f.store.get(`${f.manifestPath}.local.demo.ledger.json`) as string);
        const b = Object.entries(ledger.entries as Record<string, { id: string }>).find(([key]) => key.endsWith('/b'))?.[1].id as string;
        const detail = (await editor.schema('api').rpc('entry_detail_by_id', { p_entry_id: b })).data;
        await editor.schema('api').rpc('save_draft', { p_entry_id: b, p_expected_version: detail.draft_version, p_data: { ...detail.data, title: 'Moved' }, p_schema_version: 1, p_title: 'Moved', p_sort_at: null });
        await editor.schema('api').rpc('set_slug', { p_entry_id: b, p_slug: `moved-${randomUUID().slice(0, 8)}` });
      },
    });
    expect(r.code).toBe(1);
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
