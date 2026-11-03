import type { ReactNode } from 'react';

type Props = {
  label: string;
  /** The id of the control inside, as the label's `for`. */
  htmlFor: string;
  children: ReactNode;
  /** Help text under the control, with the id `fieldHelpId(htmlFor)`. */
  help?: ReactNode;
  /** An error under the control, announced as an alert, with the id `fieldErrorId(htmlFor)`. */
  error?: ReactNode;
};

/** The id of a field's help text, for the control's `aria-describedby`. */
export const fieldHelpId = (htmlFor: string) => `${htmlFor}-help`;
/** The id of a field's error text, for the control's `aria-describedby`. */
export const fieldErrorId = (htmlFor: string) => `${htmlFor}-error`;

/**
 * A form field: the label above the control, then help and error text. The control sits inside
 * the label, so the label's text is its accessible name. Help and error sit outside the label, so
 * they never become part of that name (Task 31 spec-quality r1); a control that has them refers to
 * them with `aria-describedby`.
 */
export function Field({ label, htmlFor, children, help, error }: Props) {
  return (
    <div className="flex flex-col gap-1.5 text-[15px] font-medium">
      <label htmlFor={htmlFor} className="flex flex-col gap-1.5">
        <span>{label}</span>
        {children}
      </label>
      {help ? (
        <span id={fieldHelpId(htmlFor)} className="text-sm font-normal text-muted">
          {help}
        </span>
      ) : null}
      {error ? (
        <span id={fieldErrorId(htmlFor)} role="alert" className="text-sm font-medium text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}
