'use client';

// The kind's own parsing and limit, so the form and the publish rule cannot disagree. A deep import:
// the package's barrel loads node:crypto, which a browser cannot.
import { MAX_VIDEO_TITLE_LENGTH, normaliseVideoUrl, parseVideoUrl, type VideoValue } from '@litljomi/cms-schema/src/fields/video.ts';
import { useEffect, useRef, useState } from 'react';
import { t } from '@/i18n/is';
import { describedByOf, Field, FieldGroup } from '@/ui/Field';
import type { FieldProps } from '../field-registry';
import { ImageField } from './ImageField';

const EMPTY: VideoValue = { url: '', title: '', still: null };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The stored video, or null when the value is not one (the still is checked by the image field). */
function videoOf(value: unknown): VideoValue | null {
  if (!isObject(value)) return null;
  const { url, title, still } = value;
  if (typeof url !== 'string' || typeof title !== 'string' || (still !== null && !isObject(still))) return null;
  return { url, title, still: still as VideoValue['still'] };
}

const isEmpty = (v: VideoValue) => v.url === '' && v.title === '' && v.still === null;

/**
 * A video field (spec §5.2, A11): a link to a video on YouTube or Vimeo, its title and a still image.
 * The address is normalised as it is typed or pasted (`https://` added, `http:` raised); the stored
 * address is that normal form, and the input keeps the editor's own text until the value is replaced
 * from outside (a reloaded version). Under the input, a line says which provider and video were
 * recognised, or a plain error says it is not a known video address; an unknown address is still
 * stored, so the error is there again after a reload, and publishing refuses it. The still is the
 * image field's own component. The stored value always has all three parts; a field with nothing
 * left in it is cleared. The parts' ids derive from the field's (`<id>-url`, `<id>-title`,
 * `<id>-still`). A stored value that is not a video is named in an error and replaced only when the
 * editor fills in a part.
 */
export function VideoField({ id, label, required, value, onChange, still: stillOption = 'optional' }: FieldProps) {
  const v = t.editor.video;
  const stored = videoOf(value);
  const current = stored ?? EMPTY;
  const [storedInvalid, setStoredInvalid] = useState(value !== undefined && value !== null && stored === null);
  // The latest value, so a change from one part and an upload that finishes later both land.
  const latest = useRef<VideoValue>(current);
  useEffect(() => {
    latest.current = videoOf(value) ?? EMPTY;
  }, [value]);

  const [text, setText] = useState(current.url);
  // The address this input last stored: a different stored address came from outside, and replaces the text.
  const sent = useRef(current.url);
  useEffect(() => {
    if (current.url !== sent.current) {
      sent.current = current.url;
      setText(current.url);
    }
  }, [current.url]);

  const change = (patch: Partial<VideoValue>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setStoredInvalid(false);
    onChange(isEmpty(next) ? undefined : next);
  };

  const changeUrl = (next: string) => {
    setText(next);
    const url = next.trim() === '' ? '' : normaliseVideoUrl(next);
    sent.current = url;
    change({ url });
  };

  const urlId = `${id}-url`;
  const recognised = text.trim() === '' ? null : parseVideoUrl(normaliseVideoUrl(text));
  const urlError = text.trim() !== '' && recognised === null ? v.unknown : null;
  const urlHelp = recognised ? v.recognised.replace('{provider}', v.providers[recognised.provider]).replace('{id}', recognised.id) : urlError ? null : v.help;
  // A present video needs an address and a title on publish (and the still, when the option says so).
  const needed = required || !isEmpty(current);
  const groupError = storedInvalid ? t.editor.invalidStored : null;

  return (
    <FieldGroup id={id} label={label} required={required} error={groupError} describedBy={describedByOf(id, { error: groupError })}>
      <div className="grp">
        <Field label={v.url} htmlFor={urlId} required={needed} help={urlHelp} error={urlError}>
          <input
            type="text"
            inputMode="url"
            id={urlId}
            name={urlId}
            required={needed}
            value={text}
            aria-invalid={urlError !== null}
            aria-describedby={describedByOf(urlId, { help: urlHelp, error: urlError })}
            onChange={(e) => changeUrl(e.target.value)}
          />
        </Field>
        <Field label={v.title} htmlFor={`${id}-title`} required={needed}>
          <input
            type="text"
            id={`${id}-title`}
            name={`${id}-title`}
            required={needed}
            maxLength={MAX_VIDEO_TITLE_LENGTH}
            value={current.title}
            onChange={(e) => change({ title: e.target.value })}
          />
        </Field>
        <ImageField
          id={`${id}-still`}
          label={v.still}
          required={needed && stillOption === 'required'}
          value={current.still ?? undefined}
          onChange={(next) => change({ still: next === undefined ? null : (next as VideoValue['still']) })}
        />
      </div>
    </FieldGroup>
  );
}
