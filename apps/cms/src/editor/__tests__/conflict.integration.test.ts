// M2-11 against the local stack (spec §5.5): two sessions edit one labak news entry through the real
// autosave controller and server actions. The second save is rejected; the conflict view lists both
// edits; "keep mine" saves at the newer version; the other session, now stale, reloads theirs and
// keeps editing on top of it. Nothing of either edit is lost without the editor having seen it.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { anonClient, retryRateLimited, secretClient } from '../../../../../tests/integration/src/clients.ts';
import { PERSONAS, TENANT } from '../../../../../tests/integration/src/fixtures.ts';
import { closeAll, draftVersion, ownerQuery } from '../../../../../tests/integration/src/sql.ts';

// Every action call runs with the session of the tab that makes it.
// The holder is shared through globalThis: the integration files run in one process without
// isolation, so the actions module, and the mock it was loaded with, is the first file's.
const session = vi.hoisted(() => ((globalThis as { editorSession?: { current: unknown } }).editorSession ??= { current: null }));
vi.mock('@/lib/supabase/server', () => ({ createEditorClient: async () => session.current }));

const { loadDraftAction, saveDraftAction } = await import('@/app/(editor)/t/[tenant]/actions');
const { AutosaveController } = await import('../autosave');
const { changedFields } = await import('../form/conflict');
const { describeFields } = await import('../form/descriptors');
const { getType } = await import('@/modules/registry');
const { t } = await import('@/i18n/is');

type Controller = InstanceType<typeof AutosaveController>;
/** What the actions use of the CMS's editor client (lib/supabase/server.ts): Auth, and `api` tables and functions. */
type EditorSession = { auth: AuthClient; from: (table: string) => unknown; rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> };
type AuthClient = ReturnType<typeof anonClient>['auth'];

let first: EditorSession;
let second: EditorSession;
let entryId: string;

/** A tab: its own session for every save and load, and its own autosave controller. */
function tab(client: EditorSession, initialVersion: number): Controller {
  const as = <A extends unknown[], R>(fn: (...args: A) => Promise<R>) => async (...args: A): Promise<R> => {
    session.current = client;
    return fn(...args);
  };
  // Both tabs are the same editor: every save names them (M2-17).
  const save = (id: string, version: number, data: unknown) => saveDraftAction(id, version, data, PERSONAS.editor_labak.id);
  return new AutosaveController({ entryId, initialVersion, save: as(save), loadLatest: as(loadDraftAction), debounceMs: 0 });
}

const settled = (c: Controller, state: string) =>
  vi.waitFor(() => {
    expect(c.getSnapshot().state).toBe(state);
    if (state === 'conflict') expect(c.getSnapshot().theirs?.status).toBe('ready');
  }, { timeout: 15_000 });

const draftData = async () => (await ownerQuery<{ data: Record<string, unknown> }>('select data from cms.drafts where entry_id = $1', [entryId]))[0]!.data;

/**
 * A sign-in of the persona of its own (one browser), through the real OTP path, with the `api`
 * schema the CMS's own editor client uses (lib/supabase/server.ts).
 */
async function signIn(persona: keyof typeof PERSONAS): Promise<EditorSession> {
  const link = await secretClient().auth.admin.generateLink({ type: 'magiclink', email: PERSONAS[persona].email });
  if (link.error) throw new Error(`generateLink: ${link.error.message}`);
  const client = anonClient();
  const verified = await retryRateLimited(() => client.auth.verifyOtp({ type: 'magiclink', token_hash: link.data.properties.hashed_token }));
  if (verified.error || !verified.data.session) throw new Error(`verifyOtp: ${verified.error?.message ?? 'no session'}`);
  return { auth: client.auth, from: (table) => client.schema('api').from(table), rpc: (fn, args) => client.schema('api').rpc(fn, args) };
}

beforeAll(async () => {
  first = await signIn('editor_labak');
  second = await signIn('editor_labak');
  const created = await first.rpc('create_entry', { p_tenant_id: TENANT.labak, p_type: 'news', p_slug: null, p_schema_version: getType('labak', 'news')!.version });
  if (created.error) throw new Error(`create_entry: ${created.error.message}`);
  entryId = created.data as string;
});
afterAll(closeAll);

describe('conflict resolution with two sessions (M2-11)', () => {
  it('rejects the stale save, shows both edits, and "keep mine" saves at the newer version', async () => {
    const start = (await draftVersion(entryId))!;
    const a = tab(first, start);
    const b = tab(second, start);

    b.schedule({ title: 'Upphaf', excerpt: 'Inngangur B' });
    await settled(b, 'saved');
    expect(b.getSnapshot().version).toBe(start + 1);

    a.schedule({ title: 'Titill A' });
    await settled(a, 'conflict');
    // The stale save changed nothing.
    expect(await draftVersion(entryId)).toBe(start + 1);
    expect(await draftData()).toEqual({ title: 'Upphaf', excerpt: 'Inngangur B' });

    const theirs = a.getSnapshot().theirs;
    expect(theirs).toEqual({ status: 'ready', version: start + 1, data: { title: 'Upphaf', excerpt: 'Inngangur B' } });
    // Both edits are on the screen before the editor chooses: A's title and B's excerpt.
    const mine = a.pendingData() as Record<string, unknown>;
    const changed = changedFields(describeFields(getType('labak', 'news')!), mine, theirs!.status === 'ready' ? theirs!.data : {});
    expect(changed.map((f) => [f.key, f.theirs, f.mine])).toEqual([
      ['title', 'Upphaf', 'Titill A'],
      ['excerpt', 'Inngangur B', t.editor.resolve.empty],
    ]);

    // A keeps their version, with the excerpt B wrote copied in after seeing it.
    a.schedule({ title: 'Titill A', excerpt: 'Inngangur B' });
    a.keepMine();
    await settled(a, 'saved');
    expect(a.getSnapshot().version).toBe(start + 2);
    expect(await draftVersion(entryId)).toBe(start + 2);
    expect(await draftData()).toEqual({ title: 'Titill A', excerpt: 'Inngangur B' });

    // B is now stale: its next save is rejected too; it reloads theirs and edits on top of it.
    b.schedule({ title: 'Upphaf', excerpt: 'Inngangur B, lengri' });
    await settled(b, 'conflict');
    expect(b.takeTheirs()).toEqual({ title: 'Titill A', excerpt: 'Inngangur B' });
    expect(b.pendingData()).toBeNull();
    b.schedule({ title: 'Titill A', excerpt: 'Inngangur B, lengri' });
    await settled(b, 'saved');
    expect(await draftVersion(entryId)).toBe(start + 3);
    expect(await draftData()).toEqual({ title: 'Titill A', excerpt: 'Inngangur B, lengri' });
  });

  it('loadDraftAction does not read another tenant\'s entry', async () => {
    session.current = await signIn('editor_demo');
    await expect(loadDraftAction(entryId)).resolves.toEqual({ ok: false, code: 'error' });
  });
});
