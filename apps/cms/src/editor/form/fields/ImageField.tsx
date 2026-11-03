'use client';

import { useEffect, useState } from 'react';
import { assetPreviewAction, registerAssetAction, updateAssetAction } from '@/app/(editor)/t/[tenant]/asset-actions';
import { MAX_ALT_LENGTH, type AssetChange } from '@/editor/media/asset-metadata';
import { FocalPointPicker } from '@/editor/media/FocalPointPicker';
import { t } from '@/i18n/is';
import { createBrowserEditorClient } from '@/lib/supabase/browser';
import { prepareUpload, uploadOriginal } from '../../upload';
import type { FieldProps } from '../field-registry';
import { useEditorTenant } from '../tenant-context';
import { Button, buttonClasses } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Notice as NoticeBox, type NoticeTone } from '@/ui/Notice';

/** The stored value of an image field: an asset reference with this use's alt text (§5.2). */
type ImageValue = { _ref: string; _kind: 'asset'; alt: string };

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
 * which reads the object back. The preview is a signed URL valid for 600 seconds, signed again if
 * it fails to load (expired), at most `MAX_PREVIEW_RESIGNS` times, then a notice. The alt text
 * belongs to this use; the asset's own default alt text and focal point are edited here too
 * (`update_asset`), and on the asset's detail page, linked from here.
 */
export function ImageField({ id, label, required, value, onChange }: FieldProps) {
  const tenant = useEditorTenant();
  const image = imageOf(value);
  const ref = image?._ref ?? null;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [resigns, setResigns] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);

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
      onChange({ _ref: result.assetId, _kind: 'asset', alt: '' } satisfies ImageValue);
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

  // The picker is a <label>, which has no disabled state: while busy it mirrors the `disabled:`
  // look of the secondary Button (ui/Button.tsx); keep the two in step.
  const busyPicker = busy ? 'cursor-not-allowed border-hairline bg-recessed text-muted' : 'cursor-pointer';
  return (
    <fieldset className="flex min-w-0 flex-col gap-3 rounded-lg border border-hairline p-4">
      <legend className="px-1 text-[15px] font-medium">{label}</legend>
      {image ? (
        <div className="flex flex-col items-start gap-3">
          {preview ? (
            <FocalPointPicker
              id={id}
              url={preview.url}
              alt={image.alt}
              focal={preview.focalX !== null && preview.focalY !== null ? { x: preview.focalX, y: preview.focalY } : null}
              onSave={(focal) => void updateAsset({ focal }, 'focalSaved')}
              onImageError={previewFailed}
            />
          ) : null}
          <div className="w-full">
            <Field label={t.editor.image.alt} htmlFor={`${id}-alt`}>
              <input id={`${id}-alt`} name={`${id}-alt`} type="text" maxLength={MAX_ALT_LENGTH} value={image.alt} onChange={(e) => onChange({ ...image, alt: e.target.value })} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-3 max-sm:w-full max-sm:flex-col">
            <Button disabled={!preview || image.alt === (preview.defaultAlt ?? '')} onClick={() => void updateAsset({ defaultAlt: image.alt === '' ? null : image.alt }, 'defaultAltSaved')}>
              {t.editor.image.saveDefaultAlt}
            </Button>
            <Button variant="danger" onClick={() => onChange(undefined)}>
              {t.editor.image.remove}
            </Button>
          </div>
          {/* A new tab (a plain link, no client navigation), so the form and anything not yet autosaved stay where they are. */}
          <a
            href={`/t/${encodeURIComponent(tenant.slug)}/assets/${image._ref}`}
            target="_blank"
            rel="noopener"
            className="inline-flex min-h-[44px] items-center text-[15px] font-medium"
          >
            {t.editor.image.details}
          </a>
        </div>
      ) : null}
      {/* The native input is visually hidden but still the label's control: focusable, named, and what a test or a screen reader reaches. */}
      <label
        htmlFor={id}
        className={`${buttonClasses('secondary')} relative self-start max-sm:w-full has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink ${busyPicker}`}
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
    </fieldset>
  );
}
