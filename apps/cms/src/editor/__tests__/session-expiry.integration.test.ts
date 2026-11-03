// M2-17 against the local stack (spec §4.4, §13.2 "session expiry loses no work"): an editor's
// session is revoked mid-edit (its refresh token and session are gone, as when it expires). The
// real autosave controller and server actions keep every edit in the tab while signed out; after
// signing in again the save lands at the expected version with all of them. A reload of the tab
// while signed out loses nothing either. Signing out removes the tab's copy.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { anonClient, retryRateLimited, secretClient } from '../../../../../tests/integration/src/clients.ts';
import { PERSONAS, TENANT } from '../../../../../tests/integration/src/fixtures.ts';
import { closeAll, draftVersion, ownerQuery } from '../../../../../tests/integration/src/sql.ts';

// Every action call runs with the browser's current session (the cookies all its tabs share).
// The holder is shared through globalThis: the integration files run in one process without
// isolation, so the actions module, and the mock it was loaded with, is the first file's.
const session = vi.hoisted(() => ((globalThis as { editorSession?: { current: unknown } }).editorSession ??= { current: null }));
vi.mock('@/lib/supabase/server', () => ({ createEditorClient: async () => session.current }));

const { saveDraftAction, loadDraftAction } = await import('@/app/(editor)/t/[tenant]/actions');
const { hasSession } = await import('../server/entry-context');
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

/** A sign-in through the real OTP path, with the `api` schema the CMS's editor client uses. */
async function signIn(): Promise<EditorSession> {
  const link = await secretClient().auth.admin.generateLink({ type: 'magiclink', email: PERSONAS.editor_labak.email });
  if (link.error) throw new Error(`generateLink: ${link.error.message}`);
  const client = anonClient();
  const verified = await retryRateLimited(() => client.auth.verifyOtp({ type: 'magiclink', token_hash: link.data.properties.hashed_token }));
  if (verified.error || !verified.data.session) throw new Error(`verifyOtp: ${verified.error?.message ?? 'no session'}`);
  return { auth: client.auth, accessToken: verified.data.session.access_token, from: (table) => client.schema('api').from(table), rpc: (fn, args) => client.schema('api').rpc(fn, args) };
}

/** Ends this session on the server, refresh token included (what an expired session amounts to); the persona's other sessions are left alone. */
async function revoke(s: EditorSession): Promise<void> {
  const { error } = await secretClient().auth.admin.signOut(s.accessToken, 'local');
  if (error) throw new Error(`signOut: ${error.message}`);
}

/** A tab of the editor: the browser's current session for every call, and the tab's storage. */
function tab(storage: Storage, entryId: string, initialVersion: number, onRestore?: (data: Record<string, unknown>) => void): Controller {
  return new AutosaveController({
    entryId,
    initialVersion,
    save: saveDraftAction,
    loadLatest: loadDraftAction,
    sessionIsValid: () => hasSession(session.current as never),
    store: unsavedStore(storage),
    onRestore,
    debounceMs: 0,
  });
}

const settled = (c: Controller, state: string) => vi.waitFor(() => expect(c.getSnapshot().state).toBe(state), { timeout: 15_000 });
const draftData = async (entryId: string) => (await ownerQuery<{ data: Record<string, unknown> }>('select data from cms.drafts where entry_id = $1', [entryId]))[0]!.data;
const storedCopy = (storage: Storage, entryId: string) => unsavedStore(storage).read(entryId);

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

  it('a reload of the tab while signed out loses nothing: the copy is saved after signing in again', async () => {
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
    await settled(after, 'signed_out');

    session.current = await signIn();
    await after.resume();
    await settled(after, 'saved');
    expect(await draftVersion(entryId)).toBe(start + 1);
    expect(await draftData(entryId)).toEqual({ title: 'Óvistað fyrir endurhleðslu' });
    expect(storedCopy(storage, entryId)).toBeNull();
  });

  it('signing out removes the tab\'s copy', async () => {
    const entryId = await newEntry();
    const storage = new TabStorage();
    storage.setItem('something-else', 'kept');
    const c = tab(storage, entryId, (await draftVersion(entryId))!);
    c.start();
    await revoke(session.current as EditorSession);
    c.schedule({ title: 'Óvistað' });
    await settled(c, 'signed_out');
    expect(storedCopy(storage, entryId)).not.toBeNull();

    // What "Skrá út" does in the tab before its server action ends the session (SignOutForm).
    clearUnsavedCopies(storage);
    expect(storedCopy(storage, entryId)).toBeNull();
    expect(storage.getItem('something-else')).toBe('kept');
    session.current = await signIn();
  });
});
