// Restore from a revision, against the local stack (plan M2-16; spec §5.5 "Restore from a revision
// copies its data into the draft (a normal versioned save). Revisions are never modified", §7.1
// per-entry rollback). A demo notice is published as v1, edited and published as v2; v1 is restored
// with the editor's own session (`restoreRevision`: read through api.revision_list, upcast, a
// normal versioned save) and published: the release carries v1's content under a new revisionId,
// and no revision changes. An editor of the other tenant can neither list nor restore it. A
// revision written at schema version 1 is restored at version 2 through the type's transform.
// Run by `pnpm test:integration`.
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { editorApiClient } from '../../../../../../tests/integration/src/clients.ts';
import { env } from '../../../../../../tests/integration/src/env.ts';
import { PERSONAS, TENANT } from '../../../../../../tests/integration/src/fixtures.ts';
import { closeAll, ownerQuery, withTx } from '../../../../../../tests/integration/src/sql.ts';
import { buildRelease } from '../build-release';
import { processRequestById } from '../process-request';
import { loadRevisionHistory, restoreRevision } from '@/editor/server/restore-revision';

let editor: SupabaseClient<any, 'api'>;
let other: SupabaseClient<any, 'api'>;
const created: string[] = [];

beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', env.apiUrl);
  vi.stubEnv('SUPABASE_SECRET_KEY', env.secretKey);
  editor = await editorApiClient('editor_demo');
  other = await editorApiClient('editor_labak');
  // A demo release left building by a stopped run is failed the way the sweep fails it.
  await withTx('service', (w) => w.query('select * from api.worker_fail_stale_releases()'));
});
afterAll(async () => {
  // Withdrawn and archived, so later demo builds and lists do not carry them.
  await ownerQuery(
    'update cms.entries set published_rev_id = null, published_draft_version = null, archived_at = coalesce(archived_at, now()) where id = any($1::uuid[])',
    [created],
  );
  vi.unstubAllEnvs();
  await closeAll();
});

const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await editor.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.code} ${error.message}`);
  return data as T;
};

const save = (id: string, version: number, data: { title: string; body: string }) =>
  rpc<number>('save_draft', { p_entry_id: id, p_expected_version: version, p_data: data, p_schema_version: 2, p_title: data.title, p_sort_at: null });

async function publish(id: string, version: number) {
  const outcome = await processRequestById(await rpc<string>('request_publish', { p_entry_id: id, p_expected_draft_version: version }));
  expect(outcome.status, JSON.stringify(outcome)).toBe('committed');
}

const detail = async (id: string) => {
  const { data, error } = await editor.from('entry_detail').select('data, schema_version, draft_version').eq('id', id).single();
  if (error) throw new Error(`entry_detail: ${error.code}`);
  return data as { data: unknown; schema_version: number; draft_version: number };
};

type RevisionRow = { id: string; draft_version: number; schema_version: number; data: unknown; hash: string };
const revisionsOf = async (entryId: string): Promise<RevisionRow[]> =>
  (
    await ownerQuery<{ id: string; draft_version: number; schema_version: number; data: unknown; text: string; committed_at: Date }>(
      'select id, draft_version, schema_version, data, data::text as text, committed_at from cms.revisions where entry_id = $1 order by committed_at, id',
      [entryId],
    )
  ).map((r) => ({
    id: r.id,
    draft_version: r.draft_version,
    schema_version: r.schema_version,
    data: r.data,
    hash: createHash('sha256').update(`${r.text}|${r.committed_at.toISOString()}`).digest('hex'),
  }));

async function newNotice() {
  const id = await rpc<string>('create_entry', { p_tenant_id: TENANT.demo, p_type: 'notice', p_slug: null, p_schema_version: 2 });
  created.push(id);
  return id;
}

describe('restore from a revision (M2-16)', () => {
  it('publish v1, publish v2, restore v1, publish: the release carries v1 under a new revisionId; revisions unchanged', async () => {
    const id = await newNotice();
    const v1 = { title: `Opið til fimm ${Date.now()}`, body: 'Fyrsta útgáfa' };
    const v2 = { title: `Opið til sex ${Date.now()}`, body: 'Önnur útgáfa' };
    let version = await save(id, 1, v1);
    await publish(id, version);
    version = await save(id, version, v2);
    await publish(id, version);

    const before = await revisionsOf(id);
    expect(before.map((r) => r.data)).toEqual([v1, v2]);
    const [rev1, rev2] = before;

    // The history: newest first, the editor's own, the published one marked.
    const history = await loadRevisionHistory(editor, TENANT.demo, id);
    expect(history).toEqual([
      { id: rev2!.id, committedAt: expect.any(String), mine: true, current: true },
      { id: rev1!.id, committedAt: expect.any(String), mine: true, current: false },
    ]);

    // Restore v1: a normal versioned save of its data into the draft.
    expect(await restoreRevision(editor, id, rev1!.id, version - 1)).toEqual({ ok: false, code: 'version_conflict' });
    const restored = await restoreRevision(editor, id, rev1!.id, version);
    expect(restored).toEqual({ ok: true, version: version + 1 });
    expect(await detail(id)).toEqual({ data: v1, schema_version: 2, draft_version: version + 1 });
    const [draft] = await ownerQuery<{ title: string }>('select title from cms.drafts where entry_id = $1', [id]);
    expect(draft!.title).toBe(v1.title);
    // Restoring changes no revision and publishes nothing by itself.
    expect(await revisionsOf(id)).toEqual(before);
    const [entry] = await ownerQuery<{ published_rev_id: string }>('select published_rev_id from cms.entries where id = $1', [id]);
    expect(entry!.published_rev_id).toBe(rev2!.id);

    // Then a normal publish.
    await publish(id, version + 1);
    const after = await revisionsOf(id);
    expect(after.slice(0, 2)).toEqual(before);
    expect(after).toHaveLength(3);
    const rev3 = after[2]!;
    expect(rev3).toMatchObject({ draft_version: version + 1, schema_version: 2, data: v1 });
    expect([rev1!.id, rev2!.id]).not.toContain(rev3.id);

    const result = await buildRelease(TENANT.demo);
    expect(result.status, JSON.stringify(result)).toBe('delivered');
    const delivered = result.bundle!.entries['notice']!.find((e) => e.id === id)!;
    expect(delivered).toMatchObject({ revisionId: rev3.id, title: v1.title, data: { title: v1.title, body: v1.body } });
    expect(await revisionsOf(id)).toEqual(after);
  });

  it("an editor of another tenant can neither read nor restore the revision", async () => {
    const id = await newNotice();
    const data = { title: `Lokað ${Date.now()}`, body: 'x' };
    const version = await save(id, 1, data);
    await publish(id, version);
    const [rev] = await revisionsOf(id);

    // labak's editor: no rows through the view, whatever is named, and restore finds no entry.
    const listed = await other.from('revision_list').select('id').eq('id', rev!.id);
    expect(listed.error).toBeNull();
    expect(listed.data).toEqual([]);
    expect(await loadRevisionHistory(other, TENANT.demo, id)).toEqual([]);
    expect(await restoreRevision(other, id, rev!.id, version)).toEqual({ ok: false, code: 'error' });

    // Nor can a revision of one entry be restored into another entry.
    const target = await newNotice();
    expect(await restoreRevision(editor, target, rev!.id, 1)).toEqual({ ok: false, code: 'error' });
    expect(await detail(target)).toMatchObject({ data: {}, draft_version: 1 });
    expect(await detail(id)).toMatchObject({ data, draft_version: version });
  });

  it('restores a revision written at schema version 1 at version 2, through the transform', async () => {
    const id = await newNotice();
    const heading = `Gömul tilkynning ${Date.now()}`;
    const [rev] = await ownerQuery<{ id: string }>(
      `insert into cms.revisions (tenant_id, entry_id, draft_version, schema_version, data, title, requested_by)
       values ($1, $2, 1, 1, $3, $4, $5) returning id`,
      [TENANT.demo, id, JSON.stringify({ heading }), heading, PERSONAS.editor_demo.id],
    );
    const restored = await restoreRevision(editor, id, rev!.id, 1);
    expect(restored).toEqual({ ok: true, version: 2 });
    expect(await detail(id)).toEqual({ data: { title: heading }, schema_version: 2, draft_version: 2 });
    const [row] = await ownerQuery<{ schema_version: number; data: unknown }>('select schema_version, data from cms.revisions where id = $1', [rev!.id]);
    expect(row).toEqual({ schema_version: 1, data: { heading } });
  });
});
