import type { HTMLAttributes } from 'react';

export type BadgeTone = 'pending' | 'ok' | 'neutral' | 'warning' | 'error' | 'hollow';

type Props = HTMLAttributes<HTMLElement> & {
  tone: BadgeTone;
  as?: 'p' | 'span';
  /** `pill` is a small status in a list; `state` is the publish panel's full-width status. */
  look?: 'pill' | 'state';
};

/** A status: the text is the status, the dot is only decoration. Pending alone pulses. */
export function StatusBadge({ tone, as: Tag = 'span', look = 'pill', className = '', children, ...props }: Props) {
  const toned = tone === 'pending' || tone === 'neutral' ? '' : `${look}-${tone}`;
  return (
    <Tag className={`${look} ${toned} ${className}`.replace(/\s+/g, ' ').trim()} {...props}>
      <span aria-hidden="true" className={tone === 'pending' ? 'dot motion-safe:animate-pulse' : 'dot'} />
      <span>{children}</span>
    </Tag>
  );
}
