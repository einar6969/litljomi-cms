'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { registerAssetAction } from '@/app/(editor)/t/[tenant]/asset-actions';
import { t } from '@/i18n/is';
import { createBrowserEditorClient } from '@/lib/supabase/browser';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { prepareUpload, uploadWithProgress } from '../upload';
import { uploadResult } from './library-format';
import { MAX_BATCH, UploadQueue, type QueueSnapshot, type UploadItem } from './upload-queue';

/** The id of the file input, so the empty library's own button can open it (`UploadTrigger`). */
export const UPLOAD_INPUT_ID = 'library-upload';

const ACCEPT = 'image/jpeg,image/png,image/webp';

type Props = {
  tenantId: string;
  tenantSlug: string;
  /** The library's URL with the newest files first, loaded when a batch has brought files. */
  newestHref: string;
  /** False while the library is empty: its empty state carries the button instead. */
  showButton: boolean;
};

const EMPTY: QueueSnapshot = { items: [], signedOut: false, dropped: 0, progress: { done: 0, total: 0 }, result: null };

const REASONS = { type: t.editor.image.type, size: t.editor.image.size, error: t.upload.failed } as const;

function stateText(item: UploadItem): string {
  switch (item.state) {
    case 'waiting':
      return t.upload.waiting;
    case 'uploading':
      return t.upload.uploading.replace('{p}', String(item.progress));
    case 'processing':
      return t.upload.processing;
    case 'done':
      return t.upload.done;
    case 'failed':
      return REASONS[item.reason ?? 'error'];
  }
}

/**
 * The library's upload (docs/plans/media-library.md section 6.2, slice L5): "Hlaða upp" opens the
 * file chooser for several files, and files dropped anywhere on the page are taken the same way.
 * Each file is checked, uploaded straight to storage with the editor's session (three at a time,
 * with its percentage) and registered by the server, which makes its thumbnail (`UploadQueue`).
 * Each row shows its state, or its reason and "Reyna aftur". The progress is one polite live
 * region; a failure is an alert. When a batch has brought files, the library loads again, newest
 * first, and one sentence says how many arrived and how many failed.
 */
export function LibraryUpload({ tenantId, tenantSlug, newestHref, showButton }: Props) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [snapshot, setSnapshot] = useState(EMPTY);
  const [dragging, setDragging] = useState(false);
  const queue = useRef<UploadQueue | null>(null);
  const reload = useRef(() => {});
  reload.current = () => {
    if (`${location.pathname}${location.search}` === newestHref) router.refresh();
    else router.push(newestHref);
  };

  /** The queue, made on first use: only in the browser, which its client needs. */
  const getQueue = (): UploadQueue => {
    if (queue.current === null) {
      const client = createBrowserEditorClient();
      queue.current = new UploadQueue({
        prepare: (file) => prepareUpload(file, tenantId),
        upload: (path, file, onProgress) => uploadWithProgress(client, path, file, onProgress),
        register: (prepared) => registerAssetAction(tenantSlug, prepared.assetId, prepared.path, prepared.filename),
        onChange: setSnapshot,
        onBatchEnd: (result) => {
          if (result.done > 0) reload.current();
        },
      });
    }
    return queue.current;
  };

  // Files dragged over the page: the whole page takes them.
  useEffect(() => {
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
    const over = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragging(true);
    };
    const leave = (event: DragEvent) => {
      if (event.relatedTarget === null) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragging(false);
      getQueue().add(event.dataTransfer?.files ?? []);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  const { items, signedOut, dropped, progress, result } = snapshot;
  const running = progress.total > 0 && result === null;
  const shown = items.length > 0 || result !== null || dropped > 0 || signedOut;

  return (
    <>
      <input
        ref={input}
        id={UPLOAD_INPUT_ID}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          getQueue().add(e.target.files ?? []);
          e.target.value = '';
        }}
      />
      {showButton ? (
        <div className="lib-up">
          <span className="help lib-drop-hint">{t.upload.drop}</span>
          <Button variant="ink" onClick={() => input.current?.click()}>
            <Icon name="upload" />
            {t.library.upload}
          </Button>
        </div>
      ) : null}
      {dragging ? (
        <div className="lib-dropping" aria-hidden="true">
          <Icon name="upload" size={20} />
          {t.upload.title}
        </div>
      ) : null}
      {shown ? (
        <section className="card sub lib-queue" aria-labelledby="upload-title" data-testid="upload-queue">
          <h2 id="upload-title">{t.upload.title}</h2>
          <p aria-live="polite" data-testid="upload-summary">
            {running
              ? t.upload.progress.replace('{done}', String(progress.done)).replace('{total}', String(progress.total))
              : result
                ? uploadResult(result.done, result.failed)
                : ''}
          </p>
          {dropped > 0 ? <Notice tone="warning">{t.upload.tooMany.replace('{max}', String(MAX_BATCH))}</Notice> : null}
          {signedOut ? (
            <Notice as="div" tone="error" role="alert">
              <strong>{t.editor.signedOut}</strong>
              <div className="note-acts">
                <a href="/login" target="_blank" rel="noreferrer">
                  {t.editor.signIn}
                </a>
                <Button size="sm" onClick={() => getQueue().resume()}>
                  {t.editor.retry}
                </Button>
              </div>
            </Notice>
          ) : null}
          {items.length > 0 ? (
            <ul className="lib-up-list">
              {items.map((item) => (
                <li key={item.key} data-state={item.state}>
                  <Icon name="image" />
                  <span className="lib-up-name">{item.name}</span>
                  {item.state === 'failed' ? (
                    <span role="alert" className="err">
                      {stateText(item)}
                    </span>
                  ) : (
                    <span className="help">{stateText(item)}</span>
                  )}
                  {item.state === 'uploading' ? <progress max={100} value={item.progress} aria-hidden="true" /> : null}
                  {item.state === 'failed' || item.state === 'waiting' ? (
                    <span className="acts">
                      {item.state === 'failed' && item.reason === 'error' ? (
                        <Button size="sm" onClick={() => getQueue().retry(item.key)}>
                          {t.editor.retry}
                        </Button>
                      ) : null}
                      <Button size="sm" variant="quiet" onClick={() => getQueue().remove(item.key)} aria-label={`${t.upload.remove}: ${item.name}`}>
                        {t.upload.remove}
                      </Button>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

/** The empty library's "Hlaða upp": opens the same file chooser as the head's. */
export function UploadTrigger() {
  return (
    <Button variant="ink" onClick={() => document.getElementById(UPLOAD_INPUT_ID)?.click()}>
      <Icon name="upload" />
      {t.library.upload}
    </Button>
  );
}
