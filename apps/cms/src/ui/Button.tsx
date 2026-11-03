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

/** The classes of a button, for a control that is not a `<button>` (a link or a file picker). */
export const buttonClasses = (variant: ButtonVariant = 'secondary'): string => `${BASE} ${VARIANTS[variant]}`;

/** The classes of a link that looks like a button: the button's, without the links' underline. */
export const linkButtonClasses = (variant: ButtonVariant = 'secondary'): string => `${buttonClasses(variant)} no-underline`;

/** The editor's button. `type` defaults to "button"; a submit button says so. */
export function Button({ variant = 'secondary', type = 'button', className = '', ...props }: Props) {
  return <button type={type} className={`${buttonClasses(variant)} ${className}`} {...props} />;
}
