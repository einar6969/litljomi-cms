import { beforeEach, describe, expect, it, vi } from 'vitest';

const editor = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('../supabase/server', () => ({ createEditorClient: vi.fn(async () => editor.client) }));

const { consoleAccess } = await import('../console-access');

type Row = { data: unknown; error: unknown };
type Level = { data: unknown; error: unknown };

/** A fake signed-in client: `console_admin` answers `row`, the assurance level answers `level`. */
function fakeClient(row: Row, level: Level) {
  const select = vi.fn(() => ({ maybeSingle: vi.fn(async () => row) }));
  const from = vi.fn(() => ({ select }));
  const getAuthenticatorAssuranceLevel = vi.fn(async () => level);
  return { client: { from, auth: { mfa: { getAuthenticatorAssuranceLevel } } }, from, select, getAuthenticatorAssuranceLevel };
}

const ADMIN: Row = { data: { user_id: '00000000-0000-4000-8000-0000000000a1' }, error: null };
const NO_ROW: Row = { data: null, error: null };
const at = (currentLevel: string | null): Level => ({ data: { currentLevel, nextLevel: 'aal2', currentAuthenticationMethods: [] }, error: null });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('consoleAccess', () => {
  it('is none without a console_admin row, and does not read the assurance level', async () => {
    const fake = fakeClient(NO_ROW, at('aal2'));
    editor.client = fake.client;
    await expect(consoleAccess()).resolves.toBe('none');
    expect(fake.from).toHaveBeenCalledExactlyOnceWith('console_admin');
    expect(fake.getAuthenticatorAssuranceLevel).not.toHaveBeenCalled();
  });

  it('is needs_mfa for an admin at aal1', async () => {
    editor.client = fakeClient(ADMIN, at('aal1')).client;
    await expect(consoleAccess()).resolves.toBe('needs_mfa');
  });

  it('is needs_mfa for an admin whose session has no assurance level (fail closed)', async () => {
    editor.client = fakeClient(ADMIN, at(null)).client;
    await expect(consoleAccess()).resolves.toBe('needs_mfa');
  });

  it('is ok for an admin at aal2', async () => {
    editor.client = fakeClient(ADMIN, at('aal2')).client;
    await expect(consoleAccess()).resolves.toBe('ok');
  });

  it('throws on a database error, with the code only, instead of reading it as none', async () => {
    editor.client = fakeClient({ data: null, error: { code: '42501', message: 'permission denied for view console_admin' } }, at('aal2')).client;
    await expect(consoleAccess()).rejects.toThrow(/^console_admin: 42501$/);
  });

  it('throws on an Auth error, with the code only, instead of reading it as a level', async () => {
    editor.client = fakeClient(ADMIN, { data: null, error: { code: 'session_not_found', message: 'Auth said something' } }).client;
    await expect(consoleAccess()).rejects.toThrow(/^assurance level: session_not_found$/);
  });
});
