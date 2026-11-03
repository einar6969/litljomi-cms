'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { saveDraftAction, setSlugAction } from '@/app/(editor)/t/[tenant]/actions';
import { t } from '@/i18n/is';
import { createBrowserEditorClient } from '@/lib/supabase/browser';
import { Button } from '@/ui/Button';
import { Notice } from '@/ui/Notice';
import { useAutosave } from '../autosave';
import { PublishPanel } from '../publish/PublishPanel';
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
 * autosave; local values stay on the screen whatever the save answers.
 */
export function EntryForm({ tenant, entryId, fields, titleKey, initialData, initialVersion, initialSlug, slugLocked, published = false }: Props) {
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
                key={field.key}
                id={id}
                label={field.label}
                required={field.required}
                max={field.max}
                multiline={field.multiline}
                min={field.min}
                integer={field.integer}
                options={field.options}
                value={data[field.key]}
                onChange={(value) => change(field.key, value)}
              />
            );
          })}
          <SlugField entryId={entryId} initialSlug={initialSlug} title={title} locked={slugLocked} setSlug={setSlugAction} />
          <SaveStatus state={autosave.state} retry={autosave.retry} />
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

function SaveStatus({ state, retry }: { state: ReturnType<typeof useAutosave>['state']; retry: () => void }) {
  switch (state) {
    case 'conflict':
      return (
        <Notice as="div" tone="error" role="alert" className={NOTICE_COLUMN}>
          <strong>{t.editor.conflict}</strong>
          <p>{t.editor.conflictBody}</p>
          <Button onClick={() => window.location.reload()}>{t.editor.reload}</Button>
        </Notice>
      );
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
