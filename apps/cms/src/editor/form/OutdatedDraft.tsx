'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { updateDraftSchemaAction, type UpdateDraftSchemaResult } from '@/app/(editor)/t/[tenant]/actions';
import { t } from '@/i18n/is';
import { Button } from '@/ui/Button';
import { Notice } from '@/ui/Notice';
import { PublishPanel } from '../publish/PublishPanel';

type Props = {
  entryId: string;
  /** The draft version the page read: the update expects it. */
  version: number;
  /** The entry has a published revision (it can still be taken down). */
  published: boolean;
  fieldLabels: Readonly<Record<string, string>>;
  update?: (entryId: string, version: number) => Promise<UpdateDraftSchemaResult>;
  loadStatus?: Parameters<typeof PublishPanel>[0]['loadStatus'];
};

type State = 'idle' | 'updating' | 'done' | 'conflict' | 'signed_out' | 'failed' | 'cannot';


/**
 * The entry page for a draft written at an older schema version of its type (spec §5.3; plan
 * M2-14). The form is not shown: its fields are the current version's, and an autosave would
 * stamp the old data as current, dropping what the transforms would have moved. The editor updates
 * the draft (the server upcasts it and saves it as a normal versioned update), then the page is
 * read again and shows the form. Publishing waits for the update; the panel still shows the
 * entry's latest request (an outdated publish says so in plain words) and can take it down.
 */
export function OutdatedDraft({ entryId, version, published, fieldLabels, update = updateDraftSchemaAction, loadStatus }: Props) {
  const router = useRouter();
  const [state, setState] = useState<State>('idle');

  const run = async () => {
    setState('updating');
    let result: UpdateDraftSchemaResult;
    try {
      result = await update(entryId, version);
    } catch {
      result = { ok: false, code: 'error' };
    }
    if (result.ok) {
      setState('done');
      router.refresh();
      return;
    }
    switch (result.code) {
      case 'version_conflict':
        return setState('conflict');
      case 'auth':
        return setState('signed_out');
      case 'upcast_failed':
      case 'invalid':
        return setState('cannot');
      default:
        return setState('failed');
    }
  };

  const busy = state === 'updating' || state === 'done';
  const canRetry = state !== 'conflict' && state !== 'cannot';

  return (
    <div className="ed">
      <div className="flex min-w-0 flex-col gap-4">
        <Notice as="div" tone="warning" role="alert">
          <strong>{t.editor.outdated.title}</strong>
          <p>{t.editor.outdated.body}</p>
          {canRetry ? (
            <div className="note-acts">
              <Button variant="ink" size="sm" disabled={busy} onClick={() => void run()}>
                {busy ? t.editor.outdated.updating : t.editor.outdated.update}
              </Button>
            </div>
          ) : null}
        </Notice>
        <Outcome state={state} />
      </div>
      <PublishPanel
        entryId={entryId}
        version={version}
        disabled
        initiallyPublished={published}
        fieldLabels={fieldLabels}
        {...(loadStatus ? { loadStatus } : {})}
      />
    </div>
  );
}

function Outcome({ state }: { state: State }) {
  switch (state) {
    case 'conflict':
      return (
        <Notice as="div" tone="error" role="alert">
          <strong>{t.editor.conflict}</strong>
          <Button onClick={() => window.location.reload()}>{t.editor.reload}</Button>
        </Notice>
      );
    case 'signed_out':
      return (
        <Notice as="div" tone="error" role="alert">
          <strong>{t.editor.signedOut}</strong>
          <a href="/login" target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center font-medium">
            {t.editor.signIn}
          </a>
        </Notice>
      );
    case 'failed':
      return (
        <Notice tone="error" role="alert">
          {t.editor.outdated.failed}
        </Notice>
      );
    case 'cannot':
      return (
        <Notice tone="error" role="alert">
          {t.editor.outdated.cannotUpdate}
        </Notice>
      );
    default:
      return null;
  }
}
