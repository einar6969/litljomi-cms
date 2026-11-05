// M2-14: an outdated draft in the editor (spec §5.3), as editor_demo against the local CMS and
// stack. The demo module's `notice` type is at version 2 (transform 1 → 2: heading → title). A
// notice is saved at version 1 over the Data API with the editor's own session (as a draft written
// before the type changed); its page shows the notice and no form, the update upcasts it, and the
// form then shows the moved value and autosaves at the current version.
import { expect as baseExpect } from '@playwright/test';
import { t } from '../src/i18n/is';
import { createEvent } from './support/editor';
import { apiRows, editorHeadersOf, entryDetail, type EditorHeaders } from './support/editor-api';
import { requireLoopback, SUPABASE_URL } from './support/local';
import { sessionState } from './support/session';
import { expect, test } from './support/test';

test.use({ storageState: sessionState('editor_demo') });

const SAVED = { timeout: 10_000 };

/** An `api` function called with the editor's session (its own RLS and grants). */
async function apiCall<T>(editor: EditorHeaders, fn: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(requireLoopback(`${SUPABASE_URL}/rest/v1/rpc/${fn}`), {
    method: 'POST',
    headers: { ...editor, 'content-type': 'application/json', 'content-profile': 'api' },
    body: JSON.stringify(args),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`rpc ${fn} answered ${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

test('an outdated draft shows a notice instead of the form, and the update brings it to the current version', async ({ page }) => {
  // The editor's session headers, from the publish panel's status read on an entry page.
  const statusRead = page.waitForRequest((r) => r.url().startsWith(`${SUPABASE_URL}/rest/v1/publication_status`));
  await createEvent(page);
  const editor = await editorHeadersOf(await statusRead);
  const [tenant] = await apiRows<{ id: string }>(editor, 'my_tenants?select=id&slug=eq.demo');

  const heading = `Lokað vegna veðurs ${Date.now()}`;
  const id = await apiCall<string>(editor, 'create_entry', { p_tenant_id: tenant!.id, p_type: 'notice', p_slug: null });
  const version = await apiCall<number>(editor, 'save_draft', {
    p_entry_id: id,
    p_expected_version: 1,
    p_data: { heading },
    p_schema_version: 1,
    p_title: heading,
    p_sort_at: null,
  });

  await page.goto(`/t/demo/notice/${id}`);
  const notice = page.getByRole('alert').filter({ hasText: t.editor.outdated.title });
  await expect(notice).toContainText(t.editor.outdated.body);
  await expect(page.getByLabel('Title')).toHaveCount(0);
  await expect(page.getByRole('button', { name: t.publish.publish })).toBeDisabled();

  await notice.getByRole('button', { name: t.editor.outdated.update }).click();
  await expect(page.getByLabel('Title')).toHaveValue(heading, SAVED);
  await expect(page.getByText(t.editor.outdated.title)).toHaveCount(0);
  await expect(page.getByRole('button', { name: t.publish.publish })).toBeEnabled();

  type Detail = { data: unknown; schema_version: number; draft_version: number };
  const detail = async () => {
    const { data, schema_version, draft_version } = await entryDetail<Detail>(editor, id);
    return { data, schema_version, draft_version };
  };
  baseExpect(await detail()).toEqual({ data: { title: heading }, schema_version: 2, draft_version: version + 1 });

  // An edit now autosaves at the current version.
  await page.getByLabel('Body').fill('Opnum aftur á morgun');
  await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);
  baseExpect(await detail()).toEqual({ data: { title: heading, body: 'Opnum aftur á morgun' }, schema_version: 2, draft_version: version + 2 });
});
