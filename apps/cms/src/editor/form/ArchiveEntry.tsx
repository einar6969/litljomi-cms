'use client';

import { useState } from 'react';
import { archiveEntryAction, type ArchiveEntryResult } from '@/app/(editor)/t/[tenant]/actions';
import { t } from '@/i18n/is';
import { Button } from '@/ui/Button';
import { Notice } from '@/ui/Notice';

type Props = {
  entryId: string;
  /** True while the form cannot act on the entry (a save conflict, a lost session). */
  disabled?: boolean;
  archive?: (entryId: string) => Promise<ArchiveEntryResult>;
  /** Called once the entry is archived, before leaving the page: the form drops its unsaved copy. */
  beforeLeave?: () => void;
  /** Where the editor goes once the entry is archived: its list. */
  onArchived?: (listPath: string) => void;
};

type State = 'idle' | 'confirm' | 'archiving' | 'done' | 'published' | 'signed_out' | 'failed';

const goTo = (path: string) => window.location.assign(path);

/**
 * Archives an entry that is not published (enhancement A6; §4.6 `api.archive_entry`). The form
 * shows it only while the entry is not published and no request is on its way; the database still
 * decides. It asks first, because nothing in the editor brings an archived entry back. Once
 * archived, the editor is taken to the entry's list, which no longer shows it.
 */
export function ArchiveEntry({ entryId, disabled = false, archive = archiveEntryAction, beforeLeave, onArchived = goTo }: Props) {
  const a = t.editor.archive;
  const [state, setState] = useState<State>('idle');

  const run = async () => {
    setState('archiving');
    let result: ArchiveEntryResult;
    try {
      result = await archive(entryId);
    } catch {
      result = { ok: false, code: 'error' };
    }
    if (result.ok) {
      setState('done');
      beforeLeave?.();
      onArchived(result.listPath);
      return;
    }
    setState(result.code === 'published' ? 'published' : result.code === 'auth' ? 'signed_out' : 'failed');
  };

  const busy = state === 'archiving' || state === 'done';
  return (
    <section aria-labelledby="archive-heading" className="card sub">
      <h2 id="archive-heading">{a.title}</h2>
      {state === 'confirm' || busy ? (
        <>
          <p className="text-sm">{a.confirm}</p>
          <div className="acts">
            <Button variant="danger" size="sm" disabled={disabled || busy} onClick={() => void run()}>
              {busy ? a.archiving : a.confirmButton}
            </Button>
            <Button size="sm" disabled={busy} onClick={() => setState('idle')}>
              {a.cancel}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-muted">{a.hint}</p>
          <Button size="sm" className="self-start" disabled={disabled} onClick={() => setState('confirm')}>
            {a.button}
          </Button>
        </>
      )}
      {state === 'published' || state === 'failed' || state === 'signed_out' ? (
        <Notice tone="error" role="alert">
          {state === 'published' ? a.published : state === 'signed_out' ? t.editor.signedOut : a.failed}
        </Notice>
      ) : null}
    </section>
  );
}
