'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ensureThumbnailAction } from '@/app/(editor)/t/[tenant]/asset-actions';
import { t } from '@/i18n/is';
import { Icon } from '@/ui/Icon';
import { fileMeta, formatBytes, kindLabel } from './library-format';
import type { LibraryView } from './library-filter';

/** One file as the library lists it: read from `api.asset_list`, its thumbnail signed by the page. */
export type LibraryFile = {
  id: string;
  /** The library's URL with this file's details open. */
  href: string;
  filename: string;
  mime: string;
  kind: 'image' | 'document';
  /** The file's default alt text, or null. */
  alt: string | null;
  width: number | null;
  height: number | null;
  bytes: number;
  createdAt: string;
  /**
   * The upload date in Icelandic ("4. okt. 2026"), formatted on the server: a browser without
   * Icelandic locale data would write it in another language.
   */
  uploaded: string;
  /** A signed URL of the thumbnail, valid 600 seconds, or null when the file has none yet. */
  thumbUrl: string | null;
  /** How many entries use it; null where the view does not show it. */
  usage: number | null;
};

type Props = { view: LibraryView; files: LibraryFile[]; activeId: string | null };

/**
 * The library's files (docs/plans/media-library.md section 6.1, 6.4): a grid of cards or a table,
 * from the same rows. The grid is one tab stop: the arrow keys, Home and End move between the
 * cards, Enter opens a file's details. Each card is a link named by the file's name and alt text,
 * its thumbnail decorative. When a file's details close, focus goes back to its card.
 */
export function LibraryFiles({ view, files, activeId }: Props) {
  const list = useRef<HTMLElement>(null);
  const opened = useRef(activeId);
  const activeIndex = Math.max(0, files.findIndex((f) => f.id === activeId));
  const [current, setCurrent] = useState(activeIndex);

  useEffect(() => setCurrent(activeIndex), [activeId]);

  useEffect(() => {
    const closed = opened.current;
    opened.current = activeId;
    if (closed === null || activeId !== null) return;
    list.current?.querySelector<HTMLAnchorElement>(`a[data-file-id="${closed}"]`)?.focus();
  }, [activeId]);

  const move = (event: KeyboardEvent<HTMLElement>) => {
    const cards = [...(list.current?.querySelectorAll<HTMLAnchorElement>('a[data-file-id]') ?? [])];
    const from = cards.indexOf(event.target as HTMLAnchorElement);
    if (from === -1) return;
    // The cards in the first row share its top: that many make a row.
    const columns = Math.max(1, cards.filter((c) => c.offsetTop === cards[0]!.offsetTop).length);
    const to = { ArrowLeft: from - 1, ArrowRight: from + 1, ArrowUp: from - columns, ArrowDown: from + columns, Home: 0, End: cards.length - 1 }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    const target = Math.min(cards.length - 1, Math.max(0, to)) === to ? to : from;
    setCurrent(target);
    cards[target]?.focus();
  };

  if (view === 'list') {
    return (
      <div className="card tbl-w">
        {/* Below 768 px the table is restyled as stacked rows (globals.css), as the entry list is. */}
        <table role="table" className="tbl lib-table" ref={(el) => void (list.current = el)}>
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader">{t.library.col.file}</th>
              <th role="columnheader">{t.library.col.type}</th>
              <th role="columnheader">{t.library.col.size}</th>
              <th role="columnheader">{t.library.col.dimensions}</th>
              <th role="columnheader">{t.library.col.uploaded}</th>
              <th role="columnheader">{t.library.col.usage}</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {files.map((file) => (
              <tr key={file.id} role="row" aria-current={file.id === activeId ? 'true' : undefined}>
                <td role="cell">
                  <span className="lib-row">
                    <FileThumb file={file} />
                    <Link href={file.href} scroll={false} className="t" data-file-id={file.id}>
                      {file.filename}
                    </Link>
                  </span>
                </td>
                <td role="cell">{kindLabel(file.mime)}</td>
                <td role="cell" className="mono">
                  {formatBytes(file.bytes)}
                </td>
                <td role="cell" className="mono">
                  {file.width !== null && file.height !== null ? `${file.width}×${file.height}` : ''}
                </td>
                <td role="cell">
                  <time dateTime={file.createdAt}>{file.uploaded}</time>
                </td>
                <td role="cell" className="mono">
                  {file.usage ?? ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <ul className="lib-grid" data-testid="library-grid" ref={(el) => void (list.current = el)} onKeyDown={move}>
      {files.map((file, i) => (
        <li key={file.id}>
          <Link
            href={file.href}
            scroll={false}
            className="lib-card"
            data-file-id={file.id}
            tabIndex={i === current ? 0 : -1}
            aria-current={file.id === activeId ? 'true' : undefined}
            aria-label={file.alt ? `${file.filename}, ${file.alt}` : file.filename}
            aria-describedby={`file-${file.id}-meta`}
            onFocus={() => setCurrent(i)}
          >
            <FileThumb file={file} />
            <span className="lib-name">{file.filename}</span>
            <span className="lib-meta mono" id={`file-${file.id}-meta`}>
              {fileMeta(file)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The thumbnails a page asks to be made run one after another (plan section 5): each request has
 * the server decode one original, and a page of older files must not make sixty at once.
 */
let thumbnails: Promise<unknown> = Promise.resolve();
const oneAtATime = <T,>(task: () => Promise<T>): Promise<T> => {
  const run = thumbnails.then(task, task);
  thumbnails = run.catch(() => undefined);
  return run;
};

/**
 * A file's thumbnail, or its type's icon. A file without one asks for it (`ensureThumbnailAction`,
 * which makes, stores and signs it), once; a thumbnail that fails to load (an expired signature) is
 * signed once more. After that, the icon stays.
 */
function FileThumb({ file }: { file: LibraryFile }) {
  const [src, setSrc] = useState(file.thumbUrl);
  const asked = useRef(false);
  const mounted = useRef(false);

  const ask = () => {
    asked.current = true;
    void oneAtATime(() => ensureThumbnailAction(file.id))
      .then((result) => mounted.current && setSrc(result.ok ? result.url : null))
      .catch(() => mounted.current && setSrc(null));
  };

  useEffect(() => {
    mounted.current = true;
    if (file.thumbUrl === null && file.kind === 'image' && !asked.current) ask();
    return () => {
      mounted.current = false;
    };
  }, []);

  return (
    <span className="lib-thumb">
      {src !== null ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => {
            setSrc(null);
            if (!asked.current) ask();
          }}
        />
      ) : (
        <Icon name="image" size={20} />
      )}
    </span>
  );
}
