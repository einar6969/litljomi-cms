// One signed-in browser state per persona, written by editor-session.setup.ts before the tests run
// and reused by every spec that needs a session (Tasks 22–25): `test.use({ storageState:
// sessionState('editor_labak') })`. The files hold local session cookies and are not committed.
import { join } from 'node:path';
import type { E2ePersona } from './personas';

export const SESSION_DIR = join(import.meta.dirname, '..', '.auth');

export const sessionState = (persona: E2ePersona): string => join(SESSION_DIR, `${persona}.json`);
