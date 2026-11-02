import type { ReactNode } from 'react';

type Props = {
  label: string;
  /** The id of the control inside, as the label's `for`. */
  htmlFor: string;
  children: ReactNode;
  /** Help text under the control. */
  help?: ReactNode;
  /** An error under the control; it is announced as an alert. */
  error?: ReactNode;
};

/**
 * A form field: the label above the control, then help and error text. The control sits inside
 * the label, so the label's text is its accessible name.
 */
export function Field({ label, htmlFor, children, help, error }: Props) {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-1.5 text-[15px] font-medium">
      <span>{label}</span>
      {children}
      {help ? <span className="text-sm font-normal text-muted">{help}</span> : null}
      {error ? (
        <span role="alert" className="text-sm font-medium text-danger">
          {error}
        </span>
      ) : null}
    </label>
  );
}
