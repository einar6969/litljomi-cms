import type { HTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon';

export type NoticeTone = 'info' | 'success' | 'warning' | 'error';

const ICONS: Record<NoticeTone, IconName> = { info: 'info', success: 'check', warning: 'warning', error: 'alert' };
const TONES: Record<NoticeTone, string> = { info: '', success: 'note-success', warning: 'note-warning', error: 'note-error' };

type Props = HTMLAttributes<HTMLElement> & { tone?: NoticeTone; as?: 'p' | 'div' };

/** A message in a tinted box: the tone is the fill and the icon, the words stay ink. */
export function Notice({ tone = 'info', as: Tag = 'p', className = '', children, ...props }: Props) {
  const Body = Tag === 'p' ? 'span' : 'div';
  return (
    <Tag className={`note ${TONES[tone]} ${className}`.replace(/\s+/g, ' ').trim()} {...props}>
      <Icon name={ICONS[tone]} />
      <Body className="note-body">{children}</Body>
    </Tag>
  );
}
