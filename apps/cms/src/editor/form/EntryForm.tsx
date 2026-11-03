'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { loadDraftAction, saveDraftAction, setSlugAction } from '@/app/(editor)/t/[tenant]/actions';
import { t } from '@/i18n/is';
import { createBrowserEditorClient } from '@/lib/supabase/browser';
import { Button } from '@/ui/Button';
import { Notice } from '@/ui/Notice';
import { useAutosave, type TheirVersion } from '../autosave';
import { PublishPanel } from '../publish/PublishPanel';
import { changedFields } from './conflict';
import type { FieldDescriptor } from './descriptors';
import { fieldRegistry } from './field-registry';
import { SlugField } from './SlugField';
import { EditorTenantProvider, type EditorTenant } from './tenant-context';

type Props = {
  /** The entry's tenant, as the page resolved it through `api.my_tenants`. */
  tenant: EditorTenant;
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
};

/** False only when Supabase Auth says the browser has no valid session (not on a network failure). */
async function sessionIsValid(): Promise<boolean> {
  const { data, error } = await createBrowserEditorClient().auth.getUser();
  if (data.user) return true;
  return !(error && (error.name === 'AuthSessionMissingError' || error.status === 401 || error.status === 403));
}

/**
 * The generated form of one entry. Its state is the whole draft data: a field this form cannot
 * edit yet is never touched, so it is sent back exactly as it was loaded. Every edit schedules an
 * autosave; local values stay on the screen whatever the save answers. A stale save shows the
 * conflict view (M2-11): only "reload theirs" replaces the form's values.
 */
export function EntryForm({ tenant, entryId, fields, titleKey, initialData, initialVersion, initialSlug, slugLocked, published = false }: Props) {
  const [data, setData] = useState<Record<string, unknown>>(initialData);
  const latest = useRef(data);
  // Bumped when "reload theirs" replaces the values, so every field remounts with them (a field may
  // hold its own editing state, such as the rich-text editor's document).
  const [generation, setGeneration] = useState(0);
  const autosave = useAutosave({ entryId, initialVersion, save: saveDraftAction, sessionIsValid, loadLatest: loadDraftAction });
  const { schedule, takeTheirs } = autosave;
  const reloadTheirs = useCallback(() => {
    const theirs = takeTheirs();
    if (theirs === null) return;
    latest.current = theirs;
    setData(theirs);
    setGeneration((g) => g + 1);
  }, [takeTheirs]);
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
          {fields.map((field) => {
            const Component = fieldRegistry[field.kind];
            const id = `field-${field.key}`;
            if (!Component) {
              return (
                <div key={field.key} className="flex flex-col gap-1.5">
                  <span className="text-[15px] font-medium">{field.label}</span>
                  <Notice role="note">{t.editor.unsupportedField}</Notice>
                </div>
              );
            }
            return (
              <Component
                key={`${field.key}:${generation}`}
                id={id}
                label={field.label}
                required={field.required}
                max={field.max}
                multiline={field.multiline}
                value={data[field.key]}
                onChange={(value) => change(field.key, value)}
              />
            );
          })}
          <SlugField entryId={entryId} initialSlug={initialSlug} title={title} locked={slugLocked} setSlug={setSlugAction} />
          {autosave.state === 'conflict' ? (
            <ConflictNotice theirs={autosave.theirs} fields={fields} mine={data} retry={autosave.retry} keepMine={autosave.keepMine} reloadTheirs={reloadTheirs} />
          ) : (
            <SaveStatus state={autosave.state} retry={autosave.retry} />
          )}
        </form>
        {/* The request carries the version the editor last saw (review focus 3). */}
        <PublishPanel
          entryId={entryId}
          version={autosave.version}
          disabled={autosave.state === 'conflict' || autosave.state === 'signed_out'}
          initiallyPublished={published}
          fieldLabels={fieldLabels}
        />
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

function SaveStatus({ state, retry }: { state: Exclude<ReturnType<typeof useAutosave>['state'], 'conflict'>; retry: () => void }) {
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
