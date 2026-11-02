'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { saveDraftAction, setSlugAction } from '@/app/(editor)/t/[tenant]/actions';
import { t } from '@/i18n/is';
import { createBrowserEditorClient } from '@/lib/supabase/browser';
import { useAutosave } from '../autosave';
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
 * autosave; local values stay on the screen whatever the save answers.
 */
export function EntryForm({ tenant, entryId, fields, titleKey, initialData, initialVersion, initialSlug, slugLocked }: Props) {
  const [data, setData] = useState<Record<string, unknown>>(initialData);
  const latest = useRef(data);
  const autosave = useAutosave({ entryId, initialVersion, save: saveDraftAction, sessionIsValid });
  const { schedule } = autosave;
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

  return (
    <EditorTenantProvider value={tenant}>
      <form onSubmit={(e) => e.preventDefault()}>
        {fields.map((field) => {
          const Component = fieldRegistry[field.kind];
          const id = `field-${field.key}`;
          if (!Component) {
            return (
              <div key={field.key}>
                <span>{field.label}</span>
                <p role="note">{t.editor.unsupportedField}</p>
              </div>
            );
          }
          return (
            <Component
              key={field.key}
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
        <SaveStatus state={autosave.state} retry={autosave.retry} />
      </form>
    </EditorTenantProvider>
  );
}

function SaveStatus({ state, retry }: { state: ReturnType<typeof useAutosave>['state']; retry: () => void }) {
  switch (state) {
    case 'conflict':
      return (
        <div role="alert">
          <strong>{t.editor.conflict}</strong>
          <p>{t.editor.conflictBody}</p>
          <button type="button" onClick={() => window.location.reload()}>{t.editor.reload}</button>
        </div>
      );
    case 'signed_out':
      return (
        <div role="alert">
          <strong>{t.editor.signedOut}</strong>
          <p>{t.editor.signedOutBody}</p>
          <a href="/login" target="_blank" rel="noreferrer">{t.editor.signIn}</a>
          <button type="button" onClick={retry}>{t.editor.retry}</button>
        </div>
      );
    case 'error':
      return (
        <div role="alert">
          <p>{t.editor.error}</p>
          <button type="button" onClick={retry}>{t.editor.retry}</button>
        </div>
      );
    case 'saving':
      return <p role="status">{t.editor.saving}</p>;
    case 'saved':
      return <p role="status">{t.editor.saved}</p>;
    case 'idle':
      return <p role="status" />;
  }
}
