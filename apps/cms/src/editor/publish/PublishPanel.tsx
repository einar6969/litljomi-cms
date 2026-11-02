'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { requestPublishAction, requestUnpublishAction, type PublishActionResult } from '@/app/(editor)/t/[tenant]/publish-actions';
import { t } from '@/i18n/is';
import { createBrowserEditorClient } from '@/lib/supabase/browser';
import { Button } from '@/ui/Button';
import { Notice } from '@/ui/Notice';
import { StatusBadge } from '@/ui/StatusBadge';
import { displayState, isFinal, PUBLICATION_STATUS_COLUMNS, type DisplayState, type PublicationStatusRow } from './status';

/** The panel polls the entry's status this often while it is not final (plan Task 25). */
export const POLL_MS = 2000;

type Props = {
  entryId: string;
  /** The draft version the editor last saw (the autosave's): a publish request carries it. */
  version: number;
  /** True while the form cannot publish what is on the screen (a save conflict, a lost session). */
  disabled?: boolean;
  /** The entry has a published revision now (`entry_detail.status` published or changed). */
  initiallyPublished: boolean;
  /** The type's field labels by key, to name the fields a validation failure is about. */
  fieldLabels: Readonly<Record<string, string>>;
  publish?: typeof requestPublishAction;
  unpublish?: typeof requestUnpublishAction;
  loadStatus?: (entryId: string) => Promise<PublicationStatusRow | null>;
};

/** The entry's row of `api.publication_status`, read with the editor's own session (RLS). */
async function loadPublicationStatus(entryId: string): Promise<PublicationStatusRow | null> {
  const { data, error } = await createBrowserEditorClient()
    .from('publication_status')
    .select(PUBLICATION_STATUS_COLUMNS)
    .eq('entry_id', entryId)
    .maybeSingle();
  if (error) throw new Error(`publication_status: ${error.code}`);
  return (data as PublicationStatusRow | null) ?? null;
}

const requestNotice = (result: Exclude<PublishActionResult, { requestId: string }>['error']): string => {
  switch (result) {
    case 'version_conflict':
      return t.publish.superseded;
    case 'auth':
      return t.editor.signedOut;
    case 'tenant_inactive':
      return t.tenant.inactiveBody;
    default:
      return t.publish.requestFailed;
  }
};

/**
 * Publish and unpublish for one entry, and its publication state (spec §7.4). After a request, and
 * on load, the entry's latest request is read every POLL_MS until its state is final.
 */
export function PublishPanel({
  entryId,
  version,
  disabled = false,
  initiallyPublished,
  fieldLabels,
  publish = requestPublishAction,
  unpublish = requestUnpublishAction,
  loadStatus = loadPublicationStatus,
}: Props) {
  const [row, setRow] = useState<PublicationStatusRow | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [published, setPublished] = useState(initiallyPublished);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // The request this panel just made: until the view shows it, the state is "Í birtingu…".
  const [awaiting, setAwaiting] = useState<string | null>(null);
  const [pollRun, setPollRun] = useState(0);
  const awaitingRef = useRef(awaiting);
  awaitingRef.current = awaiting;
  const labelsRef = useRef(fieldLabels);
  labelsRef.current = fieldLabels;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      let next: PublicationStatusRow | null | undefined;
      try {
        next = await loadStatus(entryId);
      } catch {
        next = undefined;
      }
      if (cancelled) return;
      setLoadFailed(next === undefined);
      if (next !== undefined) setRow(next);
      const waitingFor = awaitingRef.current;
      const settled =
        next === null
          ? waitingFor === null
          : next !== undefined && (waitingFor === null || next.request_id === waitingFor) && isFinal(displayState(next, { fieldLabels: labelsRef.current }));
      if (settled) {
        if (next && next.status === 'committed') setPublished(next.action === 'publish');
        return;
      }
      timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [entryId, loadStatus, pollRun]);

  const send = useCallback(
    async (call: () => Promise<PublishActionResult>) => {
      setBusy(true);
      setNotice(null);
      try {
        const result = await call();
        if ('requestId' in result) {
          setAwaiting(result.requestId);
          awaitingRef.current = result.requestId;
          setPollRun((n) => n + 1);
        } else {
          setNotice(requestNotice(result.error));
        }
      } catch {
        setNotice(t.publish.requestFailed);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const shown = row && (awaiting === null || row.request_id === awaiting) ? displayState(row, { fieldLabels }) : null;
  const state: DisplayState | null = shown ?? (awaiting !== null ? { label: t.publish.inProgress, tone: 'pending' } : null);
  const inFlight = busy || (state !== null && !isFinal(state));

  return (
    <section aria-labelledby="publish-heading" className="flex flex-col gap-4 rounded-lg border border-hairline bg-recessed p-5">
      <h2 id="publish-heading" className="text-xs font-semibold uppercase leading-4 tracking-wider text-muted">
        {t.publish.heading}
      </h2>
      {/* Not role="status": the form's save status is the page's one status region. */}
      <StatusBadge tone={state?.tone ?? 'pending'} data-testid="publish-state" data-tone={state?.tone ?? 'none'} aria-live="polite">
        {state?.label ?? t.publish.none}
      </StatusBadge>
      {state?.detail ? (
        <p data-testid="publish-detail" className="text-sm text-muted">
          {state.detail}
        </p>
      ) : null}
      {loadFailed ? <Notice role="note">{t.publish.statusUnavailable}</Notice> : null}
      {notice ? (
        <Notice tone="error" role="alert">
          {notice}
        </Notice>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button variant="primary" className="max-sm:flex-1" disabled={disabled || inFlight} onClick={() => void send(() => publish(entryId, version))}>
          {t.publish.publish}
        </Button>
        {published ? (
          <Button variant="danger" className="max-sm:flex-1" disabled={inFlight} onClick={() => void send(() => unpublish(entryId))}>
            {t.publish.unpublish}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
