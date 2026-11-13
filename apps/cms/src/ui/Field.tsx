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
  /**
   * Shows the required marker after the label. The marker is only visual (`aria-hidden`); the
   * control's own `required` attribute is what assistive technology announces.
   */
  required?: boolean;
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
export function Field({ label, htmlFor, children, help, error, required = false }: Props) {
  return (
    <div className="fld">
      <label htmlFor={htmlFor} className="fld">
        <LabelText label={label} required={required} />
        {children}
      </label>
      <HelpAndError id={htmlFor} help={help} error={error} />
    </div>
  );
}

/**
 * A group of controls with one label, such as radio buttons: a fieldset whose legend is the label,
 * with the same required marker, help and error text as `Field`. `id` is the group's own id; the
 * help and error ids derive from it, for the fieldset's `aria-describedby`.
 */
export function FieldGroup({ id, label, children, help, error, required = false, describedBy }: Omit<Props, 'htmlFor'> & { id: string; describedBy?: string }) {
  return (
    <div className="fld">
      <fieldset id={id} aria-describedby={describedBy} className="fld">
        <legend className="mb-1.5">
          <LabelText label={label} required={required} />
        </legend>
        {children}
      </fieldset>
      <HelpAndError id={id} help={help} error={error} />
    </div>
  );
}

/** The `aria-describedby` value for a control with the given help and error, or undefined for none. */
export function describedByOf(id: string, { help, error }: { help?: unknown; error?: unknown }): string | undefined {
  const ids = [help ? fieldHelpId(id) : null, error ? fieldErrorId(id) : null].filter((x) => x !== null);
  return ids.length > 0 ? ids.join(' ') : undefined;
}

function LabelText({ label, required }: { label: string; required: boolean }) {
  return (
    <span className="lab">
      {label}
      {required ? <RequiredMarker /> : null}
    </span>
  );
}

/**
 * The required marker after a label, for a field whose label is not a `Field` or `FieldGroup`
 * (the rich-text box). Only visual: the control states it with `required` or `aria-required`.
 */
export function RequiredMarker() {
  return (
    <span aria-hidden="true" data-required-marker="" className="req">
      *
    </span>
  );
}

function HelpAndError({ id, help, error }: { id: string; help?: ReactNode; error?: ReactNode }) {
  return (
    <>
      {help ? (
        <span id={fieldHelpId(id)} className="help">
          {help}
        </span>
      ) : null}
      {error ? (
        <span id={fieldErrorId(id)} role="alert" className="err">
          {error}
        </span>
      ) : null}
    </>
  );
}
