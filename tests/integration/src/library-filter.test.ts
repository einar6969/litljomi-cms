// The media library's search, filters and sort with real editor sessions (docs/plans/media-library.md
// sections 6.1 and 8, slice L4). The query is built by the CMS's own applyLibraryFilter and
// orderLibrary and sent through PostgREST as each persona, so RLS on the security_invoker view
// api.asset_list is what keeps the library inside the editor's tenant. Every file name carries a
// per-run token: the local database keeps earlier runs' files.
import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyLibraryFilter, orderLibrary, type LibraryState } from '../../../apps/cms/src/editor/media/library-filter.ts';
import { editorClient } from './clients.ts';
import { TENANT, type PersonaName } from './fixtures.ts';
import { closeAll, withTx } from './sql.ts';

type Editor = Extract<PersonaName, 'editor_labak' | 'editor_demo'>;

const token = randomBytes(4).toString('hex');

const one = async <T>(c: pg.Client, text: string, params: unknown[] = []): Promise<T> => {
  const { rows } = await c.query(text, params);
  return Object.values(rows[0] as Record<string, unknown>)[0] as T;
};

const rpc = async (as: Editor, fn: string, args: Record<string, unknown>) => {
  const { error } = await (await editorClient(as)).schema('api').rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.code} ${error.message}`);
};

/** Registers a file the way the upload action does, with its three texts, and returns its id. */
async function file(as: Editor, name: string, bytes: number, texts: { alt?: string; caption?: string; credit?: string } = {}): Promise<string> {
  const tenantId = as === 'editor_labak' ? TENANT.labak : TENANT.demo;
  const id = randomUUID();
  const filename = `${name}-${token}.jpg`;
  await rpc(as, 'register_asset', {
    p_asset_id: id,
    p_tenant_id: tenantId,
    p_original_path: `${tenantId}/${id}/${filename}`,
    p_filename: filename,
    p_mime: 'image/jpeg',
    p_bytes: bytes,
    p_width: 800,
    p_height: 600,
    p_sha256: 'a'.repeat(64),
  });
  await rpc(as, 'update_asset_text', { p_asset_id: id, p_default_alt: texts.alt ?? null, p_caption: texts.caption ?? null, p_credit: texts.credit ?? null });
  return id;
}

const ids: Record<string, string> = {};

beforeAll(async () => {
  // Registered one after another, so created_at orders them a, b, c.
  ids.a = await file('editor_labak', 'arfur', 3000, { alt: 'Rúgbrauð á borði', caption: `Nýbakað 100% ${token}` });
  ids.b = await file('editor_labak', 'baka', 1000);
  ids.c = await file('editor_labak', 'ceres', 2000, { alt: 'Kleina', credit: 'Þóra Ægisdóttir' });
  ids.taken = await file('editor_labak', 'dagur', 500);
  await rpc('editor_labak', 'archive_asset', { p_asset_id: ids.taken });
  ids.demo = await file('editor_demo', 'arfur', 3000, { caption: `Nýbakað 100% ${token}` });
  // b is used by the draft of a labak news entry.
  const entry = await withTx('editor_labak', (e) => one<string>(e, `select api.create_entry($1, 'news')`, [TENANT.labak]));
  const title = `Bökufrétt ${token}`;
  await withTx('editor_labak', (e) => e.query('select api.save_draft($1, 1, $2, 1, $3, null)', [entry, { title, gallery: [{ _ref: ids.b, _kind: 'asset', alt: '' }] }, title]));
});

afterAll(closeAll);

const DEFAULT: LibraryState = { q: '', filter: null, sort: 'newest', view: 'grid', page: 1, file: null };

/** The ids the persona's library lists for the state, in its order, among this run's files. No tenant filter: RLS alone scopes it. */
async function listed(as: PersonaName, change: Partial<LibraryState> = {}): Promise<string[]> {
  const state = { ...DEFAULT, ...change };
  const query = (await editorClient(as)).schema('api').from('asset_list').select('id').ilike('filename', `%-${token}.jpg`);
  const { data, error } = await orderLibrary(applyLibraryFilter(query, state), state.sort);
  expect(error).toBeNull();
  return (data as { id: string }[]).map((r) => r.id);
}

const named = (...keys: string[]) => keys.map((k) => ids[k]);

describe('the library query through PostgREST', () => {
  it("lists the editor's own files that are not taken out, newest first", async () => {
    expect(await listed('editor_labak')).toEqual(named('c', 'b', 'a'));
    expect(await listed('editor_demo')).toEqual(named('demo'));
  });

  it('orders oldest first, by name and largest first', async () => {
    expect(await listed('editor_labak', { sort: 'oldest' })).toEqual(named('a', 'b', 'c'));
    expect(await listed('editor_labak', { sort: 'name' })).toEqual(named('a', 'b', 'c'));
    expect(await listed('editor_labak', { sort: 'largest' })).toEqual(named('a', 'c', 'b'));
  });

  it('searches file name, alt text, caption and credit, with % as itself, within the tenant', async () => {
    expect(await listed('editor_labak', { q: 'CERES' })).toEqual(named('c'));
    expect(await listed('editor_labak', { q: 'rúgbrauð' })).toEqual(named('a'));
    expect(await listed('editor_labak', { q: `100% ${token}` })).toEqual(named('a'));
    expect(await listed('editor_labak', { q: 'þóra ægis' })).toEqual(named('c'));
    expect(await listed('editor_labak', { q: '0%-' })).toEqual([]);
    expect(await listed('editor_demo', { q: `100% ${token}` })).toEqual(named('demo'));
  });

  it('narrows to images missing their alt text, and to unused files', async () => {
    expect(await listed('editor_labak', { filter: 'missing-alt' })).toEqual(named('b'));
    expect(await listed('editor_labak', { filter: 'unused' })).toEqual(named('c', 'a'));
    expect(await listed('editor_labak', { filter: 'unused', q: 'kleina' })).toEqual(named('c'));
  });

  it('gives an editor of no tenant and a platform admin without membership nothing', async () => {
    for (const as of ['outsider', 'platform_admin'] as const) expect(await listed(as), as).toEqual([]);
  });
});
