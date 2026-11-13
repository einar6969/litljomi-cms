'use client';

import { useEffect, useId, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { pickerFilesAction, registerAssetAction, type PickerFile } from '@/app/(editor)/t/[tenant]/asset-actions';
import { t } from '@/i18n/is';
import { createBrowserEditorClient } from '@/lib/supabase/browser';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { MAX_QUERY_LENGTH } from '../entry-list-filter';
import { useEditorTenant } from '../form/tenant-context';
import { prepareUpload, uploadWithProgress } from '../upload';
import { FileThumb } from './LibraryFiles';
import { MAX_LIBRARY_PAGE } from './library-filter';
import { fileMeta } from './library-format';
import { UploadQueueView } from './LibraryUpload';
import { confirmLabel, selectedLine, selectUploaded, toggleSelection, type PickedFile, type PickMode } from './picker-selection';
import { UploadQueue, type QueueSnapshot } from './upload-queue';

const ACCEPT = 'image/jpeg,image/png,image/webp';
const EMPTY: QueueSnapshot = { items: [], signedOut: false, dropped: 0, progress: { done: 0, total: 0 }, result: null };

type Props = {
  /** One file for an image field, several for a list of images. */
  mode: PickMode;
  /** The field the files are for, named under the dialog's title. */
  fieldLabel: string;
  /** The chosen files, in the order chosen. The dialog closes after. */
  onPick: (files: PickedFile[]) => void;
  /** Called when the dialog closes, whether or not anything was chosen. */
  onClose: () => void;
};

const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;

/**
 * The library in pick mode (docs/plans/media-library.md sections 6.3 and 6.4, slice L6): a native
 * modal `<dialog>`, rendered outside the form, titled for its mode and naming the field. It lists
 * the tenant's images, newest first, 60 at a time, with a search (`pickerFilesAction`). The files
 * are a listbox, one tab stop: the arrow keys, Home and End move, a click or Space selects (in
 * 'many' in the order chosen, which is the order the form receives them in), Enter confirms; the
 * count is announced politely. The dialog can upload too, through the library's queue: files that
 * arrive come selected, in the order they were chosen, and the list shows them first. Escape and
 * the close button close it; focus goes back to the control that opened it.
 */
export function LibraryPicker({ mode, fieldLabel, onPick, onClose }: Props) {
  const tenant = useEditorTenant();
  const uid = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [files, setFiles] = useState<PickerFile[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [failure, setFailure] = useState<'auth' | 'error' | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [current, setCurrent] = useState(0);
  const [snapshot, setSnapshot] = useState(EMPTY);
  /** Every file seen, for its default alt text once it has left the view (another search). */
  const known = useRef(new Map<string, PickedFile>());

  // Opened as a modal; on close, focus goes back to the control that opened it.
  useEffect(() => {
    const opener = document.activeElement;
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    search.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    let live = true;
    setFailure(null);
    pickerFilesAction(tenant.slug, query, page)
      .then((result) => {
        if (!live) return;
        if (!result.ok) {
          setFailure(result.code === 'auth' ? 'auth' : 'error');
          return;
        }
        for (const f of result.files) known.current.set(f.id, { id: f.id, defaultAlt: f.defaultAlt });
        setFiles(result.files);
        setHasMore(result.hasMore);
      })
      .catch(() => live && setFailure('error'));
    return () => {
      live = false;
    };
  }, [tenant.slug, query, page, reload]);

  // Uploads inside the dialog (plan section 6.2's queue). Each registered file is remembered by the
  // File it came from, so the batch's files can be selected in the order they were chosen.
  const queue = useRef<UploadQueue | null>(null);
  const chosen = useRef<File[]>([]);
  const fileOfPath = useRef(new Map<string, File>());
  const idOfFile = useRef(new Map<File, string>());
  const arrived = useRef(() => {});
  arrived.current = () => {
    const ids = chosen.current.flatMap((f) => (idOfFile.current.has(f) ? [idOfFile.current.get(f)!] : []));
    chosen.current = chosen.current.filter((f) => !idOfFile.current.has(f));
    idOfFile.current.clear();
    for (const id of ids) if (!known.current.has(id)) known.current.set(id, { id, defaultAlt: null });
    setSelected((s) => selectUploaded(s, ids, mode));
    // The new files are the newest: the first page without a search shows them.
    setDraft('');
    setQuery('');
    setPage(1);
    setCurrent(0);
    setReload((n) => n + 1);
  };
  const getQueue = (): UploadQueue => {
    if (queue.current === null) {
      const client = createBrowserEditorClient();
      queue.current = new UploadQueue({
        prepare: (file) => {
          const prepared = prepareUpload(file, tenant.id);
          if (prepared.ok) fileOfPath.current.set(prepared.path, file);
          return prepared;
        },
        upload: (path, file, onProgress) => uploadWithProgress(client, path, file, onProgress),
        register: async (prepared) => {
          const result = await registerAssetAction(tenant.slug, prepared.assetId, prepared.path, prepared.filename);
          const file = fileOfPath.current.get(prepared.path);
          if (result.ok && file) idOfFile.current.set(file, result.assetId);
          return result;
        },
        onChange: setSnapshot,
        onBatchEnd: (result) => {
          if (result.done > 0) arrived.current();
        },
      });
    }
    return queue.current;
  };
  const upload = (incoming: Iterable<File>) => {
    const all = [...incoming];
    const taken = mode === 'one' ? all.slice(0, 1) : all;
    if (taken.length === 0) return;
    chosen.current.push(...taken);
    getQueue().add(taken);
  };

  const pick = (ids: readonly string[]) => {
    if (ids.length === 0) return;
    onPick(ids.map((id) => known.current.get(id) ?? { id, defaultAlt: null }));
    onClose();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setQuery(draft.trim());
    setPage(1);
    setCurrent(0);
  };

  const clearSearch = () => {
    setDraft('');
    setQuery('');
    setPage(1);
    setCurrent(0);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const cards = [...(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    const from = cards.indexOf(event.target as HTMLElement);
    const id = files?.[from]?.id;
    if (from === -1 || id === undefined) return;
    if (event.key === ' ') {
      event.preventDefault();
      setSelected((s) => toggleSelection(s, id, mode));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      pick(mode === 'one' || selected.length === 0 ? [id] : selected);
      return;
    }
    // The cards in the first row share its top: that many make a row.
    const columns = Math.max(1, cards.filter((c) => c.offsetTop === cards[0]!.offsetTop).length);
    const to = { ArrowLeft: from - 1, ArrowRight: from + 1, ArrowUp: from - columns, ArrowDown: from + columns, Home: 0, End: cards.length - 1 }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    const target = to >= 0 && to < cards.length ? to : from;
    setCurrent(target);
    cards[target]?.focus();
  };

  const titleId = `${uid}-title`;
  const fieldId = `${uid}-field`;
  const many = mode === 'many';
  const showQueue = snapshot.items.length > 0 || snapshot.result !== null || snapshot.dropped > 0 || snapshot.signedOut;
  const focusable = files === null ? 0 : Math.min(current, Math.max(0, files.length - 1));

  let body;
  if (failure === 'auth') {
    body = (
      <Notice as="div" tone="error" role="alert">
        <strong>{t.editor.signedOut}</strong>
        <div className="note-acts">
          <a href="/login" target="_blank" rel="noreferrer">
            {t.editor.signIn}
          </a>
          <Button size="sm" onClick={() => setReload((n) => n + 1)}>
            {t.editor.retry}
          </Button>
        </div>
      </Notice>
    );
  } else if (failure === 'error') {
    body = (
      <Notice as="div" tone="error" role="alert">
        {t.picker.loadError}
        <div className="note-acts">
          <Button size="sm" onClick={() => setReload((n) => n + 1)}>
            {t.editor.retry}
          </Button>
        </div>
      </Notice>
    );
  } else if (files === null) {
    body = null;
  } else if (files.length === 0) {
    body = query ? (
      <div className="card empty">
        <p>{t.library.none}</p>
        <Button variant="quiet" onClick={clearSearch}>
          {t.entries.filter.clear}
        </Button>
      </div>
    ) : (
      <div className="card empty">
        <p>{t.picker.empty}</p>
      </div>
    );
  } else {
    body = (
      <>
        <ul ref={list} role="listbox" aria-labelledby={titleId} aria-multiselectable={many || undefined} className="lib-grid picker-grid" data-testid="picker-grid" onKeyDown={onKeyDown}>
          {files.map((f, i) => {
            const position = selected.indexOf(f.id);
            return (
              <li
                key={f.id}
                role="option"
                aria-selected={position !== -1}
                aria-label={f.defaultAlt?.trim() ? `${f.filename}, ${f.defaultAlt}` : f.filename}
                tabIndex={i === focusable ? 0 : -1}
                data-file-id={f.id}
                className="lib-card picker-card"
                onFocus={() => setCurrent(i)}
                onClick={() => setSelected((s) => toggleSelection(s, f.id, mode))}
                onDoubleClick={() => mode === 'one' && pick([f.id])}
              >
                <FileThumb file={{ id: f.id, kind: 'image', thumbUrl: f.thumbUrl }} />
                <span className="lib-name">{f.filename}</span>
                <span className="lib-meta mono">{fileMeta(f)}</span>
                {position !== -1 ? (
                  <span className="picker-mark" aria-hidden="true">
                    {many ? position + 1 : <Icon name="check" />}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
        {hasMore && page < MAX_LIBRARY_PAGE ? (
          <Button className="lib-more" onClick={() => setPage(page + 1)}>
            {t.library.more}
          </Button>
        ) : null}
      </>
    );
  }

  return createPortal(
    <dialog
      ref={dialog}
      className="picker"
      aria-labelledby={`${titleId} ${fieldId}`}
      data-testid="library-picker"
      onClose={onClose}
      onDragOver={(e) => {
        if (hasFiles(e)) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        upload(e.dataTransfer.files);
      }}
    >
      <div className="picker-head">
        <div className="lib-h">
          <h2 id={titleId}>{many ? t.picker.titleMany : t.picker.titleOne}</h2>
          <p id={fieldId} className="help">
            {fieldLabel}
          </p>
        </div>
        <button type="button" className="icbtn" aria-label={t.library.detail.close} onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div className="picker-tools">
        <form role="search" aria-label={t.entries.filter.label} className="search" onSubmit={submit}>
          <label htmlFor={`${uid}-search`} className="sr-only">
            {t.library.search}
          </label>
          <Icon name="search" />
          <input ref={search} id={`${uid}-search`} type="search" placeholder={t.library.search} maxLength={MAX_QUERY_LENGTH} value={draft} onChange={(e) => setDraft(e.target.value)} />
        </form>
        <input
          ref={uploadInput}
          type="file"
          accept={ACCEPT}
          multiple={many}
          hidden
          onChange={(e) => {
            upload(e.target.files ?? []);
            e.target.value = '';
          }}
        />
        <Button onClick={() => uploadInput.current?.click()}>
          <Icon name="upload" />
          {t.library.upload}
        </Button>
      </div>
      {showQueue ? (
        <div className="picker-queue">
          <UploadQueueView snapshot={snapshot} queue={getQueue} />
        </div>
      ) : null}
      <div className="picker-body">{body}</div>
      <div className="picker-foot">
        {/* Not role="status": the form's save status is the page's one status region. */}
        <p aria-live="polite" className="help" data-testid="picker-count">
          {many && selected.length > 0 ? selectedLine(selected.length) : ''}
        </p>
        <Button variant="ink" data-testid="picker-confirm" disabled={selected.length === 0} onClick={() => pick(selected)}>
          {confirmLabel(Math.max(1, selected.length), mode)}
        </Button>
      </div>
    </dialog>,
    document.body,
  );
}
