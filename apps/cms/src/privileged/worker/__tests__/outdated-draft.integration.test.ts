// An outdated draft in the editor, against the local stack (plan M2-14; spec §5.3). The demo
// module's `notice` type is at version 2 with a transform 1 → 2 (heading → title). A draft saved at
// version 1 is opened (the editor's page reads its schema version), refused at publish with the
// worker's `draft_outdated` (M2-05), updated by the editor's update (`updateDraftSchema`, with the
// editor's own session: upcast and a normal versioned save), and then published. Another tenant's
// editor cannot update it. Run by `pnpm test:integration`.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DRAFT_OUTDATED } from '@litljomi/cms-schema';
import { editorApiClient } from '../../../../../../tests/integration/src/clients.ts';
import { env } from '../../../../../../tests/integration/src/env.ts';
import { TENANT } from '../../../../../../tests/integration/src/fixtures.ts';
import { closeAll, ownerQuery } from '../../../../../../tests/integration/src/sql.ts';
import { processRequestById } from '../process-request';
import { updateDraftSchema } from '@/editor/server/update-draft-schema';

let editor: SupabaseClient<any, 'api'>;
const created: string[] = [];

beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', env.apiUrl);
  vi.stubEnv('SUPABASE_SECRET_KEY', env.secretKey);
  editor = await editorApiClient('editor_demo');
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

/** A demo notice saved by editor_demo at schema version 1, as before the type changed. */
async function noticeAtVersion1(heading: string, body: string) {
  const id = await rpc<string>('create_entry', { p_tenant_id: TENANT.demo, p_type: 'notice', p_slug: null });
  created.push(id);
  const version = await rpc<number>('save_draft', {
    p_entry_id: id,
    p_expected_version: 1,
    p_data: { heading, body },
    p_schema_version: 1,
    p_title: heading,
    p_sort_at: null,
  });
  return { id, version };
}

const detail = async (id: string) => {
  const { data, error } = await editor.rpc('entry_detail_by_id', { p_entry_id: id });
  if (error) throw new Error(`entry_detail_by_id: ${error.code}`);
  const { data: draft, schema_version, draft_version } = data as { data: unknown; schema_version: number; draft_version: number };
  return { data: draft, schema_version, draft_version };
};

describe('an outdated draft in the editor (M2-14)', () => {
  it('opens an outdated draft, is refused at publish, updates it, and then publishes it', async () => {
    const heading = `Lokað vegna veðurs ${Date.now()}`;
    const n = await noticeAtVersion1(heading, 'Opnum aftur á morgun');

    // Opened: the page sees a draft below the type's version 2.
    expect(await detail(n.id)).toEqual({ data: { heading, body: 'Opnum aftur á morgun' }, schema_version: 1, draft_version: n.version });

    // Publishing it as it is shows the worker's named error.
    const refused = await processRequestById(await rpc<string>('request_publish', { p_entry_id: n.id, p_expected_draft_version: n.version }));
    expect(refused).toMatchObject({ status: 'failed_validation', errors: { code: DRAFT_OUTDATED } });

    // The update: upcast and a normal versioned save at version 2.
    const updated = await updateDraftSchema(editor, n.id, n.version);
    expect(updated).toEqual({ ok: true, version: n.version + 1 });
    expect(await detail(n.id)).toEqual({ data: { title: heading, body: 'Opnum aftur á morgun' }, schema_version: 2, draft_version: n.version + 1 });
    const [list] = await ownerQuery<{ title: string }>('select title from cms.drafts where entry_id = $1', [n.id]);
    expect(list!.title).toBe(heading);

    // Publish now succeeds, at version 2.
    const published = await processRequestById(await rpc<string>('request_publish', { p_entry_id: n.id, p_expected_draft_version: n.version + 1 }));
    expect(published.status, JSON.stringify(published)).toBe('committed');
    const revisions = await ownerQuery<{ schema_version: number; data: unknown }>('select schema_version, data from cms.revisions where entry_id = $1', [n.id]);
    expect(revisions).toEqual([{ schema_version: 2, data: { title: heading, body: 'Opnum aftur á morgun' } }]);

    // A second update (another tab) finds the draft current and saves nothing.
    expect(await updateDraftSchema(editor, n.id, n.version)).toEqual({ ok: true, version: n.version + 1 });
  });

  it("a stale version is a conflict, and another tenant's editor cannot update the draft", async () => {
    const n = await noticeAtVersion1(`Gamalt ${Date.now()}`, 'x');
    expect(await updateDraftSchema(editor, n.id, n.version - 1)).toEqual({ ok: false, code: 'version_conflict' });
    expect(await updateDraftSchema(await editorApiClient('editor_labak'), n.id, n.version)).toEqual({ ok: false, code: 'error' });
    expect(await detail(n.id)).toMatchObject({ schema_version: 1, draft_version: n.version });
  });
});
