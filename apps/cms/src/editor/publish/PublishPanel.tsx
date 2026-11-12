'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { requestPublishAction, requestUnpublishAction, type PublishActionResult } from '@/app/(editor)/t/[tenant]/publish-actions';
import { t } from '@/i18n/is';
import { createBrowserEditorClient } from '@/lib/supabase/browser';
import { Button } from '@/ui/Button';
import { Notice } from '@/ui/Notice';
import { StatusBadge } from '@/ui/StatusBadge';
import { answers, displayState, IN_PROGRESS, isFinal, PUBLICATION_STATUS_COLUMNS, refusedEntryIds, type DisplayState, type PublicationStatusRow } from './status';

/** The panel polls the entry's status this often while it is not final (plan Task 25). */
export const POLL_MS = 2000;

type Props = {
  entryId: string;
  /** The draft version the editor last saw (the autosave's): a publish request carries it. */
  version: number;
  /** True while the form cannot publish what is on the screen (a save conflict, a lost session). */
  disabled?: boolean;
  /** The entry has a published revision now (the entry's `status` is published or changed). */
  initiallyPublished: boolean;
  /**
   * The draft version that is published now (`published_draft_version`), or null. When the draft's
   * `version` has moved past it, a live entry reads "Óbirtar breytingar", not "Birt á vef ✓".
   */
  publishedVersion?: number | null;
  /** The type's field labels by key, to name the fields a validation failure is about. */
  fieldLabels: Readonly<Record<string, string>>;
  publish?: typeof requestPublishAction;
  unpublish?: typeof requestUnpublishAction;
  loadStatus?: (entryId: string) => Promise<PublicationStatusRow | null>;
  /** Titles of entries by id, to name the references a refused publish was about. */
  loadTitles?: (ids: readonly string[]) => Promise<Record<string, string | null>>;
  /** Told whether the entry can be archived now: not published, and no request on its way (A6). */
  onArchivableChange?: (archivable: boolean) => void;
  /** Shown at the panel's foot: the preview button. */
  children?: ReactNode;
};

/** The way to the site, as three segments under the status; only the steps that are on the way there have one. */
const TRACKS: Readonly<Record<string, readonly [string, string, string]>> = {
  [t.publish.inProgress]: ['now', '', ''],
  [t.publish.revalidated]: ['on', 'now', ''],
  [t.publish.notConfirmedRetrying]: ['on', 'on', 'now'],
  [t.publish.live]: ['go', 'go', 'go'],
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

/** The titles of the given entries from `api.entry_list`, read with the editor's own session (RLS). */
async function loadEntryTitles(ids: readonly string[]): Promise<Record<string, string | null>> {
  const { data, error } = await createBrowserEditorClient().from('entry_list').select('id, title').in('id', [...ids]);
  if (error) throw new Error(`entry_list: ${error.code}`);
  return Object.fromEntries(((data ?? []) as { id: string; title: string | null }[]).map((row) => [row.id, row.title]));
}

const requestNotice = (result: Exclude<PublishActionResult, { requestId: string }>['error']): string => {
  switch (result) {
    case 'version_conflict':
      return t.publish.superseded;
    case 'auth':
      return t.editor.signedOut;
    case 'tenant_inactive':
      return t.tenant.inactiveBody;
    case 'not_published':
      return t.publish.notPublished;
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
  publishedVersion: initialPublishedVersion = null,
  fieldLabels,
  publish = requestPublishAction,
  unpublish = requestUnpublishAction,
  loadStatus = loadPublicationStatus,
  loadTitles = loadEntryTitles,
  onArchivableChange,
  children,
}: Props) {
  const [row, setRow] = useState<PublicationStatusRow | null>(null);
  // False until the first status read answers: until then nothing is claimed (probe §14, 10).
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [published, setPublished] = useState(initiallyPublished);
  const [publishedVersion, setPublishedVersion] = useState<number | null>(initialPublishedVersion);
  // The draft version this panel's own publish request carried.
  const sentVersionRef = useRef<number | null>(null);
  const [titles, setTitles] = useState<Record<string, string | null>>({});
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
      if (next !== undefined) {
        setRow(next);
        setLoaded(true);
      }
      const waitingFor = awaitingRef.current;
      const settled =
        next === null
          ? waitingFor === null
          : next !== undefined && answers(next, waitingFor) && isFinal(displayState(next, { fieldLabels: labelsRef.current }));
      if (settled) {
        if (next && next.status === 'committed') {
          setPublished(next.action === 'publish');
          // The worker publishes exactly the version a request carried (§6.2), so this panel's own
          // committed publish makes that version the published one.
          if (next.action === 'unpublish') setPublishedVersion(null);
          else if (waitingFor !== null && next.request_id === waitingFor && sentVersionRef.current !== null) setPublishedVersion(sentVersionRef.current);
        }
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
    async (call: () => Promise<PublishActionResult>, sentVersion: number | null) => {
      setBusy(true);
      setNotice(null);
      try {
        const result = await call();
        if ('requestId' in result) {
          sentVersionRef.current = sentVersion;
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

  const answering = row && answers(row, awaiting) ? row : null;
  // A refused publish names its references by title (A10): read once per refused request.
  const refused = refusedEntryIds(answering);
  const refusedKey = answering && refused.length > 0 ? `${answering.request_id}:${refused.join(',')}` : null;
  useEffect(() => {
    if (refusedKey === null) return;
    let live = true;
    loadTitles(refusedKey.slice(refusedKey.indexOf(':') + 1).split(','))
      .then((found) => live && setTitles((known) => ({ ...known, ...found })))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [refusedKey, loadTitles]);

  const shown = answering ? displayState(answering, { fieldLabels, entryTitles: titles }) : null;
  const requestState = shown ?? (awaiting !== null ? IN_PROGRESS : null);
  const inFlight = busy || (requestState !== null && !isFinal(requestState));
  // Live, but the draft has saved changes since the published version (probe §14, 11).
  const state: DisplayState | null =
    requestState?.tone === 'ok' && publishedVersion !== null && version !== publishedVersion
      ? { label: t.publish.changed, tone: 'warning', detail: t.publish.changedDetail }
      : requestState;
  const archivable = loaded && !published && !inFlight;
  useEffect(() => {
    onArchivableChange?.(archivable);
  }, [archivable, onArchivableChange]);

  const track = state ? TRACKS[state.label] : undefined;
  const label = state?.label ?? (loaded ? t.publish.none : t.publish.loading);

  return (
    <section aria-labelledby="publish-heading" className="card pub">
      <h2 id="publish-heading">{t.publish.heading}</h2>
      {/* Not role="status": the form's save status is the page's one status region. */}
      <StatusBadge as="p" look="state" tone={state?.tone ?? 'neutral'} data-testid="publish-state" data-tone={state?.tone ?? 'none'} aria-live="polite">
        {label}
      </StatusBadge>
      {track ? (
        <div className="track" aria-hidden="true">
          {track.map((step, index) => (
            <i key={index} className={step} />
          ))}
        </div>
      ) : null}
      {state?.lines ? (
        <ul data-testid="publish-lines" className="text-sm">
          {state.lines.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      ) : null}
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
      <div className={published ? 'btns' : 'btns one'}>
        <Button variant="primary" disabled={disabled || inFlight} onClick={() => void send(() => publish(entryId, version), version)}>
          {t.publish.publish}
        </Button>
        {published ? (
          <Button variant="danger" disabled={inFlight} onClick={() => void send(() => unpublish(entryId), null)}>
            {t.publish.unpublish}
          </Button>
        ) : null}
      </div>
      {children}
    </section>
  );
}
