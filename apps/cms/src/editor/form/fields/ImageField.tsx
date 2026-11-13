'use client';

import { useEffect, useRef, useState, type DragEvent } from 'react';
import { assetPreviewAction, registerAssetAction, updateAssetAction } from '@/app/(editor)/t/[tenant]/asset-actions';
import { MAX_ALT_LENGTH, type AssetChange } from '@/editor/media/asset-metadata';
import { FocalPointPicker } from '@/editor/media/FocalPointPicker';
import { LibraryPicker } from '@/editor/media/LibraryPicker';
import { imageValueOf, type ImageValue } from '@/editor/media/picker-selection';
import { t } from '@/i18n/is';
import { createBrowserEditorClient } from '@/lib/supabase/browser';
import { prepareUpload, uploadOriginal } from '../../upload';
import type { FieldProps } from '../field-registry';
import { useEditorTenant } from '../tenant-context';
import { Button, buttonClasses } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Field } from '@/ui/Field';
import { Notice as NoticeBox, type NoticeTone } from '@/ui/Notice';

type Preview = { url: string; defaultAlt: string | null; focalX: number | null; focalY: number | null };

type Notice = 'uploading' | 'type' | 'size' | 'uploadError' | 'previewError' | 'auth' | 'defaultAltSaved' | 'focalSaved' | 'updateError';

const messages: Record<Notice, string> = {
  uploading: t.editor.image.uploading,
  type: t.editor.image.type,
  size: t.editor.image.size,
  uploadError: t.editor.image.uploadError,
  previewError: t.editor.image.previewError,
  auth: t.editor.signedOut,
  defaultAltSaved: t.editor.image.defaultAltSaved,
  focalSaved: t.editor.image.focalSaved,
  updateError: t.editor.image.updateError,
};

/** Progress and success are announced politely; everything else is a failure, announced as an alert. */
const isLive = (notice: Notice): boolean => notice === 'uploading' || notice.endsWith('Saved');
const toneOf = (notice: Notice): NoticeTone => (notice === 'uploading' ? 'info' : isLive(notice) ? 'success' : 'error');

/**
 * The notice for an action's refusal: the codes this field has its own text for keep it (`auth`
 * is "signed out"), every other code is the given fallback.
 */
const noticeFor = <C extends string>(code: C, fallback: Notice, own: readonly (C & Notice)[] = []): Notice =>
  code === 'auth' || (own as readonly string[]).includes(code) ? (code as C & Notice) : fallback;

/** A preview that fails to load (an expired signed URL) is signed again at most this many times. */
const MAX_PREVIEW_RESIGNS = 3;

const ACCEPT = 'image/jpeg,image/png,image/webp';

const imageOf = (value: unknown): ImageValue | null => {
  if (typeof value !== 'object' || value === null) return null;
  const { _ref, _kind, alt } = value as Partial<ImageValue>;
  return typeof _ref === 'string' && _kind === 'asset' ? { _ref, _kind, alt: typeof alt === 'string' ? alt : '' } : null;
};

/**
 * An image field (§5.2, §5.6). A chosen file is checked before upload (`prepareUpload`), uploaded
 * from the browser to `media-private` with the editor's session, then registered by the server,
 * which reads the object back and makes its thumbnail. The preview is the thumbnail, never the
 * original unless the file cannot have one (`assetPreviewAction`), through a signed URL valid for
 * 600 seconds, signed again if it fails to load (expired), at most `MAX_PREVIEW_RESIGNS` times,
 * then a notice. The alt text
 * belongs to this use; the asset's own default alt text and focal point are edited here too
 * (`update_asset`), and on the asset's detail page, linked from here.
 *
 * "Velja úr safni" opens the library in pick mode (docs/plans/media-library.md section 6.3): a
 * chosen file arrives with its default alt text. A file dropped on the empty field's dashed box is
 * uploaded as a chosen one is. Replacing an image, by upload or from the library, keeps the alt
 * text this use already has.
 */
export function ImageField({ id, label, required, value, onChange }: FieldProps) {
  const tenant = useEditorTenant();
  const image = imageOf(value);
  const ref = image?._ref ?? null;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [resigns, setResigns] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [over, setOver] = useState(false);
  // This use's alt text as it is now, for an upload that finishes after the editor typed more.
  const alt = useRef(image?.alt ?? '');
  alt.current = image?.alt ?? '';
  const libraryButton = useRef<HTMLButtonElement>(null);

  // The picker gives focus back to the button that opened it; when choosing swapped the empty box
  // for the image, that button is a new one, and takes it instead. Only once a picker has closed.
  const pickerClosed = useRef(false);
  useEffect(() => {
    if (picking) {
      pickerClosed.current = true;
      return;
    }
    if (!pickerClosed.current) return;
    pickerClosed.current = false;
    if (document.activeElement === null || document.activeElement === document.body) libraryButton.current?.focus();
  }, [picking]);

  useEffect(() => {
    setPreview(null);
    if (ref === null) return;
    let live = true;
    assetPreviewAction(ref)
      .then((result) => {
        if (!live) return;
        if (result.ok) {
          setPreview({ url: result.url, defaultAlt: result.defaultAlt, focalX: result.focalX, focalY: result.focalY });
          setNotice((n) => (n === 'previewError' ? null : n));
        } else setNotice(noticeFor(result.code, 'previewError'));
      })
      .catch(() => live && setNotice('previewError'));
    return () => {
      live = false;
    };
  }, [ref, resigns]);

  const previewFailed = () => {
    if (resigns < MAX_PREVIEW_RESIGNS) setResigns(resigns + 1);
    else setNotice('previewError');
  };

  const upload = async (file: File) => {
    const prepared = prepareUpload(file, tenant.id);
    if (!prepared.ok) {
      setNotice(prepared.reason);
      return;
    }
    setBusy(true);
    setNotice('uploading');
    try {
      if (!(await uploadOriginal(createBrowserEditorClient(), prepared.path, file))) {
        setNotice('uploadError');
        return;
      }
      const result = await registerAssetAction(tenant.slug, prepared.assetId, prepared.path, prepared.filename);
      if (!result.ok) {
        setNotice(noticeFor(result.code, 'uploadError', ['type', 'size']));
        return;
      }
      setNotice(null);
      onChange({ _ref: result.assetId, _kind: 'asset', alt: alt.current } satisfies ImageValue);
    } catch {
      setNotice('uploadError');
    } finally {
      setBusy(false);
    }
  };

  /** Saves a change to the asset's focal point or default alt text (`update_asset`); the rest is kept as stored. */
  const updateAsset = async (change: AssetChange, saved: Notice) => {
    if (!image || !preview) return;
    try {
      const result = await updateAssetAction(image._ref, change);
      if (result.ok) {
        setPreview((p) =>
          p === null
            ? p
            : {
                ...p,
                ...(change.focal !== undefined ? { focalX: change.focal?.x ?? null, focalY: change.focal?.y ?? null } : {}),
                ...(change.defaultAlt !== undefined ? { defaultAlt: change.defaultAlt } : {}),
              },
        );
        setNotice(saved);
      } else {
        setNotice(noticeFor(result.code, 'updateError'));
      }
    } catch {
      setNotice('updateError');
    }
  };

  const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
  const drop = {
    onDragOver: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
      setOver(true);
    },
    onDragLeave: (event: DragEvent) => {
      if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setOver(false);
    },
    onDrop: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setOver(false);
      const file = event.dataTransfer.files[0];
      if (file && !busy) void upload(file);
    },
  };

  // A plain button, for the ref that focus comes back to.
  const fromLibrary = (
    <button ref={libraryButton} type="button" className={buttonClasses('secondary', 'sm')} disabled={busy} onClick={() => setPicking(true)}>
      {t.editor.image.fromLibrary}
    </button>
  );

  // The picker is a <label>, which has no disabled state: while busy it says so with aria-disabled.
  // The native input is visually hidden but still the label's control: focusable, named, and what a
  // test or a screen reader reaches.
  const picker = (
    <label
      htmlFor={id}
      aria-disabled={busy || undefined}
      className={`${buttonClasses('secondary', 'sm')} relative has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent-text`}
    >
      {image ? t.editor.image.replace : t.editor.image.choose}
      <input
        id={id}
        name={id}
        type="file"
        accept={ACCEPT}
        required={required && !image}
        disabled={busy}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void upload(file);
        }}
      />
    </label>
  );
  return (
    <fieldset className="fld">
      <legend className="lab mb-1.5">{label}</legend>
      {image ? (
        <div className="imgf">
          {preview ? (
            <FocalPointPicker
              id={id}
              url={preview.url}
              alt={image.alt}
              focal={preview.focalX !== null && preview.focalY !== null ? { x: preview.focalX, y: preview.focalY } : null}
              onSave={(focal) => void updateAsset({ focal }, 'focalSaved')}
              onImageError={previewFailed}
            />
          ) : (
            <div className="thumb" />
          )}
          <div className="fld gap-2.5">
            <Field label={t.editor.image.alt} htmlFor={`${id}-alt`}>
              <input id={`${id}-alt`} name={`${id}-alt`} type="text" maxLength={MAX_ALT_LENGTH} value={image.alt} onChange={(e) => onChange({ ...image, alt: e.target.value })} />
            </Field>
            <div className="acts">
              {picker}
              {fromLibrary}
              <Button variant="danger" size="sm" onClick={() => onChange(undefined)}>
                {t.editor.image.remove}
              </Button>
            </div>
            <div className="acts">
              <Button
                variant="quiet"
                size="sm"
                className="whitespace-normal"
                disabled={!preview || image.alt === (preview.defaultAlt ?? '')}
                onClick={() => void updateAsset({ defaultAlt: image.alt === '' ? null : image.alt }, 'defaultAltSaved')}
              >
                {t.editor.image.saveDefaultAlt}
              </Button>
            </div>
            {/* A new tab (a plain link, no client navigation), so the form and anything not yet autosaved stay where they are. */}
            <a href={`/t/${encodeURIComponent(tenant.slug)}/assets/${image._ref}`} target="_blank" rel="noopener" className="text-sm">
              {t.editor.image.details}
            </a>
          </div>
        </div>
      ) : (
        <div className="drop" data-over={over || undefined} {...drop}>
          <Icon name="image" size={20} />
          <div className="acts justify-center">
            {picker}
            {fromLibrary}
          </div>
        </div>
      )}
      {notice ? (
        // Progress and success are announced politely, failures as alerts. Not role="status": the
        // form's save status is the page's one status element.
        <NoticeBox
          data-testid={`${id}-notice`}
          tone={toneOf(notice)}
          {...(isLive(notice) ? { 'aria-live': 'polite' as const } : { role: 'alert' })}
        >
          {messages[notice]}
        </NoticeBox>
      ) : null}
      {picking ? (
        <LibraryPicker
          mode="one"
          fieldLabel={label}
          onPick={([file]) => {
            if (!file) return;
            setNotice(null);
            onChange(imageValueOf(file, alt.current));
          }}
          onClose={() => setPicking(false)}
        />
      ) : null}
    </fieldset>
  );
}
