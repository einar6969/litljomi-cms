// The entry list's title search and status filter with real editor sessions (spec §10.1, §4.5;
// plan M2-10). The query is built by the CMS's own applyEntryListFilter and sent through PostgREST
// as each persona, so RLS on the security_invoker view api.entry_list is what keeps a search
// inside the editor's tenant. Every title carries a per-run token: the local database keeps
// earlier runs' entries.
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyEntryListFilter, type EntryListFilter } from '../../../apps/cms/src/editor/entry-list-filter.ts';
import { editorClient } from './clients.ts';
import { TENANT, type PersonaName } from './fixtures.ts';
import { closeAll, ownerQuery, withTx } from './sql.ts';

const one = async <T>(c: pg.Client, text: string, params: unknown[] = []): Promise<T> => {
  const { rows } = await c.query(text, params);
  return Object.values(rows[0] as Record<string, unknown>)[0] as T;
};

const token = randomBytes(4).toString('hex');

type Editor = Extract<PersonaName, 'editor_labak' | 'editor_demo'>;

// A news entry of the editor's tenant whose draft (version 2) has the title.
const entry = (as: Editor, tenantId: string, title: string) =>
  withTx(as, async (e) => {
    const id = await one<string>(e, `select api.create_entry($1, 'news')`, [tenantId]);
    await e.query(`select api.save_draft($1, 1, $2, 1, $3, null)`, [id, { title }, title]);
    return id;
  });

// Claims the request and commits it as the worker. Claims every pending request (leftovers from
// earlier runs included), as concurrency.test.ts does, so the claim is deterministic.
const commitRequest = async (commit: string, params: unknown[]) => {
  await withTx('service', (w) => w.query('select api.worker_claim_requests(1000)'));
  expect(await withTx('service', (w) => one<string>(w, commit, params))).toBe('committed');
};

const publish = async (as: Editor, id: string) => {
  const r = await withTx(as, (e) => one<string>(e, 'select api.request_publish($1, 2)', [id]));
  await commitRequest(`select api.worker_commit_publish($1, 2, 1, 'T', now())`, [r]);
};

const unpublish = async (as: Editor, id: string) => {
  const r = await withTx(as, (e) => one<string>(e, 'select api.request_unpublish($1)', [id]));
  await commitRequest('select api.worker_commit_unpublish($1)', [r]);
};

const ids: Record<string, string> = {};

beforeAll(async () => {
  // labak: one entry in each of the five states, titles with Icelandic capitals.
  ids.draft = await entry('editor_labak', TENANT.labak, `Þórubakarí uppkast ${token}`);
  ids.published = await entry('editor_labak', TENANT.labak, `Þórubakarí birt ${token}`);
  await publish('editor_labak', ids.published);
  ids.changed = await entry('editor_labak', TENANT.labak, `Þórubakarí breytt ${token}`);
  await publish('editor_labak', ids.changed);
  await withTx('editor_labak', (e) => e.query(`select api.save_draft($1, 2, $2, 1, $3, null)`, [ids.changed, { title: 'x' }, `Þórubakarí breytt ${token}`]));
  ids.unpublished = await entry('editor_labak', TENANT.labak, `Þórubakarí tekið af vef ${token}`);
  await publish('editor_labak', ids.unpublished);
  await unpublish('editor_labak', ids.unpublished);
  ids.archived = await entry('editor_labak', TENANT.labak, `Þórubakarí gamalt ${token}`);
  await withTx('editor_labak', (e) => e.query('select api.archive_entry($1)', [ids.archived]));
  ids.other = await entry('editor_labak', TENANT.labak, `Kleinur ${token}`);
  // demo: an entry with the same words in its title, and one published.
  ids.demo = await entry('editor_demo', TENANT.demo, `Þórubakarí uppkast ${token}`);
  ids.demoPublished = await entry('editor_demo', TENANT.demo, `Þórubakarí birt ${token}`);
  await publish('editor_demo', ids.demoPublished);
});

afterAll(closeAll);

// The ids the persona's list returns for the filter. No tenant_id condition: RLS alone scopes it.
const list = async (as: PersonaName, filter: EntryListFilter): Promise<string[]> => {
  const query = (await editorClient(as)).schema('api').from('entry_list').select('id, tenant_id').eq('type', 'news');
  const { data, error } = await applyEntryListFilter(query, filter).order('id');
  expect(error).toBeNull();
  return (data as { id: string }[]).map((r) => r.id).sort();
};
const sorted = (...keys: string[]) => keys.map((k) => ids[k] as string).sort();

describe('entry list search and status filter (M2-10)', () => {
  it('the arranged entries have the states the filter is tested with', async () => {
    const rows = await ownerQuery<{ id: string; status: string; first_published_at: string | null }>(
      'select id, status, first_published_at from api.entry_list where id = any($1)',
      [Object.values(ids)],
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(ids.draft as string)).toMatchObject({ status: 'draft', first_published_at: null });
    expect(byId.get(ids.unpublished as string)?.status).toBe('draft');
    expect(byId.get(ids.unpublished as string)?.first_published_at).not.toBeNull();
    expect(byId.get(ids.changed as string)?.status).toBe('changed');
  });

  it('searches titles case-insensitively, Icelandic letters included, within the editor\'s tenant', async () => {
    const q = `þórubakarí`;
    expect((await list('editor_labak', { q, status: null })).filter((id) => Object.values(ids).includes(id))).toEqual(
      sorted('draft', 'published', 'changed', 'unpublished'),
    );
    expect(await list('editor_labak', { q: `ÞÓRUBAKARÍ UPPKAST ${token.toUpperCase()}`, status: null })).toEqual(sorted('draft'));
    expect(await list('editor_labak', { q: `kleinur ${token}`, status: null })).toEqual(sorted('other'));
  });

  it('filters each status, and combines it with the search', async () => {
    const q = token;
    expect(await list('editor_labak', { q, status: 'draft' })).toEqual(sorted('draft', 'other'));
    expect(await list('editor_labak', { q, status: 'published' })).toEqual(sorted('published'));
    expect(await list('editor_labak', { q, status: 'changed' })).toEqual(sorted('changed'));
    expect(await list('editor_labak', { q, status: 'unpublished' })).toEqual(sorted('unpublished'));
    expect(await list('editor_labak', { q, status: 'archived' })).toEqual(sorted('archived'));
    expect(await list('editor_labak', { q, status: null })).toEqual(sorted('draft', 'published', 'changed', 'unpublished', 'other'));
  });

  it("returns only the editor's own tenant's entries for the same search and filter", async () => {
    expect(await list('editor_demo', { q: `þórubakarí uppkast ${token}`, status: null })).toEqual(sorted('demo'));
    expect(await list('editor_demo', { q: token, status: 'published' })).toEqual(sorted('demoPublished'));
    expect(await list('editor_labak', { q: `þórubakarí birt ${token}`, status: 'published' })).toEqual(sorted('published'));
  });

  it('gives a non-member, a revoked editor and a platform admin without membership nothing', async () => {
    for (const as of ['outsider', 'revoked', 'platform_admin'] as const) {
      for (const status of [null, 'draft', 'published', 'unpublished', 'archived'] as const) {
        expect(await list(as, { q: token, status })).toEqual([]);
      }
    }
  });

  it('treats LIKE wildcards in the search as plain characters', async () => {
    expect(await list('editor_labak', { q: `%${token}`, status: null })).toEqual([]);
    expect(await list('editor_labak', { q: `_${token}`, status: null })).toEqual([]);
  });
});
