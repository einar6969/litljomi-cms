// The reference picker's query against the local stack (plan M2-08; spec §5.2, §4.5). It runs
// `listReferenceOptions` exactly as the picker's action does, with a client of the `api` schema
// carrying the persona's own session (as `createEditorClient` does): RLS alone decides what is
// listed, so an editor sees only their tenant's entries, and a non-member none.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { editorApiClient, editorClient } from '../../../../../../tests/integration/src/clients.ts';
import { TENANT } from '../../../../../../tests/integration/src/fixtures.ts';
import { closeAll, ownerQuery } from '../../../../../../tests/integration/src/sql.ts';
import { listReferenceOptions } from '../reference-options';

const apiClient = editorApiClient;

const created = { demo: [] as string[], labak: [] as string[] };

/** Creates an entry of the type over the Data API as the tenant's own editor. */
async function entry(tenant: 'demo' | 'labak', type: string, title: string): Promise<string> {
  const client = await editorClient(tenant === 'demo' ? 'editor_demo' : 'editor_labak');
  const api = client.schema('api');
  const { data: id, error } = await api.rpc('create_entry', { p_tenant_id: TENANT[tenant], p_type: type, p_slug: `m208-${randomUUID().slice(0, 8)}` });
  if (error) throw new Error(`create_entry: ${error.code} ${error.message}`);
  const saved = await api.rpc('save_draft', {
    p_entry_id: id,
    p_expected_version: 1,
    p_data: { title },
    p_schema_version: 1,
    p_title: title,
    p_sort_at: null,
  });
  if (saved.error) throw new Error(`save_draft: ${saved.error.code} ${saved.error.message}`);
  created[tenant].push(id as string);
  return id as string;
}

let demoEvent: string;
let labakNews: string;

beforeAll(async () => {
  demoEvent = await entry('demo', 'event', 'M2-08 viðburður');
  labakNews = await entry('labak', 'news', 'M2-08 frétt');
});
afterAll(async () => {
  // Archived, not deleted (drafts and audit rows refer to them): archived entries are in no list,
  // so later specs (the design e2e lists labak's news) see the tenants as before.
  await ownerQuery('update cms.entries set archived_at = now() where id = any($1::uuid[]) and archived_at is null', [[...created.demo, ...created.labak]]);
  await closeAll();
});

const ids = (result: { options: { id: string }[] }) => result.options.map((o) => o.id);

describe("the reference picker's query (listReferenceOptions)", () => {
  it("lists the editor's own tenant's entries of the allowed types, with title and status", async () => {
    const result = await listReferenceOptions(await apiClient('editor_demo'), TENANT.demo, ['event']);
    expect(result.options).toContainEqual({ id: demoEvent, type: 'event', title: 'M2-08 viðburður', status: 'draft' });
    expect(result.options.every((o) => o.type === 'event')).toBe(true);
  });

  it("returns no entry of another tenant: tenant A's editor asking for tenant B gets nothing", async () => {
    const own = await listReferenceOptions(await apiClient('editor_demo'), TENANT.demo, ['event', 'news']);
    expect(ids(own)).not.toContain(labakNews);
    const other = await listReferenceOptions(await apiClient('editor_demo'), TENANT.labak, ['news']);
    expect(other.options).toEqual([]);
    // And the other way round.
    const labak = await listReferenceOptions(await apiClient('editor_labak'), TENANT.demo, ['event']);
    expect(labak.options).toEqual([]);
  });

  it.each(['outsider', 'revoked', 'platform_admin'] as const)('gives a non-member (%s) none of either tenant', async (persona) => {
    const client = await apiClient(persona);
    for (const [tenant, types] of [
      [TENANT.demo, ['event']],
      [TENANT.labak, ['news']],
    ] as const) {
      expect((await listReferenceOptions(client, tenant, types)).options).toEqual([]);
    }
  });

  it('leaves out archived entries', async () => {
    const archived = await entry('demo', 'event', 'M2-08 í skjalasafni');
    await ownerQuery('update cms.entries set archived_at = now() where id = $1', [archived]);
    const result = await listReferenceOptions(await apiClient('editor_demo'), TENANT.demo, ['event']);
    expect(ids(result)).not.toContain(archived);
    expect(ids(result)).toContain(demoEvent);
  });
});
