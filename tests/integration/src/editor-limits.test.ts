// M5-02 over real HTTP (findings 3, 4 and 5 of docs/verification/m5-review.md; spec §4.3, §4.5,
// §4.6; decision 65): PostgREST can neither list `data` nor run a filter over it, one entry's data
// comes only through the by-id functions, and oversized text is refused. Requests go through the
// gateway with a real session, as an attacker's would. 116_editor_limits.test.sql pins the rest.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authHeaders, editorClient } from './clients.ts';
import { env } from './env.ts';
import { TENANT, type PersonaName } from './fixtures.ts';
import { closeAll, ownerQuery } from './sql.ts';

const rest = async (persona: PersonaName | 'anon', path: string, init: RequestInit = {}) => {
  const response = await fetch(`${env.apiUrl}/rest/v1/${path}`, {
    ...init,
    headers: { ...(await authHeaders(persona)), 'content-type': 'application/json', ...init.headers },
  });
  return { status: response.status, body: (await response.json()) as any };
};

const call = async (fn: string, args: Record<string, unknown>) => {
  const client = await editorClient('editor_labak');
  return client.schema('api').rpc(fn, args);
};

const MARK = `mark-${randomUUID()}`;
let entryId: string;
let revisionId: string;

beforeAll(async () => {
  const created = await call('create_entry', { p_tenant_id: TENANT.labak, p_type: 'news' });
  if (created.error) throw new Error(created.error.message);
  entryId = created.data as string;
  const saved = await call('save_draft', {
    p_entry_id: entryId, p_expected_version: 1, p_data: { title: MARK }, p_schema_version: 1, p_title: 'T', p_sort_at: null,
  });
  if (saved.error) throw new Error(saved.error.message);
  const [revision] = await ownerQuery<{ id: string }>(
    `insert into cms.revisions (tenant_id, entry_id, draft_version, schema_version, data, title, requested_by)
     select tenant_id, entry_id, version, schema_version, data, title, updated_by from cms.drafts where entry_id = $1 returning id`,
    [entryId],
  );
  revisionId = revision!.id;
});

afterAll(async () => {
  await ownerQuery('update cms.entries set archived_at = now() where id = $1', [entryId]);
  await closeAll();
});

describe('data cannot be read by list or filtered by regex', () => {
  it.each(['entry_detail', 'revision_list'])('%s has no data column to select or filter', async (view) => {
    const listed = await rest('editor_labak', `${view}?select=data&limit=1`);
    expect(listed.status).toBe(400);
    expect(listed.body.code).toBe('42703');
    const filtered = await rest('editor_labak', `${view}?data=match.${MARK}`);
    expect(filtered.status).toBe(400);
    const path = await rest('editor_labak', `${view}?data->>title=match.${MARK}`);
    expect(path.status).toBe(400);
    const all = await rest('editor_labak', `${view}?select=*&limit=1`);
    expect(all.status).toBe(200);
    expect(JSON.stringify(all.body)).not.toContain(MARK);
  });

  it.each([
    ['entry_detail_by_id', 'p_entry_id', () => entryId],
    ['revision_detail_by_id', 'p_revision_id', () => revisionId],
  ])('%s takes no filter, select or order over the result', async (fn, param, id) => {
    const queries = ['data=match.x', 'data->>title=match.x', 'select=data', 'order=data', 'pgrst_scalar=match.x'];
    for (const query of queries) {
      const response = await rest('editor_labak', `rpc/${fn}?${param}=${id()}&${query}`);
      expect(response.status, query).toBeGreaterThanOrEqual(400);
    }
  });

  it('entry_detail_by_id answers one value, even for an array of ids', async () => {
    const batch = await rest('editor_labak', 'rpc/entry_detail_by_id', {
      method: 'POST',
      headers: { prefer: 'params=multiple-objects' },
      body: JSON.stringify([{ p_entry_id: entryId }, { p_entry_id: entryId }]),
    });
    expect(Array.isArray(batch.body)).toBe(false);
    expect(batch.body.id).toBe(entryId);
  });
});

describe('the by-id reads, per persona', () => {
  it("an editor reads their tenant's entry and revision", async () => {
    const entry = await rest('editor_labak', 'rpc/entry_detail_by_id', { method: 'POST', body: JSON.stringify({ p_entry_id: entryId }) });
    expect(entry.status).toBe(200);
    expect(entry.body).toMatchObject({ id: entryId, tenant_id: TENANT.labak, type: 'news', data: { title: MARK }, draft_version: 2 });
    const revision = await rest('editor_labak', 'rpc/revision_detail_by_id', { method: 'POST', body: JSON.stringify({ p_revision_id: revisionId }) });
    expect(revision.status).toBe(200);
    expect(revision.body).toMatchObject({ id: revisionId, entry_id: entryId, data: { title: MARK } });
  });

  it.each(['editor_demo', 'outsider', 'revoked', 'platform_admin'] as const)('%s gets nothing', async (persona) => {
    for (const [fn, args] of [
      ['entry_detail_by_id', { p_entry_id: entryId }],
      ['revision_detail_by_id', { p_revision_id: revisionId }],
    ] as const) {
      const response = await rest(persona, `rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
      expect(response.status).toBe(200);
      expect(response.body).toBeNull();
    }
  });

  it('anon is refused', async () => {
    const response = await rest('anon', 'rpc/entry_detail_by_id', { method: 'POST', body: JSON.stringify({ p_entry_id: entryId }) });
    expect(response.status).toBe(401);
  });
});

describe('oversized text is refused', () => {
  it.each([
    ['a title', () => call('save_draft', { p_entry_id: entryId, p_expected_version: 2, p_data: {}, p_schema_version: 1, p_title: 't'.repeat(501), p_sort_at: null })],
    ['a type', () => call('create_entry', { p_tenant_id: TENANT.labak, p_type: 't'.repeat(101) })],
    ['a slug', () => call('create_entry', { p_tenant_id: TENANT.labak, p_type: 'news', p_slug: 'a'.repeat(201) })],
  ])('%s past its limit', async (_name, send) => {
    const { error } = await send();
    expect(error?.code).toBe('23514');
  });
});
