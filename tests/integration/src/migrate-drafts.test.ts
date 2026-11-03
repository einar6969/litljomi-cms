// `migrate-drafts` against the local stack (plan M2-13; spec §5.3). The demo module's `notice` type
// is at version 2 with a transform 1 -> 2 (heading -> title, M2-05). Drafts saved by editor_demo at
// version 1 are migrated by the CLI as versioned draft updates; a second run changes nothing; a
// draft an editor keeps saving during the run is retried once and then reported; revisions are
// untouched (row count and hashes).
//
// The CLI is run through runCli with the hosted rules unchanged: the env file it reads names a
// https://<ref>.supabase.co URL and the local secret key, and the injected fetch sends each request
// to the local stack instead. Nothing here reaches a hosted project.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runCli } from '../../../tools/cli/src/cli.ts';
import { editorClient } from './clients.ts';
import { env } from './env.ts';
import { PERSONAS, TENANT } from './fixtures.ts';
import { closeAll, ownerQuery } from './sql.ts';

const REF = 'migratedraftstest000';
const ORIGIN = `https://${REF}.supabase.co`;
const ENV_FILE = '/test/.env.staging.local';

let editor: SupabaseClient;

beforeAll(async () => {
  editor = await editorClient('editor_demo');
});
afterAll(async () => {
  await closeAll();
});

const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await editor.schema('api').rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.code} ${error.message}`);
  return data as T;
};

type DraftRow = { version: number; schema_version: number; data: unknown; title: string | null; sort_at: string | null; updated_by: string | null };
const draftOf = async (entryId: string): Promise<DraftRow> =>
  (await ownerQuery<DraftRow>('select version, schema_version, data, title, sort_at::text, updated_by from cms.drafts where entry_id = $1', [entryId]))[0]!;

/** A demo notice saved by editor_demo at schema version 1 (as the app did before the type changed). */
async function noticeAtVersion1(heading: string): Promise<string> {
  const id = await rpc<string>('create_entry', { p_tenant_id: TENANT.demo, p_type: 'notice', p_slug: null });
  await saveAtVersion1(id, heading);
  return id;
}

/** An editor still on the old app saves the draft at schema version 1. */
async function saveAtVersion1(id: string, heading: string): Promise<number> {
  const { version } = await draftOf(id);
  return rpc<number>('save_draft', { p_entry_id: id, p_expected_version: version, p_data: { heading }, p_schema_version: 1, p_title: heading, p_sort_at: null });
}

/** Every revision's id and a hash of its row, and their count. */
const revisionsSnapshot = async () =>
  (
    await ownerQuery<{ count: number; hash: string | null }>(
      `select count(*)::int as count, md5(string_agg(r.id::text || ':' || r.schema_version || ':' || r.data::text || ':' || coalesce(r.title, ''), ',' order by r.id)) as hash
       from cms.revisions r`,
    )
  )[0]!;

/** Runs the CLI against the local stack; `beforeSave` runs before each admin_migrate_draft request. */
async function migrate(beforeSave: (entryId: string) => Promise<void> = async () => {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(['migrate-drafts', '--tenant', 'demo', '--type', 'notice', '--expect-ref', REF, `--env-file=${ENV_FILE}`], {
    log: (l) => out.push(l),
    error: (l) => err.push(l),
    migrateDrafts: {
      readTextFile: async (path) => {
        expect(path).toBe(ENV_FILE);
        return `NEXT_PUBLIC_SUPABASE_URL=${ORIGIN}\nSUPABASE_SECRET_KEY=${env.secretKey}\n`;
      },
      fetch: async (url, init) => {
        expect(url.startsWith(`${ORIGIN}/rest/v1/rpc/`)).toBe(true);
        if (url.endsWith('/admin_migrate_draft')) await beforeSave((JSON.parse(init.body as string) as { p_entry_id: string }).p_entry_id);
        return fetch(env.apiUrl + url.slice(ORIGIN.length), init);
      },
    },
  });
  return { code, out, err, text: [...out, ...err].join('\n') };
}

describe('migrate-drafts (M2-13)', () => {
  it('migrates 3 outdated drafts as versioned updates; a second run changes nothing; revisions are untouched', async () => {
    const stamp = Date.now();
    const ids = await Promise.all([1, 2, 3].map((n) => noticeAtVersion1(`Tilkynning ${n} ${stamp}`)));
    // One of them has a revision committed at version 1 (inserted as the owner, as M2-05's test does).
    const before = await Promise.all(ids.map(draftOf));
    await ownerQuery(
      `insert into cms.revisions (tenant_id, entry_id, draft_version, schema_version, data, title, requested_by)
       values ($1, $2, $3, 1, $4, $5, $6)`,
      [TENANT.demo, ids[0], before[0]!.version, JSON.stringify(before[0]!.data), before[0]!.title, PERSONAS.editor_demo.id],
    );
    const revisions = await revisionsSnapshot();

    const first = await migrate();

    expect(first.code, first.text).toBe(0);
    for (const [i, id] of ids.entries()) {
      const heading = `Tilkynning ${i + 1} ${stamp}`;
      expect(first.out).toContain(`migrated ${id}: schema version 1 -> 2, draft version ${before[i]!.version} -> ${before[i]!.version + 1}`);
      expect(await draftOf(id)).toEqual({
        version: before[i]!.version + 1,
        schema_version: 2,
        data: { title: heading },
        title: heading,
        sort_at: null,
        updated_by: null,
      });
    }
    expect(first.text).not.toContain(env.secretKey);
    expect(first.text).not.toContain(`Tilkynning 1 ${stamp}`);
    expect(first.out.at(-1)).toMatch(/^demo\/notice at schema version 2: \d+ migrated, 0 already current, 0 reported$/);
    expect(await revisionsSnapshot()).toEqual(revisions);

    const after = await Promise.all(ids.map(draftOf));
    const second = await migrate();

    expect(second.code, second.text).toBe(0);
    expect(second.out.at(-1)).toBe('demo/notice at schema version 2: 0 migrated, 0 already current, 0 reported');
    expect(await Promise.all(ids.map(draftOf))).toEqual(after);
    expect(await revisionsSnapshot()).toEqual(revisions);
  });

  it('retries a draft changed meanwhile once, and reports one that keeps changing; neither is overwritten', async () => {
    const stamp = Date.now();
    const once = await noticeAtVersion1(`Einu sinni ${stamp}`);
    const always = await noticeAtVersion1(`Alltaf ${stamp}`);
    const revisions = await revisionsSnapshot();
    let onceEdited = false;

    const run = await migrate(async (entryId) => {
      if (entryId === once && !onceEdited) {
        onceEdited = true;
        await saveAtVersion1(once, `Einu sinni breytt ${stamp}`);
      }
      if (entryId === always) await saveAtVersion1(always, `Alltaf breytt ${Date.now()}`);
    });

    expect(run.code, run.text).toBe(1);
    expect(run.out.some((l) => l.startsWith(`retrying ${once}: changed since it was read`))).toBe(true);
    expect(await draftOf(once)).toMatchObject({ schema_version: 2, data: { title: `Einu sinni breytt ${stamp}` } });
    expect(run.err).toContain(`REPORTED ${always}: changed during the migration twice (version_conflict); draft left as it is`);
    const left = await draftOf(always);
    // The editor's last save stands, at version 1, unchanged by the CLI.
    expect(left.schema_version).toBe(1);
    expect(left.data).toEqual({ heading: left.title });
    expect(left.title).toMatch(/^Alltaf breytt /);
    expect(left.updated_by).toBe(PERSONAS.editor_demo.id);
    expect(run.out.at(-1)).toMatch(/^demo\/notice at schema version 2: \d+ migrated, 0 already current, 1 reported$/);
    expect(await revisionsSnapshot()).toEqual(revisions);

    // Left alone, it is migrated by the next run.
    const next = await migrate();
    expect(next.code, next.text).toBe(0);
    expect(await draftOf(always)).toMatchObject({ schema_version: 2, data: { title: left.title } });
  });
});
