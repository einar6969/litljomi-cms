// Schema evolution against the local stack (plan M2-05; spec §5.3, §7.1). The demo module's
// `notice` type is at version 2 with a transform 1 → 2 (heading → title). A revision written at
// version 1 (inserted as the owner, as a revision committed before the type changed) is delivered at
// version 2, and the stored revision is unchanged. A draft still at version 1 cannot be published:
// the worker refuses it with the named code `draft_outdated`. Run by `pnpm test:integration`.
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DRAFT_OUTDATED } from '@litljomi/cms-schema';
import { editorClient } from '../../../../../../tests/integration/src/clients.ts';
import { env } from '../../../../../../tests/integration/src/env.ts';
import { PERSONAS, TENANT } from '../../../../../../tests/integration/src/fixtures.ts';
import { closeAll, ownerQuery, withTx } from '../../../../../../tests/integration/src/sql.ts';
import { buildRelease } from '../build-release';
import { processRequestById } from '../process-request';

let editor: SupabaseClient;

beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', env.apiUrl);
  vi.stubEnv('SUPABASE_SECRET_KEY', env.secretKey);
  editor = await editorClient('editor_demo');
  // A demo release left building by a stopped run is failed the way the sweep fails it.
  await withTx('service', (w) => w.query('select * from api.worker_fail_stale_releases()'));
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeAll();
});

const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await editor.schema('api').rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.code} ${error.message}`);
  return data as T;
};

/** A demo notice saved by editor_demo at schema version 1 (before the type changed). */
async function noticeAtVersion1(heading: string) {
  const id = await rpc<string>('create_entry', { p_tenant_id: TENANT.demo, p_type: 'notice', p_slug: null });
  const version = await rpc<number>('save_draft', {
    p_entry_id: id,
    p_expected_version: 1,
    p_data: { heading },
    p_schema_version: 1,
    p_title: heading,
    p_sort_at: null,
  });
  return { id, version };
}

type RevisionRow = { id: string; schema_version: number; data: unknown; hash: string };
const revisionsOf = async (entryId: string): Promise<RevisionRow[]> =>
  (
    await ownerQuery<{ id: string; schema_version: number; data: unknown; text: string }>(
      'select id, schema_version, data, data::text as text from cms.revisions where entry_id = $1 order by committed_at',
      [entryId],
    )
  ).map((r) => ({ id: r.id, schema_version: r.schema_version, data: r.data, hash: createHash('sha256').update(r.text).digest('hex') }));

describe('schema evolution (M2-05)', () => {
  it('delivers a revision written at version 1 at version 2, through the transform; the revision is never rewritten', async () => {
    const heading = `Lokað á morgun ${Date.now()}`;
    const n = await noticeAtVersion1(heading);
    const [rev] = await ownerQuery<{ id: string }>(
      `insert into cms.revisions (tenant_id, entry_id, draft_version, schema_version, data, title, requested_by)
       values ($1, $2, $3, 1, $4, $5, $6) returning id`,
      [TENANT.demo, n.id, n.version, JSON.stringify({ heading }), heading, PERSONAS.editor_demo.id],
    );
    await ownerQuery(
      `update cms.entries set published_rev_id = $2, published_draft_version = $3, first_published_at = now(), last_published_at = now()
       where id = $1`,
      [n.id, rev!.id, n.version],
    );
    const before = await revisionsOf(n.id);

    try {
      const result = await buildRelease(TENANT.demo);

      expect(result.status, JSON.stringify(result)).toBe('delivered');
      expect(result.omitted.map((o) => o.entryId)).not.toContain(n.id);
      const delivered = result.bundle!.entries['notice']!.find((e) => e.id === n.id)!;
      expect(delivered).toMatchObject({ revisionId: rev!.id, schemaVersion: 2, title: heading, data: { title: heading, body: null } });
      expect(delivered.data).not.toHaveProperty('heading');
      // The build read the revision and upcast it in memory: the row is exactly as inserted.
      const after = await revisionsOf(n.id);
      expect(after).toEqual(before);
      expect(after).toEqual([expect.objectContaining({ id: rev!.id, schema_version: 1, data: { heading } })]);
    } finally {
      // Withdraw it so later demo builds do not carry it.
      await ownerQuery('update cms.entries set published_rev_id = null, published_draft_version = null where id = $1', [n.id]);
    }
  });

  it(`refuses to publish a draft at the old version with ${DRAFT_OUTDATED}, and commits nothing`, async () => {
    const n = await noticeAtVersion1('Gamalt uppkast');
    const requestId = await rpc<string>('request_publish', { p_entry_id: n.id, p_expected_draft_version: n.version });

    const outcome = await processRequestById(requestId);

    expect(outcome.status).toBe('failed_validation');
    expect(outcome.errors).toEqual({ code: 'draft_outdated', draftSchemaVersion: 1, currentSchemaVersion: 2 });
    const [request] = await ownerQuery<{ status: string; error: unknown }>('select status, error from cms.publish_requests where id = $1', [requestId]);
    expect(request).toEqual({ status: 'failed_validation', error: { code: 'draft_outdated', draftSchemaVersion: 1, currentSchemaVersion: 2 } });
    expect(await revisionsOf(n.id)).toEqual([]);
  });
});
