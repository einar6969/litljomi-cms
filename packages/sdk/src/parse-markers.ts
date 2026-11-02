/**
 * Parsers for the markers in markers.tsx; shared by the worker's live check and the sites' tests
 * (decision 7). Only markers a browser renders as elements count (Task 18 security r1, 11a): the
 * scanner skips comments, the contents of `script`, `style`, `textarea`, `title` and `template`,
 * and attribute values. It visits each character a bounded number of times and stops at a tag
 * without its closing `>` (11c), so its cost is linear in the input. Names are folded ASCII-only on
 * the page itself, and a scan that stops early is reported as incomplete (Task 21 security r1).
 */

/** Elements whose contents are not parsed as markup (raw text, escapable raw text) or not rendered (template). */
const SKIPPED_CONTENT = new Set(['script', 'style', 'textarea', 'title', 'template']);

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    const cp = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
  });
}

const isSpace = (c: string | undefined) => c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f';
const isNameStart = (c: string | undefined) => c !== undefined && /[A-Za-z]/.test(c);

/**
 * ASCII-only lower case, as HTML folds tag and attribute names. String.prototype.toLowerCase is not
 * used on the page: it folds non-ASCII letters too and can change the length ('İ', U+0130, becomes
 * two code units), so positions found in a folded copy do not index the page (Task 21 security r1).
 */
const asciiLower = (s: string) => s.replace(/[A-Z]+/g, (m) => m.toLowerCase());

/** One start tag: its lower-case name and attributes (first occurrence wins, values decoded). */
type Tag = { name: string; attrs: Map<string, string> };

/**
 * Reads the start tag whose name begins at `i` (just after `<`). Returns the tag and the index
 * after its `>`, or null when the input ends before the tag does.
 */
function readTag(html: string, i: number): { tag: Tag; end: number } | null {
  const n = html.length;
  let j = i;
  while (j < n && !isSpace(html[j]) && html[j] !== '/' && html[j] !== '>') j++;
  const name = asciiLower(html.slice(i, j));
  const attrs = new Map<string, string>();
  for (;;) {
    while (j < n && (isSpace(html[j]) || html[j] === '/')) j++;
    if (j >= n) return null;
    if (html[j] === '>') return { tag: { name, attrs }, end: j + 1 };
    const keyStart = j;
    while (j < n && !isSpace(html[j]) && html[j] !== '/' && html[j] !== '>' && html[j] !== '=') j++;
    const key = asciiLower(html.slice(keyStart, j));
    while (j < n && isSpace(html[j])) j++;
    let value = '';
    if (html[j] === '=') {
      j++;
      while (j < n && isSpace(html[j])) j++;
      const q = html[j];
      if (q === '"' || q === "'") {
        const close = html.indexOf(q, j + 1);
        if (close === -1) return null;
        value = html.slice(j + 1, close);
        j = close + 1;
      } else {
        const valueStart = j;
        while (j < n && !isSpace(html[j]) && html[j] !== '>') j++;
        value = html.slice(valueStart, j);
      }
    }
    if (key !== '' && !attrs.has(key)) attrs.set(key, decode(value));
  }
}

/**
 * Index of the end of `</name ...>` from `from`, or -1. The name is compared ASCII
 * case-insensitively on the page itself (`name` is lower-case ASCII), so no position shifts.
 */
function closingTagEnd(html: string, name: string, from: number): number {
  let k = from;
  for (;;) {
    const at = html.indexOf('</', k);
    if (at === -1) return -1;
    const nameEnd = at + 2 + name.length;
    const after = html[nameEnd];
    if (asciiLower(html.slice(at + 2, nameEnd)) === name && (after === undefined || isSpace(after) || after === '>' || after === '/')) {
      const gt = html.indexOf('>', nameEnd);
      return gt === -1 ? -1 : gt + 1;
    }
    k = at + 2;
  }
}

/**
 * Index just after the comment that starts at `lt` (`<!--`), or -1 when it never ends. Ends where a
 * browser ends it: `<!-->` and `<!--->` are empty comments, and `--!>` closes one like `-->`.
 * `bang` carries the position of the next `--!>` (-1: none) from one call to the next.
 */
function commentEnd(html: string, lt: number, bang: { at?: number }): number {
  const body = lt + 4;
  if (html[body] === '>') return body + 1;
  if (html.startsWith('->', body)) return body + 2;
  const a = html.indexOf('-->', body);
  // The next `--!>` is remembered between comments, so a page without one is searched once (linear).
  if (bang.at === undefined || (bang.at !== -1 && bang.at < body)) bang.at = html.indexOf('--!>', body);
  const b = bang.at;
  if (a === -1 && b === -1) return -1;
  if (b === -1 || (a !== -1 && a < b)) return a + 3;
  return b + 4;
}

/**
 * The start tags a browser would render as elements, in document order, and whether the scan
 * reached the end of the page. It stops early, with `complete: false`, at an unterminated tag,
 * quote, comment or declaration and at a skipped element that is never closed: what follows is
 * unread, so the result proves nothing about it (Task 21 security r1).
 */
function scan(html: string): { tags: Tag[]; complete: boolean } {
  const out: Tag[] = [];
  const n = html.length;
  const bang: { at?: number } = {};
  let i = 0;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;
    if (html.startsWith('<!--', lt)) {
      const end = commentEnd(html, lt, bang);
      if (end === -1) return { tags: out, complete: false };
      i = end;
      continue;
    }
    const c = html[lt + 1];
    if (c === '!' || c === '?' || c === '/') {
      // A doctype, processing instruction or end tag: skip to its `>`.
      const gt = html.indexOf('>', lt + 1);
      if (gt === -1) return { tags: out, complete: false };
      i = gt + 1;
      continue;
    }
    if (!isNameStart(c)) {
      i = lt + 1;
      continue;
    }
    const read = readTag(html, lt + 1);
    if (read === null) return { tags: out, complete: false };
    out.push(read.tag);
    i = read.end;
    if (SKIPPED_CONTENT.has(read.tag.name)) {
      const end = closingTagEnd(html, read.tag.name, i);
      if (end === -1) return { tags: out, complete: false };
      i = end;
    }
  }
  return { tags: out, complete: true };
}

type Marker = { id: string; hash: string };

/**
 * Every entry marker of the page in one scan: `markers` as parseEntryMarkers returns them, `ids` as
 * parseEntryMarkerIds does, and `complete`, false when the scan could not read the page to its end
 * (see scan). An incomplete scan is inconclusive: the live check's `absent` fails on it, while a
 * marker found before the stop still counts for `present`.
 */
export function scanEntryMarkers(html: string): { ids: string[]; markers: Marker[]; complete: boolean } {
  const { tags, complete } = scan(html);
  const ids: string[] = [];
  const markers: Marker[] = [];
  for (const { name, attrs } of tags) {
    if (name !== 'span') continue;
    const id = attrs.get('data-cms-entry');
    if (id === undefined || id === '') continue;
    ids.push(id);
    const hash = attrs.get('data-cms-hash');
    if (hash !== undefined && hash !== '') markers.push({ id, hash });
  }
  return { ids, markers, complete };
}

/** Entry markers in document order. A marker lacking its id or its hash is ignored. */
export function parseEntryMarkers(html: string): Marker[] {
  return scanEntryMarkers(html).markers;
}

/**
 * The entry ids of every entry marker in document order, whatever its hash: a marker with an id
 * and a missing, empty or other hash still shows the entry. `absent` checks use this, so they fail
 * closed on an incomplete marker (Task 18 security r1, 11b).
 */
export function parseEntryMarkerIds(html: string): string[] {
  return scanEntryMarkers(html).ids;
}

/** The release number, or null when absent, malformed, or when markers disagree. */
export function parseReleaseMarker(html: string): number | null {
  const found = new Set<number>();
  for (const { name, attrs } of scan(html).tags) {
    if (name !== 'meta' || attrs.get('name') !== 'cms-release') continue;
    const content = attrs.get('content') ?? '';
    if (!/^\d{1,15}$/.test(content)) return null;
    found.add(Number(content));
  }
  if (found.size !== 1) return null;
  return [...found][0] ?? null;
}
