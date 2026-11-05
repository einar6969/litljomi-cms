'use client';

import { useState } from 'react';
import { restoreRevisionAction, type RestoreRevisionResult } from '@/app/(editor)/t/[tenant]/actions';
import { t } from '@/i18n/is';
import { Button } from '@/ui/Button';
import { Notice } from '@/ui/Notice';
import { StatusBadge } from '@/ui/StatusBadge';
import { RESTORED_PARAM, type RevisionSummary } from '../revisions';

type Props = {
  entryId: string;
  /** Published revisions, newest first (the page reads them from `api.revision_list`). */
  revisions: readonly RevisionSummary[];
  /** The draft version the editor last saw (the autosave's): the restore expects it. */
  version: number;
  /** True while the form cannot save on top of what it has (a save conflict, a lost session). */
  disabled?: boolean;
  /** True while an edit is not yet saved: a restore now would race the autosave. */
  hasUnsaved: () => boolean;
  restore?: (entryId: string, revisionId: string, version: number) => Promise<RestoreRevisionResult>;
  /** After a restore the page is read again, so the form shows the restored draft. */
  onRestored?: () => void;
};

type State =
  | { kind: 'idle' }
  | { kind: 'confirm'; id: string }
  | { kind: 'restoring'; id: string }
  | { kind: 'unsaved' | 'conflict' | 'signed_out' | 'failed' | 'cannot' | 'done' };

/** Opens the entry page again with the restored marker, so the page reads the new draft and says so. */
function reopenRestored() {
  const url = new URL(window.location.href);
  url.searchParams.set(RESTORED_PARAM, '1');
  window.location.assign(url.toString());
}

const when = (iso: string) => new Date(iso).toLocaleString('is-IS', { timeZone: 'Atlantic/Reykjavik', dateStyle: 'medium', timeStyle: 'short' });

/**
 * The entry's revision history (spec §5.5; plan M2-16): its published revisions, newest first,
 * with when and whether the reader published it, the one on the site marked. Restoring one copies
 * its data, upcast to the current version, into the draft as a normal versioned save (on the
 * server); nothing is published until the editor publishes. A restore waits for unsaved edits, and
 * asks first, because it replaces the draft.
 */
export function RevisionHistory({ entryId, revisions, version, disabled = false, hasUnsaved, restore = restoreRevisionAction, onRestored = reopenRestored }: Props) {
  const h = t.editor.history;
  const [state, setState] = useState<State>({ kind: 'idle' });
  const busy = state.kind === 'restoring' || state.kind === 'done';

  const ask = (id: string) => setState(hasUnsaved() ? { kind: 'unsaved' } : { kind: 'confirm', id });

  const run = async (id: string) => {
    if (hasUnsaved()) return setState({ kind: 'unsaved' });
    setState({ kind: 'restoring', id });
    let result: RestoreRevisionResult;
    try {
      result = await restore(entryId, id, version);
    } catch {
      result = { ok: false, code: 'error' };
    }
    if (result.ok) {
      setState({ kind: 'done' });
      onRestored();
      return;
    }
    switch (result.code) {
      case 'version_conflict':
        return setState({ kind: 'conflict' });
      case 'auth':
        return setState({ kind: 'signed_out' });
      case 'upcast_failed':
      case 'invalid':
        return setState({ kind: 'cannot' });
      default:
        return setState({ kind: 'failed' });
    }
  };

  return (
    <section aria-labelledby="revision-history" className="card sub">
      <h2 id="revision-history">{h.title}</h2>
      {revisions.length === 0 ? (
        <p className="text-sm text-muted">{h.empty}</p>
      ) : (
        <ol>
          {revisions.map((r) => (
            <li key={r.id} data-testid="revision" className="rev">
              <p className="text-sm">
                {h.publishedAt}{' '}
                <time className="mono" dateTime={r.committedAt}>
                  {when(r.committedAt)}
                </time>{' '}
                {r.mine ? h.byMe : h.byOther}
              </p>
              {r.current ? <StatusBadge tone="ok">{h.current}</StatusBadge> : null}
              {state.kind === 'confirm' && state.id === r.id ? (
                <>
                  <p className="text-sm">{h.confirm}</p>
                  <div className="acts">
                    <Button variant="ink" size="sm" disabled={disabled} onClick={() => void run(r.id)}>
                      {h.confirmRestore}
                    </Button>
                    <Button size="sm" onClick={() => setState({ kind: 'idle' })}>
                      {h.cancel}
                    </Button>
                  </div>
                </>
              ) : (
                <Button size="sm" disabled={disabled || busy} onClick={() => ask(r.id)}>
                  {state.kind === 'restoring' && state.id === r.id ? h.restoring : h.restore}
                </Button>
              )}
            </li>
          ))}
        </ol>
      )}
      <Outcome kind={state.kind} />
    </section>
  );
}

function Outcome({ kind }: { kind: State['kind'] }) {
  const h = t.editor.history;
  switch (kind) {
    case 'unsaved':
      return <Notice role="alert">{h.unsaved}</Notice>;
    case 'conflict':
      return (
        <Notice as="div" tone="error" role="alert">
          <strong>{t.editor.conflict}</strong>
          <Button size="sm" onClick={() => window.location.reload()}>
            {t.editor.reload}
          </Button>
        </Notice>
      );
    case 'signed_out':
      return (
        <Notice as="div" tone="error" role="alert">
          <strong>{t.editor.signedOut}</strong>
          <a href="/login" target="_blank" rel="noreferrer">
            {t.editor.signIn}
          </a>
        </Notice>
      );
    case 'failed':
      return (
        <Notice tone="error" role="alert">
          {h.failed}
        </Notice>
      );
    case 'cannot':
      return (
        <Notice tone="error" role="alert">
          {h.cannot}
        </Notice>
      );
    default:
      return null;
  }
}
