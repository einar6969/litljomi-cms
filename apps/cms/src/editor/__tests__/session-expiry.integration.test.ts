// M2-17 against the local stack (spec §4.4, §13.2 "session expiry loses no work"): an editor's
// session is revoked mid-edit (its refresh token and session are gone, as when it expires). The
// real autosave controller and server actions keep every edit in the tab while signed out; after
// signing in again the save lands at the expected version with all of them. A reload of the tab
// while signed out loses nothing either: the copy comes back and is saved when the editor chooses.
// Another account's session never saves them. Signing out removes the tab's copy for good. An editor
// removed from the tenant with a tab open (M4-01, review focus 5) is refused the next save, with a
// session that is still good, and loses nothing either.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { anonClient, secretClient, signInPersona } from '../../../../../tests/integration/src/clients.ts';
import { PERSONAS, TENANT, type PersonaName } from '../../../../../tests/integration/src/fixtures.ts';
import { closeAll, draftVersion, ownerQuery } from '../../../../../tests/integration/src/sql.ts';

// Every action call runs with the browser's current session (the cookies all its tabs share).
// The holder is shared through globalThis: the integration files run in one process without
// isolation, so the actions module, and the mock it was loaded with, is the first file's.
const session = vi.hoisted(() => ((globalThis as { editorSession?: { current: unknown } }).editorSession ??= { current: null }));
vi.mock('@/lib/supabase/server', () => ({ createEditorClient: async () => session.current }));

const { saveDraftAction, loadDraftAction } = await import('@/app/(editor)/t/[tenant]/actions');
const { hasSession, sessionUserId } = await import('../server/entry-context');
const { AutosaveController } = await import('../autosave');
const { clearUnsavedCopies, unsavedStore } = await import('../unsaved');
const { getType } = await import('@/modules/registry');

type Controller = InstanceType<typeof AutosaveController>;
type AuthClient = ReturnType<typeof anonClient>['auth'];
type EditorSession = { auth: AuthClient; accessToken: string; from: (table: string) => unknown; rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> };

/** A tab's `sessionStorage`: the Storage interface over a Map (Node has none). */
class TabStorage implements Storage {
  private readonly items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  clear() {
    this.items.clear();
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  setItem(key: string, value: string) {
    this.items.set(key, String(value));
  }
}

/** A password sign-in of its own, with the `api` schema the CMS's editor client uses. */
async function signIn(persona: PersonaName = 'editor_labak'): Promise<EditorSession> {
  const { client, session } = await signInPersona(persona);
  return { auth: client.auth, accessToken: session.access_token, from: (table) => client.schema('api').from(table), rpc: (fn, args) => client.schema('api').rpc(fn, args) };
}

/** Ends this session on the server, refresh token included (what an expired session amounts to); the persona's other sessions are left alone. */
async function revoke(s: EditorSession): Promise<void> {
  const { error } = await secretClient().auth.admin.signOut(s.accessToken, 'local');
  if (error) throw new Error(`signOut: ${error.message}`);
}

/** The editor the form was opened for. */
const USER = PERSONAS.editor_labak.id;

/** A tab of the editor: the browser's current session for every call, and the tab's storage. */
function tab(storage: Storage, entryId: string, initialVersion: number, onRestore?: (data: Record<string, unknown>) => void): Controller {
  return new AutosaveController({
    entryId,
    initialVersion,
    save: (id, version, data) => saveDraftAction(id, version, data, USER),
    loadLatest: loadDraftAction,
    // What EntryForm asks: is the browser's session this editor's?
    sessionIsValid: async () => (await sessionUserId(session.current as never)) === USER,
    store: unsavedStore(USER, storage),
    onRestore,
    debounceMs: 0,
  });
}

const settled = (c: Controller, state: string) => vi.waitFor(() => expect(c.getSnapshot().state).toBe(state), { timeout: 15_000 });
const draftData = async (entryId: string) => (await ownerQuery<{ data: Record<string, unknown> }>('select data from cms.drafts where entry_id = $1', [entryId]))[0]!.data;
const storedCopy = (storage: Storage, entryId: string) => unsavedStore(USER, storage).read(entryId);

async function newEntry(): Promise<string> {
  const created = await (session.current as EditorSession).rpc('create_entry', { p_tenant_id: TENANT.labak, p_type: 'news', p_slug: null, p_schema_version: getType('labak', 'news')!.version });
  if (created.error) throw new Error(`create_entry: ${created.error.message}`);
  return created.data as string;
}

beforeAll(async () => {
  session.current = await signIn();
});
afterAll(closeAll);

describe('session expiry loses no work (M2-17)', () => {
  it('keeps every edit while signed out; after signing in again the save lands with all of them', async () => {
    const entryId = await newEntry();
    const start = (await draftVersion(entryId))!;
    const storage = new TabStorage();
    const c = tab(storage, entryId, start);
    c.start();

    c.schedule({ title: 'Fyrsta' });
    await settled(c, 'saved');
    expect(storedCopy(storage, entryId)).toBeNull();

    // The session expires mid-edit: the next save is refused and nothing reaches the draft.
    await revoke(session.current as EditorSession);
    c.schedule({ title: 'Fyrsta, breytt' });
    await settled(c, 'signed_out');
    expect(await hasSession(session.current as never)).toBe(false);

    // Editing goes on while signed out; every edit stays in the tab, at the version it was made on.
    c.schedule({ title: 'Fyrsta, breytt', excerpt: 'Inngangur skrifaður án innskráningar' });
    await settled(c, 'signed_out');
    await c.resume();
    expect(c.getSnapshot().state).toBe('signed_out');
    expect(await draftVersion(entryId)).toBe(start + 1);
    expect(await draftData(entryId)).toEqual({ title: 'Fyrsta' });
    expect(storedCopy(storage, entryId)).toEqual({ version: start + 1, data: { title: 'Fyrsta, breytt', excerpt: 'Inngangur skrifaður án innskráningar' } });

    // The editor signs in again in another tab; this tab notices and saves at the expected version.
    session.current = await signIn();
    await c.resume();
    await settled(c, 'saved');
    expect(c.getSnapshot().version).toBe(start + 2);
    expect(await draftVersion(entryId)).toBe(start + 2);
    expect(await draftData(entryId)).toEqual({ title: 'Fyrsta, breytt', excerpt: 'Inngangur skrifaður án innskráningar' });
    expect(storedCopy(storage, entryId)).toBeNull();
  });

  it('a reload of the tab while signed out loses nothing: the copy comes back and is saved when the editor chooses', async () => {
    const entryId = await newEntry();
    const start = (await draftVersion(entryId))!;
    const storage = new TabStorage();
    const before = tab(storage, entryId, start);
    before.start();
    await revoke(session.current as EditorSession);
    before.schedule({ title: 'Óvistað fyrir endurhleðslu' });
    await settled(before, 'signed_out');
    before.dispose();

    // The reloaded page starts from the draft on the server; the tab's copy is restored over it.
    const restored: Record<string, unknown>[] = [];
    const after = tab(storage, entryId, start, (data) => restored.push(data));
    after.start();
    expect(restored).toEqual([{ title: 'Óvistað fyrir endurhleðslu' }]);
    expect(after.getSnapshot().state).toBe('restored');

    // Signed in again: nothing is saved until the editor chooses to save the restored copy.
    session.current = await signIn();
    await after.resume();
    expect(after.getSnapshot().state).toBe('restored');
    expect(await draftVersion(entryId)).toBe(start);
    after.saveRestored();
    await settled(after, 'saved');
    expect(await draftVersion(entryId)).toBe(start + 1);
    expect(await draftData(entryId)).toEqual({ title: 'Óvistað fyrir endurhleðslu' });
    expect(storedCopy(storage, entryId)).toBeNull();
  });

  it('another account signed in in the browser never saves the editor\'s edits', async () => {
    const entryId = await newEntry();
    const start = (await draftVersion(entryId))!;
    const storage = new TabStorage();
    const c = tab(storage, entryId, start);
    c.start();
    await revoke(session.current as EditorSession);
    c.schedule({ title: 'Breyting ritstjórans' });
    await settled(c, 'signed_out');

    // Someone else signs in in another tab: the check says no, and a save the editor forces is refused.
    session.current = await signIn('editor_demo');
    await c.resume();
    expect(c.getSnapshot().state).toBe('signed_out');
    c.retry();
    await settled(c, 'signed_out');
    expect(await draftVersion(entryId)).toBe(start);
    expect(storedCopy(storage, entryId)).toEqual({ version: start, data: { title: 'Breyting ritstjórans' } });
    expect(unsavedStore(PERSONAS.editor_demo.id, storage).read(entryId)).toBeNull();
    session.current = await signIn();
  });

  it('signing out removes the tab\'s copy, and a save in flight does not bring it back', async () => {
    const entryId = await newEntry();
    const storage = new TabStorage();
    storage.setItem('something-else', 'kept');
    // The save is held until the editor has signed out, so it is in flight when they do.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const c = new AutosaveController({
      entryId,
      initialVersion: (await draftVersion(entryId))!,
      save: async (id, version, data) => (await held, saveDraftAction(id, version, data, USER)),
      store: unsavedStore(USER, storage),
      debounceMs: 0,
    });
    c.start();
    c.schedule({ title: 'Á leiðinni' });
    await vi.waitFor(() => expect(c.getSnapshot().state).toBe('saving'));
    c.schedule({ title: 'Á leiðinni', excerpt: 'Skrifað á meðan' });
    expect(storedCopy(storage, entryId)).not.toBeNull();

    // What "Skrá út" does in the tab before its server action ends the session (SignOutForm).
    clearUnsavedCopies(storage);
    c.close();
    expect(storedCopy(storage, entryId)).toBeNull();
    expect(storage.getItem('something-else')).toBe('kept');
    // The save in flight answers; nothing is stored again and nothing more is saved.
    release();
    await vi.waitFor(async () => expect(await draftData(entryId)).toEqual({ title: 'Á leiðinni' }), { timeout: 15_000 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(storedCopy(storage, entryId)).toBeNull();
    expect(c.getSnapshot().state).toBe('signed_out');
  });
});

describe('an editor removed from the tenant with a tab open (M4-01, review focus 5)', () => {
  const admin = (fn: string, args: Record<string, unknown>) => secretClient().schema('api').rpc(fn, args);
  const removals = async () =>
    (await ownerQuery('select id from cms.audit_log where action = $1 and tenant_id = $2 and target_id = $3', ['system.membership.removed', TENANT.labak, USER])).length;

  it('the next save is refused and audited, nothing reaches the draft, and the edits stay in the tab until they can be saved', async () => {
    const entryId = await newEntry();
    const start = (await draftVersion(entryId))!;
    const storage = new TabStorage();
    const c = tab(storage, entryId, start);
    c.start();
    c.schedule({ title: 'Fyrir brottnám' });
    await settled(c, 'saved');
    const removalsBefore = await removals();

    expect((await admin('admin_remove_membership', { p_tenant_id: TENANT.labak, p_user_id: USER })).error).toBeNull();
    try {
      c.schedule({ title: 'Eftir brottnám', excerpt: 'Skrifað í opnum flipa' });
      await settled(c, 'error');

      // The session is still good: the membership is what refuses the save, on this very request.
      expect(await hasSession(session.current as never)).toBe(true);
      const direct = await (session.current as EditorSession).rpc('save_draft', {
        p_entry_id: entryId,
        p_expected_version: start + 1,
        p_data: { title: 'Bein tilraun' },
        p_schema_version: getType('labak', 'news')!.version,
        p_title: null,
        p_sort_at: null,
      });
      expect(direct.error?.message).toBe('not_found');
      expect(await draftVersion(entryId)).toBe(start + 1);
      expect(await draftData(entryId)).toEqual({ title: 'Fyrir brottnám' });
      expect(await removals()).toBe(removalsBefore + 1);

      // Nothing is lost: the tab's copy holds every edit, at the version they were made on.
      expect(storedCopy(storage, entryId)).toEqual({ version: start + 1, data: { title: 'Eftir brottnám', excerpt: 'Skrifað í opnum flipa' } });
      expect(c.pendingData()).toEqual({ title: 'Eftir brottnám', excerpt: 'Skrifað í opnum flipa' });
      c.retry();
      await settled(c, 'error');
      expect(await draftVersion(entryId)).toBe(start + 1);
    } finally {
      expect((await admin('admin_add_membership', { p_tenant_id: TENANT.labak, p_user_id: USER })).error).toBeNull();
    }

    // The membership is back: the same edits save at the expected version.
    c.retry();
    await settled(c, 'saved');
    expect(await draftData(entryId)).toEqual({ title: 'Eftir brottnám', excerpt: 'Skrifað í opnum flipa' });
    expect(storedCopy(storage, entryId)).toBeNull();
  });
});
