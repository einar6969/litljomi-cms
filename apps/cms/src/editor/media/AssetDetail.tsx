'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { assetPreviewAction, updateAssetAction, updateAssetTextAction } from '@/app/(editor)/t/[tenant]/asset-actions';
import { t } from '@/i18n/is';
import { Button } from '@/ui/Button';
import { Field, fieldHelpId } from '@/ui/Field';
import { Icon } from '@/ui/Icon';
import { Notice as NoticeBox } from '@/ui/Notice';
import { StatusBadge, type BadgeTone } from '@/ui/StatusBadge';
import { MAX_ALT_LENGTH, MAX_CAPTION_LENGTH, MAX_CREDIT_LENGTH, type AssetChange } from './asset-metadata';
import type { FocalPoint } from './focal-point';
import { FocalPointPicker } from './FocalPointPicker';
import { formatBytes, kindLabel } from './library-format';

/** The file as the panel shows it, read from `api.asset_list` under the editor's session. */
export type AssetFile = {
  id: string;
  filename: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  createdAt: string;
  /** The upload date in Icelandic, formatted on the server (a browser may lack Icelandic locale data). */
  uploaded: string;
  focal: FocalPoint | null;
  defaultAlt: string | null;
  caption: string | null;
  credit: string | null;
};

/**
 * One entry that uses the file (`api.asset_usage`): `live` when its published revision does (the
 * publish note), `state` the pill, which says "Á vefnum" only for a publish proven live (§7.4).
 */
export type AssetUse = { entryId: string; href: string; title: string | null; typeLabel: string; live: boolean; state: { label: string; tone: BadgeTone } };

type Props = {
  file: AssetFile;
  /**
   * A signed URL of the file's thumbnail in `media-private` (§5.6), valid for 600 seconds, or null
   * when the file has none yet: the preview is then asked for (`assetPreviewAction`), which makes it.
   */
  url: string | null;
  usage: AssetUse[];
  /** The route that signs the original and sends the browser to it (assets/[assetId]/original). */
  originalHref: string;
  /** In the library: the library's URL without this file. The panel then takes focus and can be closed. */
  closeHref?: string;
};

type Notice = 'focalSaved' | 'saved' | 'updateError' | 'previewError' | 'auth';

const messages: Record<Exclude<Notice, 'auth'>, string> = {
  focalSaved: t.editor.image.focalSaved,
  saved: t.library.detail.saved,
  updateError: t.editor.image.updateError,
  previewError: t.editor.image.previewError,
};

/** A preview that fails to load (an expired signed URL) is signed again at most this many times. */
const MAX_PREVIEW_RESIGNS = 3;

const ID = 'asset';

type Texts = { alt: string; caption: string; credit: string };
const textsOf = (file: AssetFile): Texts => ({ alt: file.defaultAlt ?? '', caption: file.caption ?? '', credit: file.credit ?? '' });
const trimmed = (texts: Texts): Texts => ({ alt: texts.alt.trim(), caption: texts.caption.trim(), credit: texts.credit.trim() });
const same = (a: Texts, b: Texts) => a.alt === b.alt && a.caption === b.caption && a.credit === b.credit;
const orNull = (s: string) => (s === '' ? null : s);

/** Whether a key press belongs to a text the editor is typing in, where Escape must not close the panel. */
const inTextField = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * One file's details (docs/plans/media-library.md section 6.1; spec §5.6): its thumbnail with the
 * focal point picker, its type, size, dimensions and upload date, a link to its original, its
 * default alt text, caption and credit saved together with one button (`updateAssetTextAction`),
 * and the entries that use it. The focal point is saved on its own (`updateAssetAction`). Alt text
 * per use is edited in each entry's image field and is what the site receives. A file the site
 * shows says that a changed caption, credit or focal point reaches the site at the next publish.
 *
 * In the library (`closeHref`) it is the panel beside the files: it takes focus on its heading when
 * it opens, and its close link, or Escape outside a text field, goes back to the files. On the
 * file's own page it is the page's content.
 */
export function AssetDetail({ file, url: initialUrl, usage, originalHref, closeHref }: Props) {
  const [url, setUrl] = useState(initialUrl);
  const [resigns, setResigns] = useState(0);
  const [focal, setFocal] = useState(file.focal);
  const [saved, setSaved] = useState(() => textsOf(file));
  const [texts, setTexts] = useState(() => textsOf(file));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const close = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (closeHref) heading.current?.focus();
  }, [file.id]);

  useEffect(() => {
    if (!closeHref) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || inTextField(event.target)) return;
      close.current?.click();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [closeHref]);

  const saveFocal = async (next: FocalPoint | null) => {
    try {
      const result = await updateAssetAction(file.id, { focal: next } satisfies AssetChange);
      if (result.ok) {
        setFocal(next);
        setNotice('focalSaved');
      } else setNotice(result.code === 'auth' ? 'auth' : 'updateError');
    } catch {
      setNotice('updateError');
    }
  };

  const next = trimmed(texts);
  const saveTexts = async () => {
    setSaving(true);
    try {
      const result = await updateAssetTextAction(file.id, { defaultAlt: orNull(next.alt), caption: orNull(next.caption), credit: orNull(next.credit) });
      if (result.ok) {
        setSaved(next);
        setTexts(next);
        setNotice('saved');
      } else setNotice(result.code === 'auth' ? 'auth' : 'updateError');
    } catch {
      setNotice('updateError');
    } finally {
      setSaving(false);
    }
  };

  const loadPreview = async () => {
    const result = await assetPreviewAction(file.id).catch(() => null);
    if (result?.ok) setUrl(result.url);
    else setNotice(result?.ok === false && result.code === 'auth' ? 'auth' : 'previewError');
  };

  // A file the page found no thumbnail for: the preview action makes one (or signs the original
  // of a file that cannot have one). Once, on the first render.
  useEffect(() => {
    if (initialUrl === null) void loadPreview();
  }, []);

  const previewFailed = async () => {
    if (resigns >= MAX_PREVIEW_RESIGNS) return setNotice('previewError');
    setResigns(resigns + 1);
    await loadPreview();
  };

  const live = usage.some((u) => u.live);
  const field = (name: keyof Texts) => ({
    id: `${ID}-${name}`,
    name,
    value: texts[name],
    'aria-describedby': fieldHelpId(`${ID}-${name}`),
    onChange: (e: { target: { value: string } }) => setTexts((s) => ({ ...s, [name]: e.target.value })),
  });

  return (
    <section className="card lib-panel" aria-labelledby={`${ID}-panel-title`} data-testid="asset-panel">
      {closeHref ? (
        <Link href={closeHref} className="back">
          <Icon name="chevronLeft" />
          {t.library.detail.back}
        </Link>
      ) : null}
      <div className="lib-panel-h">
        <h2 id={`${ID}-panel-title`} ref={heading} tabIndex={-1}>
          {t.library.detail.title}
        </h2>
        {closeHref ? (
          <Link ref={close} href={closeHref} scroll={false} className="icbtn lib-close" aria-label={t.library.detail.close}>
            <Icon name="close" size={20} />
          </Link>
        ) : null}
      </div>
      {url !== null ? (
        <FocalPointPicker id={ID} url={url} alt={saved.alt} focal={focal} onSave={(point) => void saveFocal(point)} onImageError={() => void previewFailed()} />
      ) : (
        <div className="thumb" />
      )}
      <dl className="meta">
        <dt>{t.asset.filename}</dt>
        <dd className="mono min-w-0 break-words" data-testid="asset-filename">
          {file.filename}
        </dd>
        <dt>{t.library.col.type}</dt>
        <dd data-testid="asset-type">{kindLabel(file.mime)}</dd>
        <dt>{t.library.col.size}</dt>
        <dd data-testid="asset-size">{formatBytes(file.bytes)}</dd>
        <dt>{t.library.col.dimensions}</dt>
        <dd data-testid="asset-dimensions">{t.asset.dimensions.replace('{width}', String(file.width)).replace('{height}', String(file.height))}</dd>
        <dt>{t.library.col.uploaded}</dt>
        <dd data-testid="asset-uploaded">
          <time dateTime={file.createdAt}>{file.uploaded}</time>
        </dd>
      </dl>
      <a href={originalHref} target="_blank" rel="noreferrer" className="lib-original">
        {t.library.detail.original}
        <Icon name="arrowUpRight" />
      </a>
      <form
        className="lib-texts"
        onSubmit={(e) => {
          e.preventDefault();
          void saveTexts();
        }}
      >
        <Field label={t.library.detail.alt} htmlFor={`${ID}-alt`} help={t.library.detail.altHelp}>
          <input type="text" maxLength={MAX_ALT_LENGTH} {...field('alt')} />
        </Field>
        <Field label={t.library.detail.caption} htmlFor={`${ID}-caption`} help={t.library.detail.captionHelp}>
          <textarea rows={3} maxLength={MAX_CAPTION_LENGTH} {...field('caption')} />
        </Field>
        <Field label={t.library.detail.credit} htmlFor={`${ID}-credit`} help={t.library.detail.creditHelp}>
          <input type="text" maxLength={MAX_CREDIT_LENGTH} {...field('credit')} />
        </Field>
        <Button type="submit" variant="ink" disabled={saving || same(next, saved)}>
          {t.library.detail.save}
        </Button>
      </form>
      {live ? <NoticeBox tone="info">{t.library.detail.nextPublish}</NoticeBox> : null}
      {notice === 'auth' ? (
        <NoticeBox as="div" tone="error" role="alert" data-testid={`${ID}-notice`}>
          <strong>{t.editor.signedOut}</strong>{' '}
          <a href="/login" target="_blank" rel="noreferrer">
            {t.editor.signIn}
          </a>
        </NoticeBox>
      ) : notice ? (
        <NoticeBox
          data-testid={`${ID}-notice`}
          tone={notice === 'saved' || notice === 'focalSaved' ? 'success' : 'error'}
          {...(notice === 'saved' || notice === 'focalSaved' ? { 'aria-live': 'polite' as const } : { role: 'alert' })}
        >
          {messages[notice]}
        </NoticeBox>
      ) : null}
      <section className="lib-usage" aria-labelledby={`${ID}-usage-title`} data-testid="asset-usage">
        <h3 id={`${ID}-usage-title`}>{usage.length > 0 ? `${t.library.usage.title} ${usage.length}` : t.library.usage.title}</h3>
        {usage.length === 0 ? (
          <p className="help">{t.library.usage.none}</p>
        ) : (
          <ul>
            {usage.map((use) => {
              const pill = use.state;
              return (
                <li key={use.entryId}>
                  <span className="min-w-0">
                    <Link href={use.href} className={use.title ? 't' : 't text-muted'}>
                      {use.title ?? t.entries.untitled}
                    </Link>
                    <span className="help">{use.typeLabel}</span>
                  </span>
                  <StatusBadge tone={pill.tone}>{pill.label}</StatusBadge>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </section>
  );
}
