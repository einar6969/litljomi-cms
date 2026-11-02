import type { HTMLAttributes } from 'react';

export type NoticeTone = 'info' | 'success' | 'warning' | 'error';

const TONES: Record<NoticeTone, string> = {
  info: 'border-l-muted',
  success: 'border-l-accent',
  warning: 'border-l-warning',
  error: 'border-l-danger',
};

type Props = HTMLAttributes<HTMLElement> & { tone?: NoticeTone; as?: 'p' | 'div' };

/** A message in a box with a coloured edge; the text is ink, the tone is the edge. */
export function Notice({ tone = 'info', as: Tag = 'p', className = '', ...props }: Props) {
  return (
    <Tag
      className={`max-w-none rounded-lg border border-l-[6px] border-hairline bg-recessed px-4 py-3 text-[15px] text-ink ${TONES[tone]} ${className}`}
      {...props}
    />
  );
}
