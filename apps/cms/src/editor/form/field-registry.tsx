import type { ComponentType } from 'react';
import { DateField } from './fields/DateField';
import { ImageField } from './fields/ImageField';
import { LinkField } from './fields/LinkField';
import { RichTextField } from './fields/RichTextField';
import { TextField } from './fields/TextField';

/** What every field component receives. `onChange(undefined)` clears the field. */
export type FieldProps = {
  id: string;
  label: string;
  required: boolean;
  value: unknown;
  onChange: (value: unknown) => void;
  max?: number;
  multiline?: boolean;
};

/**
 * The field components by field kind. A kind with no component (none of the news type's kinds
 * since Task 24) is shown by the form as a notice, and its value is saved unchanged.
 */
export const fieldRegistry: Record<string, ComponentType<FieldProps>> = {
  text: TextField,
  date: DateField,
  link: LinkField,
  image: ImageField,
  richText: RichTextField,
};
