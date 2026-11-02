import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

const BASE =
  'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border px-4 text-[15px] font-semibold transition-colors disabled:cursor-not-allowed';

const VARIANTS: Record<ButtonVariant, string> = {
  // Accent is the fill; the text on it is ink.
  primary: 'border-ink bg-accent text-ink hover:bg-[color-mix(in_srgb,#8ed462_82%,#171714)] disabled:border-hairline disabled:bg-recessed disabled:text-muted',
  secondary: 'border-ink bg-canvas text-ink hover:bg-recessed disabled:border-hairline disabled:bg-recessed disabled:text-muted',
  danger: 'border-danger bg-canvas text-danger hover:bg-danger hover:text-canvas disabled:border-hairline disabled:bg-recessed disabled:text-muted',
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant };

/** The editor's button. `type` defaults to "button"; a submit button says so. */
export function Button({ variant = 'secondary', type = 'button', className = '', ...props }: Props) {
  return <button type={type} className={`${BASE} ${VARIANTS[variant]} ${className}`} {...props} />;
}
