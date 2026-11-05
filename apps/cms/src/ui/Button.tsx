import type { ButtonHTMLAttributes } from 'react';

/** `primary` is green and only for sending something out; `ink` is the everyday primary action. */
export type ButtonVariant = 'primary' | 'ink' | 'secondary' | 'quiet' | 'danger';
export type ButtonSize = 'default' | 'sm';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'btn-go',
  ink: 'btn-ink',
  secondary: 'btn-line',
  quiet: 'btn-quiet',
  danger: 'btn-off',
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize };

/** The classes of a button, for a control that is not a `<button>` (a link or a file picker). */
export const buttonClasses = (variant: ButtonVariant = 'secondary', size: ButtonSize = 'default'): string =>
  `btn ${VARIANTS[variant]}${size === 'sm' ? ' btn-sm' : ''}`;

/** The classes of a link that looks like a button. */
export const linkButtonClasses = buttonClasses;

/** The editor's button. `type` defaults to "button"; a submit button says so. */
export function Button({ variant = 'secondary', size = 'default', type = 'button', className = '', ...props }: Props) {
  return <button type={type} className={`${buttonClasses(variant, size)} ${className}`.trim()} {...props} />;
}
