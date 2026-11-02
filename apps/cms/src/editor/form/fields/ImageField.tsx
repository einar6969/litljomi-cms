'use client';

import { useEffect, useState, type MouseEvent } from 'react';
import { assetPreviewAction, registerAssetAction, updateAssetAction } from '@/app/(editor)/t/[tenant]/asset-actions';
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

const toneOf = (notice: Notice): NoticeTone => (notice === 'uploading' ? 'info' : notice.endsWith('Saved') ? 'success' : 'error');

const ACCEPT = 'image/jpeg,image/png,image/webp';

const imageOf = (value: unknown): ImageValue | null => {
  if (typeof value !== 'object' || value === null) return null;
  const { _ref, _kind, alt } = value as Partial<ImageValue>;
  return typeof _ref === 'string' && _kind === 'asset' ? { _ref, _kind, alt: typeof alt === 'string' ? alt : '' } : null;
};

// Two decimals is finer than any crop needs.
const fraction = (offset: number, size: number) => Math.round(Math.min(1, Math.max(0, offset / size)) * 100) / 100;

/**
 * An image field (§5.2, §5.6). A chosen file is checked before upload (`prepareUpload`), uploaded
 * from the browser to `media-private` with the editor's session, then registered by the server,
 * which reads the object back. The preview is a signed URL valid for 600 seconds, signed again if
 * it has expired. The alt text belongs to this use; the asset's own default alt text and focal
 * point are edited here too (`update_asset`).
 */
export function ImageField({ id, label, required, value, onChange }: FieldProps) {
  const tenant = useEditorTenant();
  const image = imageOf(value);
  const ref = image?._ref ?? null;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [signing, setSigning] = useState(0);
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
        } else setNotice(result.code === 'auth' ? 'auth' : 'previewError');
      })
      .catch(() => live && setNotice('previewError'));
    return () => {
      live = false;
    };
  }, [ref, signing]);

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
      const filename = prepared.path.slice(prepared.path.lastIndexOf('/') + 1);
      const result = await registerAssetAction(tenant.slug, prepared.assetId, prepared.path, filename);
      if (!result.ok) {
        setNotice(result.code === 'type' || result.code === 'size' || result.code === 'auth' ? result.code : 'uploadError');
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

  const updateAsset = async (focalX: number | null, focalY: number | null, defaultAlt: string | null, saved: Notice) => {
    if (!image || !preview) return;
    try {
      const result = await updateAssetAction(image._ref, focalX, focalY, defaultAlt);
      if (result.ok) {
        setPreview({ ...preview, focalX, focalY, defaultAlt });
        setNotice(saved);
      } else {
        setNotice(result.code === 'auth' ? 'auth' : 'updateError');
      }
    } catch {
      setNotice('updateError');
    }
  };

  const chooseFocal = (e: MouseEvent<HTMLButtonElement>) => {
    if (!preview) return;
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    void updateAsset(fraction(e.clientX - box.left, box.width), fraction(e.clientY - box.top, box.height), preview.defaultAlt, 'focalSaved');
  };

  const busyPicker = busy ? 'cursor-not-allowed border-hairline bg-recessed text-muted' : 'cursor-pointer';
  return (
    <fieldset className="flex min-w-0 flex-col gap-3 rounded-lg border border-hairline p-4">
      <legend className="px-1 text-[15px] font-medium">{label}</legend>
      {image ? (
        <div className="flex flex-col items-start gap-3">
          {preview ? (
            <button
              type="button"
              title={t.editor.image.focal}
              aria-label={t.editor.image.focal}
              onClick={chooseFocal}
              className="relative inline-block min-h-0 max-w-full cursor-crosshair overflow-hidden rounded-lg border border-hairline bg-recessed p-0 leading-none hover:bg-recessed"
            >
              {/* A signed URL of the private original (§5.6), not a public file. */}
              <img
                data-testid={`${id}-preview`}
                src={preview.url}
                alt={image.alt}
                className="block max-h-[240px] max-w-full"
                onError={() => setSigning((n) => (n < 3 ? n + 1 : n))}
              />
              {preview.focalX !== null && preview.focalY !== null ? (
                <span
                  aria-hidden="true"
                  className="absolute -m-[7px] size-3.5 rounded-full border-2 border-ink bg-canvas"
                  style={{ left: `${preview.focalX * 100}%`, top: `${preview.focalY * 100}%` }}
                />
              ) : null}
            </button>
          ) : null}
          <div className="w-full">
            <Field label={t.editor.image.alt} htmlFor={`${id}-alt`}>
              <input id={`${id}-alt`} name={`${id}-alt`} type="text" maxLength={1000} value={image.alt} onChange={(e) => onChange({ ...image, alt: e.target.value })} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-3 max-sm:w-full max-sm:flex-col">
            <Button disabled={!preview || image.alt === (preview.defaultAlt ?? '')} onClick={() => void updateAsset(preview?.focalX ?? null, preview?.focalY ?? null, image.alt === '' ? null : image.alt, 'defaultAltSaved')}>
              {t.editor.image.saveDefaultAlt}
            </Button>
            <Button variant="danger" onClick={() => onChange(undefined)}>
              {t.editor.image.remove}
            </Button>
          </div>
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
          {...(notice === 'uploading' || notice.endsWith('Saved') ? { 'aria-live': 'polite' as const } : { role: 'alert' })}
        >
          {messages[notice]}
        </NoticeBox>
      ) : null}
    </fieldset>
  );
}
