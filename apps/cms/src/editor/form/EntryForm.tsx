'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadDraftAction, saveDraftAction, setSlugAction } from '@/app/(editor)/t/[tenant]/actions';
import { t } from '@/i18n/is';
import { createBrowserEditorClient } from '@/lib/supabase/browser';
import { Button } from '@/ui/Button';
import { Notice } from '@/ui/Notice';
import { useAutosave, type SaveDraft, type TheirVersion } from '../autosave';
import { PreviewButton } from '../publish/PreviewButton';
import { PublishPanel } from '../publish/PublishPanel';
import type { RevisionSummary } from '../revisions';
import { onSignOut, unsavedStore } from '../unsaved';
import { changedFields } from './conflict';
import type { FieldDescriptor } from './descriptors';
import { FieldInput } from './FieldInput';
import { RevisionHistory } from './RevisionHistory';
import { SlugField } from './SlugField';
import { EditorTenantProvider, type EditorTenant } from './tenant-context';

type Props = {
  /** The entry's tenant, as the page resolved it through `api.my_tenants`. */
  tenant: EditorTenant;
  /** The signed-in user the page was rendered for, as Supabase Auth verified it. */
  userId: string;
  entryId: string;
  fields: FieldDescriptor[];
  /** The field the slug suggestion and the list title come from. */
  titleKey: string;
  initialData: Record<string, unknown>;
  initialVersion: number;
  initialSlug: string | null;
  slugLocked: boolean;
  /** The entry has a published revision (Task 25: the publish panel offers to take it down). */
  published?: boolean;
  /** The entry's published revisions, newest first (M2-16). */
  revisions?: readonly RevisionSummary[];
  /** The page was opened right after a restore: it says so once. */
  restored?: boolean;
};

/**
 * False when Supabase Auth says the browser has no valid session, or a session of another user than
 * `userId` (not on a network failure: the save itself is then refused by the server if the user differs).
 */
async function sessionIsUser(userId: string): Promise<boolean> {
  const { data, error } = await createBrowserEditorClient().auth.getUser();
  if (data.user) return data.user.id === userId;
  return !(error && (error.name === 'AuthSessionMissingError' || error.status === 401 || error.status === 403));
}

/**
 * The generated form of one entry. Its state is the whole draft data: a field this form cannot
 * edit yet is never touched, so it is sent back exactly as it was loaded. Every edit schedules an
 * autosave; local values stay on the screen whatever the save answers. A stale save shows the
 * conflict view (M2-11): only "reload theirs" replaces the form's values. Unsaved changes are also
 * kept in the tab (M2-17), under the user's own key: after the session expires, the save goes
 * through by itself once the same editor has signed in again, and a reload of the tab brings them
 * back with a notice, saved only when the editor chooses to. Every save names the user, so another
 * account's session never saves them. Signing out, in this tab or another, drops them.
 */
export function EntryForm({ tenant, userId, entryId, fields, titleKey, initialData, initialVersion, initialSlug, slugLocked, published = false, revisions = [], restored = false }: Props) {
  const [data, setData] = useState<Record<string, unknown>>(initialData);
  const latest = useRef(data);
  // Bumped when "reload theirs" replaces the values, so every field remounts with them (a field may
  // hold its own editing state, such as the rich-text editor's document).
  const [generation, setGeneration] = useState(0);
  // The tab's copy is read after mounting, never while rendering, so the server's HTML and the
  // first client render agree; a restored copy then replaces the values like "reload theirs".
  const replaceValues = useCallback((values: Record<string, unknown>) => {
    latest.current = values;
    setData(values);
    setGeneration((g) => g + 1);
  }, []);
  const [store] = useState(() => unsavedStore(userId));
  const [save] = useState<SaveDraft>(() => (id: string, version: number, values: unknown) => saveDraftAction(id, version, values, userId));
  const [sessionIsValid] = useState(() => () => sessionIsUser(userId));
  const autosave = useAutosave({ entryId, initialVersion, save, sessionIsValid, loadLatest: loadDraftAction, store, onRestore: replaceValues });
  const { schedule, takeTheirs, pendingData, close, discardRestored } = autosave;
  useEffect(() => onSignOut(close), [close]);
  const discardCopy = useCallback(() => {
    discardRestored();
    replaceValues(initialData);
  }, [discardRestored, replaceValues, initialData]);
  const blocked = autosave.state === 'conflict' || autosave.state === 'signed_out' || autosave.state === 'restored';
  const hasUnsaved = useCallback(() => pendingData() !== null, [pendingData]);
  const reloadTheirs = useCallback(() => {
    const theirs = takeTheirs();
    if (theirs !== null) replaceValues(theirs);
  }, [takeTheirs, replaceValues]);
  const change = useCallback(
    (key: string, value: unknown) => {
      const next = { ...latest.current };
      if (value === undefined) delete next[key];
      else next[key] = value;
      latest.current = next;
      setData(next);
      schedule(next);
    },
    [schedule],
  );
  const titleValue = data[titleKey];
  const title = useMemo(() => (typeof titleValue === 'string' ? titleValue : ''), [titleValue]);
  const fieldLabels = useMemo(() => Object.fromEntries(fields.map((f) => [f.key, f.label])), [fields]);

  return (
    <EditorTenantProvider value={tenant}>
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <form onSubmit={(e) => e.preventDefault()} className="flex min-w-0 flex-col gap-5">
          {restored ? (
            <Notice tone="success" role="status">
              {t.editor.history.restored}
            </Notice>
          ) : null}
          {fields.map((field) => (
            <FieldInput
              key={`${field.key}:${generation}`}
              field={field}
              id={`field-${field.key}`}
              value={data[field.key]}
              onChange={(value) => change(field.key, value)}
            />
          ))}
          <SlugField entryId={entryId} initialSlug={initialSlug} title={title} locked={slugLocked} setSlug={setSlugAction} />
          {autosave.state === 'conflict' ? (
            <ConflictNotice theirs={autosave.theirs} fields={fields} mine={data} retry={autosave.retry} keepMine={autosave.keepMine} reloadTheirs={reloadTheirs} />
          ) : autosave.state === 'restored' ? (
            <RestoredNotice save={autosave.saveRestored} discard={discardCopy} />
          ) : (
            <SaveStatus state={autosave.state} retry={autosave.retry} />
          )}
        </form>
        <div className="flex min-w-0 flex-col gap-8">
          <div className="flex flex-col gap-4">
            {/* The request carries the version the editor last saw (review focus 3). */}
            <PublishPanel
              entryId={entryId}
              version={autosave.version}
              disabled={blocked}
              initiallyPublished={published}
              fieldLabels={fieldLabels}
            />
            {/* Preview shows the saved draft (spec §7.5, M3-12). */}
            <PreviewButton
              entryId={entryId}
              disabled={blocked}
              unsaved={() => autosave.state === 'saving' || autosave.pendingData() !== null}
            />
          </div>
          <RevisionHistory
            entryId={entryId}
            revisions={revisions}
            version={autosave.version}
            disabled={blocked}
            hasUnsaved={hasUnsaved}
          />
        </div>
      </div>
    </EditorTenantProvider>
  );
}

const NOTICE_COLUMN = 'flex flex-col items-start gap-3';
// A fixed line height keeps the form from jumping when the status text appears.
const SAVE_LINE = 'min-h-5 text-sm text-muted';

type ConflictProps = {
  theirs: TheirVersion | undefined;
  fields: FieldDescriptor[];
  mine: Record<string, unknown>;
  retry: () => void;
  keepMine: () => void;
  reloadTheirs: () => void;
};

/**
 * A stale save (spec §5.5, M2-11): the editor's values stay in the form; every field that differs
 * from the newer version is listed with both values, and the editor picks one version. If the newer
 * version cannot be read, the editor can try again or reload the page (M1's way out).
 */
function ConflictNotice({ theirs, fields, mine, retry, keepMine, reloadTheirs }: ConflictProps) {
  const r = t.editor.resolve;
  const ready = theirs?.status === 'ready' ? theirs : null;
  const changed = useMemo(() => (ready ? changedFields(fields, mine, ready.data) : []), [ready, fields, mine]);
  return (
    <Notice as="div" tone="error" role="alert" className={NOTICE_COLUMN}>
      <strong>{t.editor.conflict}</strong>
      <p>{t.editor.conflictBody}</p>
      {theirs?.status === 'failed' || theirs === undefined ? (
        <>
          {theirs && <p>{r.loadError}</p>}
          <div className="flex flex-wrap gap-3">
            {theirs && <Button onClick={retry}>{t.editor.retry}</Button>}
            <Button onClick={() => window.location.reload()}>{t.editor.reload}</Button>
          </div>
        </>
      ) : ready === null ? (
        <p>{r.loading}</p>
      ) : (
        <>
          {changed.length === 0 ? (
            <p>{r.same}</p>
          ) : (
            <section aria-label={r.changed} className="flex w-full flex-col gap-3">
              <h2 className="text-[15px] font-medium">{r.changed}</h2>
              {changed.map((f) => (
                <div key={f.key} data-testid="conflict-field" className="flex flex-col gap-1.5">
                  <h3 className="text-[15px] font-medium">{f.label}</h3>
                  <dl className="grid gap-2 sm:grid-cols-2">
                    <div data-side="theirs" className="min-w-0">
                      <dt className="text-sm text-muted">{r.theirs}</dt>
                      <dd className="whitespace-pre-wrap break-words">{f.theirs}</dd>
                    </div>
                    <div data-side="mine" className="min-w-0">
                      <dt className="text-sm text-muted">{r.mine}</dt>
                      <dd className="whitespace-pre-wrap break-words">{f.mine}</dd>
                    </div>
                  </dl>
                </div>
              ))}
            </section>
          )}
          <div className="flex flex-col gap-1.5">
            <Button onClick={keepMine}>{r.keepMine}</Button>
            <p className="text-sm">{r.keepMineHint}</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Button onClick={reloadTheirs}>{r.reloadTheirs}</Button>
            <p className="text-sm">{r.reloadTheirsHint}</p>
          </div>
        </>
      )}
    </Notice>
  );
}

/**
 * Unsaved changes this tab kept from before a reload (M2-17): they are in the form but not saved
 * until the editor chooses to save them, or to drop them and go back to the saved draft.
 */
function RestoredNotice({ save, discard }: { save: () => void; discard: () => void }) {
  return (
    <Notice as="div" tone="info" role="alert" className={NOTICE_COLUMN}>
      <strong>{t.editor.restoredCopy}</strong>
      <p>{t.editor.restoredCopyBody}</p>
      <div className="flex flex-wrap gap-3">
        <Button onClick={save}>{t.editor.restoredCopySave}</Button>
        <Button onClick={discard}>{t.editor.restoredCopyDiscard}</Button>
      </div>
    </Notice>
  );
}

function SaveStatus({ state, retry }: { state: Exclude<ReturnType<typeof useAutosave>['state'], 'conflict' | 'restored'>; retry: () => void }) {
  switch (state) {
    case 'signed_out':
      return (
        <Notice as="div" tone="error" role="alert" className={NOTICE_COLUMN}>
          <strong>{t.editor.signedOut}</strong>
          <p>{t.editor.signedOutBody}</p>
          <a href="/login" target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center font-medium">{t.editor.signIn}</a>
          <Button onClick={retry}>{t.editor.retry}</Button>
        </Notice>
      );
    case 'error':
      return (
        <Notice as="div" tone="error" role="alert" className={NOTICE_COLUMN}>
          <p>{t.editor.error}</p>
          <Button onClick={retry}>{t.editor.retry}</Button>
        </Notice>
      );
    case 'saving':
      return <p role="status" className={SAVE_LINE}>{t.editor.saving}</p>;
    case 'saved':
      return <p role="status" className={SAVE_LINE}>{t.editor.saved}</p>;
    case 'idle':
      return <p role="status" className={SAVE_LINE} />;
  }
}
