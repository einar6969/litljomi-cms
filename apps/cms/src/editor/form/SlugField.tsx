'use client';

import { slugify } from '@litljomi/cms-schema/src/slugify.ts';
import { useState } from 'react';
import type { setSlugAction } from '@/app/(editor)/t/[tenant]/actions';
import { t } from '@/i18n/is';

type Props = {
  entryId: string;
  /** The slug the entry has now, or null before one is chosen. */
  initialSlug: string | null;
  /** The title the suggestion is made from. */
  title: string;
  /** True once the entry has been published: the slug can no longer change (§4.3). */
  locked: boolean;
  setSlug: typeof setSlugAction;
};

type Notice = 'saved' | 'taken' | 'locked' | 'invalid' | 'auth' | 'error';

const messages: Record<Notice, string> = {
  saved: t.editor.slug.saved,
  taken: t.editor.slug.taken,
  locked: t.editor.slug.locked,
  invalid: t.editor.slug.invalid,
  auth: t.editor.signedOut,
  error: t.editor.slug.error,
};

const noticeOf = (code: 'invalid' | 'slug_taken' | 'slug_locked' | 'auth' | 'error'): Notice =>
  code === 'slug_taken' ? 'taken' : code === 'slug_locked' ? 'locked' : code;

// `slugify` is the Icelandic transliteration of decision 2 (þ→th, ð→d, æ→ae, ö→o, ...).
export function SlugField({ entryId, initialSlug, title, locked, setSlug }: Props) {
  const [saved, setSaved] = useState(initialSlug);
  // What the editor typed here, if anything; otherwise the saved slug.
  const [typed, setTyped] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const suggestion = slugify(title);
  // The title's suggestion is the placeholder, never the value, so typing into the field cannot
  // append to it (decision 39.3). An empty field saves the suggestion.
  const shown = typed ?? saved ?? '';
  const value = shown !== '' ? shown : suggestion;

  const submit = async () => {
    setBusy(true);
    try {
      const result = await setSlug(entryId, value);
      if (result.ok) {
        setSaved(result.slug);
        setTyped(null);
        setNotice('saved');
      } else {
        setNotice(noticeOf(result.code));
      }
    } catch {
      setNotice('error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <label htmlFor="slug">
        {t.editor.slug.label}
        <input
          id="slug"
          name="slug"
          value={shown}
          placeholder={suggestion}
          disabled={locked}
          onChange={(e) => {
            setTyped(e.target.value);
            setNotice(null);
          }}
        />
      </label>
      {locked ? (
        <p>{t.editor.slug.locked}</p>
      ) : (
        <>
          {saved === null && suggestion !== '' ? (
            <p data-testid="slug-suggestion">
              {t.editor.slug.suggestion}: {suggestion}
            </p>
          ) : null}
          <button type="button" disabled={busy || value === '' || value === saved} onClick={() => void submit()}>
            {t.editor.slug.save}
          </button>
        </>
      )}
      {notice ? <p data-testid="slug-notice" role={notice === 'saved' ? undefined : 'alert'}>{messages[notice]}</p> : null}
    </div>
  );
}
