'use client';

import { useEffect, useState } from 'react';
import { assetPreviewAction, updateAssetAction } from '@/app/(editor)/t/[tenant]/asset-actions';
import { t } from '@/i18n/is';
import { Button } from '@/ui/Button';
import { Field, fieldHelpId } from '@/ui/Field';
import { Notice as NoticeBox } from '@/ui/Notice';
import { MAX_ALT_LENGTH, type AssetChange } from './asset-metadata';
import type { FocalPoint } from './focal-point';
import { FocalPointPicker } from './FocalPointPicker';

type Props = {
  assetId: string;
  /**
   * A signed URL of the file's thumbnail in `media-private` (§5.6), valid for 600 seconds, or null
   * when the file has none yet: the preview is then asked for (`assetPreviewAction`), which makes it.
   */
  url: string | null;
  filename: string;
  width: number;
  height: number;
  focal: FocalPoint | null;
  defaultAlt: string | null;
};

type Notice = 'focalSaved' | 'defaultAltSaved' | 'updateError' | 'previewError' | 'auth';

const messages: Record<Notice, string> = {
  focalSaved: t.editor.image.focalSaved,
  defaultAltSaved: t.editor.image.defaultAltSaved,
  updateError: t.editor.image.updateError,
  previewError: t.editor.image.previewError,
  auth: t.editor.signedOut,
};

/** A preview that fails to load (an expired signed URL) is signed again at most this many times. */
const MAX_PREVIEW_RESIGNS = 3;

const ID = 'asset';

/**
 * One asset's detail (§5.6): its thumbnail, its file name and size, and the two things an editor
 * edits per asset, the focal point and the default alt text, each saved on its own through
 * `updateAssetAction` (the other part is kept as stored). Alt text per use is edited in the image
 * field of each entry, and is what the site receives.
 */
export function AssetDetail({ assetId, url: initialUrl, filename, width, height, focal: initialFocal, defaultAlt: initialAlt }: Props) {
  const [url, setUrl] = useState(initialUrl);
  const [resigns, setResigns] = useState(0);
  const [focal, setFocal] = useState(initialFocal);
  const [savedAlt, setSavedAlt] = useState(initialAlt ?? '');
  const [alt, setAlt] = useState(initialAlt ?? '');
  const [notice, setNotice] = useState<Notice | null>(null);

  const save = async (change: AssetChange, saved: Notice, apply: () => void) => {
    try {
      const result = await updateAssetAction(assetId, change);
      if (result.ok) {
        apply();
        setNotice(saved);
      } else setNotice(result.code === 'auth' ? 'auth' : 'updateError');
    } catch {
      setNotice('updateError');
    }
  };

  const loadPreview = async () => {
    const result = await assetPreviewAction(assetId).catch(() => null);
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

  const trimmed = alt.trim();
  return (
    <div className="asset">
      <div className="card sheet">
        {url !== null ? (
          <FocalPointPicker
            id={ID}
            url={url}
            alt={savedAlt}
            focal={focal}
            onSave={(next) => void save({ focal: next }, 'focalSaved', () => setFocal(next))}
            onImageError={() => void previewFailed()}
          />
        ) : (
          <div className="thumb" />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <section className="card sub">
          <dl className="meta">
            <dt>{t.asset.filename}</dt>
            <dd className="mono min-w-0 break-words" data-testid="asset-filename">
              {filename}
            </dd>
            <dt>{t.asset.size}</dt>
            <dd className="mono" data-testid="asset-size">
              {t.asset.dimensions.replace('{width}', String(width)).replace('{height}', String(height))}
            </dd>
          </dl>
        </section>
        <form
          className="card sub"
          onSubmit={(e) => {
            e.preventDefault();
            const next = trimmed === '' ? null : trimmed;
            void save({ defaultAlt: next }, 'defaultAltSaved', () => {
              setSavedAlt(next ?? '');
              setAlt(next ?? '');
            });
          }}
        >
          <Field label={t.asset.defaultAlt} htmlFor={`${ID}-default-alt`} help={t.asset.defaultAltHelp}>
            <input
              id={`${ID}-default-alt`}
              name="defaultAlt"
              type="text"
              maxLength={MAX_ALT_LENGTH}
              value={alt}
              aria-describedby={fieldHelpId(`${ID}-default-alt`)}
              onChange={(e) => setAlt(e.target.value)}
            />
          </Field>
          <Button type="submit" size="sm" disabled={trimmed === savedAlt}>
            {t.asset.saveDefaultAlt}
          </Button>
        </form>
        {notice ? (
          <NoticeBox
            data-testid={`${ID}-notice`}
            tone={notice.endsWith('Saved') ? 'success' : 'error'}
            {...(notice.endsWith('Saved') ? { 'aria-live': 'polite' as const } : { role: 'alert' })}
          >
            {messages[notice]}
          </NoticeBox>
        ) : null}
      </div>
    </div>
  );
}
