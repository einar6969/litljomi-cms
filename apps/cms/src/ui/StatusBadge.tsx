import type { HTMLAttributes } from 'react';

export type BadgeTone = 'pending' | 'ok' | 'error';

const TONES: Record<BadgeTone, string> = {
  // Pending is neutral; "Birt á vef ✓" is the accent as a fill with ink text; errors are danger.
  pending: 'border-hairline bg-recessed text-ink',
  ok: 'border-transparent bg-accent text-ink',
  error: 'border-transparent bg-danger text-canvas',
};

const DOTS: Record<BadgeTone, string> = {
  pending: 'bg-muted motion-safe:animate-pulse',
  ok: 'bg-ink',
  error: 'bg-canvas',
};

type Props = HTMLAttributes<HTMLElement> & { tone: BadgeTone; as?: 'p' | 'span' };

/** A status as a pill: the text is the status, the dot is only decoration. */
export function StatusBadge({ tone, as: Tag = 'p', className = '', children, ...props }: Props) {
  return (
    <Tag
      className={`inline-flex w-fit max-w-full items-center gap-2 rounded-lg border px-3 py-1.5 text-[15px] font-semibold ${TONES[tone]} ${className}`}
      {...props}
    >
      <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${DOTS[tone]}`} />
      <span>{children}</span>
    </Tag>
  );
}
