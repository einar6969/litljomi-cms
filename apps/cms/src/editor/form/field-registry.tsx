import type { ComponentType } from 'react';
import type { FieldDescriptor, SelectChoice } from './descriptors';
import { BooleanField } from './fields/BooleanField';
import { DateField } from './fields/DateField';
import { DateTimeField } from './fields/DateTimeField';
import { GroupField } from './fields/GroupField';
import { ImageField } from './fields/ImageField';
import { LinkField } from './fields/LinkField';
import { ListField } from './fields/ListField';
import { NumberField } from './fields/NumberField';
import { ReferenceField } from './fields/ReferenceField';
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
  /** A text field's longest length, a number field's largest value, or a list's most items. */
  max?: number;
  multiline?: boolean;
  /** A number field's smallest value, or a list's fewest items on publish. */
  min?: number;
  integer?: boolean;
  options?: SelectChoice[];
  /** A reference field's allowed target types. */
  to?: readonly string[];
  /** A list's item field (M2-15). */
  of?: FieldDescriptor;
  /** A group's nested fields (M2-15). */
  fields?: readonly FieldDescriptor[];
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
  reference: ReferenceField,
  list: ListField,
  group: GroupField,
};
