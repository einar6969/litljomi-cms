const ICELANDIC: Record<string, string> = {
  þ: 'th',
  ð: 'd',
  æ: 'ae',
  ö: 'o',
  á: 'a',
  é: 'e',
  í: 'i',
  ó: 'o',
  ú: 'u',
  ý: 'y',
};

/** Lowercase ASCII with hyphens; matches `^[a-z0-9]+(?:-[a-z0-9]+)*$` or is empty. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[þðæöáéíóúý]/g, (c) => ICELANDIC[c] ?? c)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
