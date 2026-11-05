/** A status as plain words: `failed_validation` becomes "failed validation". */
export const statusText = (status: string): string => status.replaceAll('_', ' ');

/** A timestamp as UTC to the minute, or a dash when there is none. */
export function when(value: string | null): string {
  if (!value) return '–';
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return '–';
  return `${time.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}
