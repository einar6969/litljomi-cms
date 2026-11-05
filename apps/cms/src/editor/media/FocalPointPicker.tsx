'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { t } from '@/i18n/is';
import { Button } from '@/ui/Button';
import { fraction, moveFocal, percentOf, type FocalPoint } from './focal-point';

type Props = {
  /** The base of the ids inside: `${id}-focal`, `${id}-focal-help`, `${id}-preview`. */
  id: string;
  /** A signed URL of the private original (§5.6), not a public file. */
  url: string;
  alt: string;
  /** The saved focal point, or null when the asset has none. */
  focal: FocalPoint | null;
  /** Saves a new focal point, or null to remove it. */
  onSave: (focal: FocalPoint | null) => void;
  onImageError: () => void;
};

/** Arrow key presses closer together than this are saved once, after the last one. */
export const KEYBOARD_SAVE_DELAY_MS = 600;

const describe = (focal: FocalPoint | null) => {
  if (focal === null) return t.editor.image.focalNone;
  const { x, y } = percentOf(focal);
  return t.editor.image.focalAt.replace('{x}', String(x)).replace('{y}', String(y));
};

/**
 * The image with its focal point (§5.6), chosen with the pointer or the keyboard (Task 31 r3
 * Minor). A click saves the point clicked. The arrow keys move the point by 5 % (1 % with Shift),
 * starting from the centre when there is none; the moves are shown at once and saved once the keys
 * rest, or when the picker loses focus. The control is a button, so it is in the tab order and shows
 * the global focus ring; its description says where the point is, in words.
 */
export function FocalPointPicker({ id, url, alt, focal, onSave, onImageError }: Props) {
  // A keyboard move not saved yet; null when the shown point is the saved one.
  const [pending, setPending] = useState<FocalPoint | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shown = pending ?? focal;

  const cancelTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancelTimer, []);

  const save = (point: FocalPoint | null) => {
    cancelTimer();
    setPending(null);
    onSave(point);
  };

  const flush = () => {
    if (pending !== null) save(pending);
  };

  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    // Enter and Space also click a button, with no pointer position (detail 0): not a choice.
    if (e.detail === 0) return;
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    save({ x: fraction(e.clientX - box.left, box.width), y: fraction(e.clientY - box.top, box.height) });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const next = moveFocal(shown, e.key, e.shiftKey);
    if (next === null) return;
    e.preventDefault();
    setPending(next);
    cancelTimer();
    timer.current = setTimeout(() => save(next), KEYBOARD_SAVE_DELAY_MS);
  };

  const helpId = `${id}-focal-help`;
  return (
    <div className="flex flex-col items-start gap-2">
      <button
        id={`${id}-focal`}
        type="button"
        title={t.editor.image.focal}
        aria-label={t.editor.image.focalLabel}
        aria-describedby={helpId}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onBlur={flush}
        className="relative inline-block min-h-0 max-w-full cursor-crosshair overflow-hidden rounded-md border border-hairline bg-recessed p-0 leading-none"
      >
        <img data-testid={`${id}-preview`} src={url} alt={alt} className="block max-h-[240px] max-w-full" onError={onImageError} />
        {shown !== null ? (
          <span
            aria-hidden="true"
            data-testid={`${id}-focal-marker`}
            className="absolute -m-[7px] size-3.5 rounded-full border-2 border-ink bg-canvas"
            style={{ left: `${shown.x * 100}%`, top: `${shown.y * 100}%` }}
          />
        ) : null}
      </button>
      <p id={helpId} className="help">
        <span data-testid={`${id}-focal-value`}>{describe(shown)}</span> {t.editor.image.focalHelp}
      </p>
      {focal !== null || pending !== null ? (
        <Button size="sm" onClick={() => save(null)}>
          {t.editor.image.clearFocal}
        </Button>
      ) : null}
    </div>
  );
}
