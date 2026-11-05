'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { loadDraftAction, saveDraftAction } from '@/app/(editor)/t/[tenant]/actions';
import { t } from '@/i18n/is';
import { createBrowserEditorClient } from '@/lib/supabase/browser';
import { Button, linkButtonClasses } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { SAVE_SLOT_ID } from '@/ui/TopBar';
import { useAutosave, type SaveDraft, type TheirVersion } from '../autosave';
import { PreviewButton } from '../publish/PreviewButton';
import { PublishPanel } from '../publish/PublishPanel';
import type { RevisionSummary } from '../revisions';
import { onSignOut, unsavedStore } from '../unsaved';
import { changedFields } from './conflict';
import type { FieldDescriptor } from './descriptors';
import { FieldInput } from './FieldInput';
import { RevisionHistory } from './RevisionHistory';
import { EditorTenantProvider, type EditorTenant } from './tenant-context';

type Props = {
  /** The entry's tenant, as the page resolved it through `api.my_tenants`. */
  tenant: EditorTenant;
  /** The signed-in user the page was rendered for, as Supabase Auth verified it. */
  userId: string;
  entryId: string;
  fields: FieldDescriptor[];
  /** The field the list title comes from: it is set larger than the rest. */
  titleKey: string;
  initialData: Record<string, unknown>;
  initialVersion: number;
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
export function EntryForm({ tenant, userId, entryId, fields, titleKey, initialData, initialVersion, published = false, revisions = [], restored = false }: Props) {
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
  const fieldLabels = useMemo(() => Object.fromEntries(fields.map((f) => [f.key, f.label])), [fields]);

  return (
    <EditorTenantProvider value={tenant}>
      {restored ? (
        <Notice tone="success" role="status">
          {t.editor.history.restored}
        </Notice>
      ) : null}
      {autosave.state === 'conflict' ? (
        <ConflictNotice theirs={autosave.theirs} fields={fields} mine={data} retry={autosave.retry} keepMine={autosave.keepMine} reloadTheirs={reloadTheirs} />
      ) : autosave.state === 'restored' ? (
        <RestoredNotice save={autosave.saveRestored} discard={discardCopy} />
      ) : (
        <SaveProblem state={autosave.state} retry={autosave.retry} />
      )}
      <SaveSlot>
        <SaveLine state={autosave.state} />
      </SaveSlot>
      <div className="ed">
        <form onSubmit={(e) => e.preventDefault()} className="card sheet">
          {fields.map((field) => (
            <div key={`${field.key}:${generation}`} data-title-field={field.key === titleKey ? '' : undefined}>
              <FieldInput field={field} id={`field-${field.key}`} value={data[field.key]} onChange={(value) => change(field.key, value)} />
            </div>
          ))}
        </form>
        <div className="rail">
          {/* The request carries the version the editor last saw (review focus 3). */}
          <PublishPanel entryId={entryId} version={autosave.version} disabled={blocked} initiallyPublished={published} fieldLabels={fieldLabels}>
            {/* Preview shows the saved draft (spec §7.5, M3-12). */}
            <PreviewButton entryId={entryId} disabled={blocked} unsaved={() => autosave.state === 'saving' || autosave.pendingData() !== null} />
          </PublishPanel>
          <div className="slot-hist">
            <RevisionHistory entryId={entryId} revisions={revisions} version={autosave.version} disabled={blocked} hasUnsaved={hasUnsaved} />
          </div>
        </div>
      </div>
    </EditorTenantProvider>
  );
}

/** Puts the save status in the top bar, where it stays in view; without a bar it stays in place. */
function SaveSlot({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<Element | null>(null);
  useEffect(() => setSlot(document.getElementById(SAVE_SLOT_ID)), []);
  return slot ? createPortal(children, slot) : children;
}

function SaveLine({ state }: { state: ReturnType<typeof useAutosave>['state'] }) {
  switch (state) {
    case 'saving':
      return (
        <p role="status" className="save">
          <span className="spin" />
          {t.editor.saving}
        </p>
      );
    case 'saved':
      return (
        <p role="status" className="save">
          <Icon name="check" />
          {t.editor.saved}
        </p>
      );
    case 'error':
    case 'signed_out':
    case 'conflict':
      return (
        <p className="save save-bad">
          <Icon name="alert" />
          {t.editor.notSaved}
        </p>
      );
    default:
      return <p role="status" className="save" />;
  }
}

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
    <Notice as="div" tone="error" role="alert">
      <strong>{t.editor.conflict}</strong>
      <p>{t.editor.conflictBody}</p>
      {theirs?.status === 'failed' || theirs === undefined ? (
        <>
          {theirs && <p>{r.loadError}</p>}
          <div className="note-acts">
            {theirs && (
              <Button size="sm" onClick={retry}>
                {t.editor.retry}
              </Button>
            )}
            <Button size="sm" onClick={() => window.location.reload()}>
              {t.editor.reload}
            </Button>
          </div>
        </>
      ) : ready === null ? (
        <p className="inline-flex items-center gap-2 text-sm">
          <span className="spin" />
          {r.loading}
        </p>
      ) : (
        <>
          {changed.length === 0 ? (
            <p>{r.same}</p>
          ) : (
            <section aria-label={r.changed} className="compare">
              <h2 className="lab">{r.changed}</h2>
              {changed.map((f) => (
                <div key={f.key} data-testid="conflict-field">
                  <h3>{f.label}</h3>
                  <dl className="cmp">
                    <div data-side="theirs">
                      <dt>{r.theirs}</dt>
                      <dd className="whitespace-pre-wrap break-words">{f.theirs}</dd>
                    </div>
                    <div data-side="mine">
                      <dt>{r.mine}</dt>
                      <dd className="whitespace-pre-wrap break-words">{f.mine}</dd>
                    </div>
                  </dl>
                </div>
              ))}
            </section>
          )}
          <div className="way">
            <div>
              <Button variant="ink" onClick={keepMine}>
                {r.keepMine}
              </Button>
              <p className="text-sm">{r.keepMineHint}</p>
            </div>
            <div>
              <Button onClick={reloadTheirs}>{r.reloadTheirs}</Button>
              <p className="text-sm">{r.reloadTheirsHint}</p>
            </div>
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
    <Notice as="div" tone="info" role="alert">
      <strong>{t.editor.restoredCopy}</strong>
      <p>{t.editor.restoredCopyBody}</p>
      <div className="note-acts">
        <Button variant="ink" size="sm" onClick={save}>
          {t.editor.restoredCopySave}
        </Button>
        <Button size="sm" onClick={discard}>
          {t.editor.restoredCopyDiscard}
        </Button>
      </div>
    </Notice>
  );
}

function SaveProblem({ state, retry }: { state: ReturnType<typeof useAutosave>['state']; retry: () => void }) {
  switch (state) {
    case 'signed_out':
      return (
        <Notice as="div" tone="error" role="alert">
          <strong>{t.editor.signedOut}</strong>
          <p>{t.editor.signedOutBody}</p>
          <div className="note-acts">
            <a href="/login" target="_blank" rel="noreferrer" className={linkButtonClasses('ink', 'sm')}>
              {t.editor.signIn}
              <Icon name="arrowUpRight" />
            </a>
            <Button size="sm" onClick={retry}>
              {t.editor.retry}
            </Button>
          </div>
        </Notice>
      );
    case 'error':
      return (
        <Notice as="div" tone="error" role="alert">
          <p>{t.editor.error}</p>
          <div className="note-acts">
            <Button size="sm" onClick={retry}>
              {t.editor.retry}
            </Button>
          </div>
        </Notice>
      );
    default:
      return null;
  }
}
