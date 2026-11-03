import type { ComponentType } from 'react';
import type { SelectChoice } from './descriptors';
import { BooleanField } from './fields/BooleanField';
import { DateField } from './fields/DateField';
import { DateTimeField } from './fields/DateTimeField';
import { ImageField } from './fields/ImageField';
import { LinkField } from './fields/LinkField';
import { NumberField } from './fields/NumberField';
import { RichTextField } from './fields/RichTextField';
import { SelectField } from './fields/SelectField';
import { TextField } from './fields/TextField';

/** What every field component receives. `onChange(undefined)` clears the field. */
export type FieldProps = {
  id: string;
  label: string;
  required: boolean;
  value: unknown;
  onChange: (value: unknown) => void;
  /** A text field's longest length, or a number field's largest value. */
  max?: number;
  multiline?: boolean;
  /** A number field's smallest value. */
  min?: number;
  integer?: boolean;
  options?: SelectChoice[];
};

/**
 * The field components by field kind. A kind with no component is shown by the form as a notice,
 * and its value is saved unchanged.
 */
export const fieldRegistry: Record<string, ComponentType<FieldProps>> = {
  text: TextField,
  date: DateField,
  datetime: DateTimeField,
  number: NumberField,
  boolean: BooleanField,
  select: SelectField,
  link: LinkField,
  image: ImageField,
  richText: RichTextField,
};
