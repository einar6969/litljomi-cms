/**
 * Parsers for the markers in markers.tsx; shared by the worker's live check and the sites' tests
 * (decision 7). Only markers a browser renders as elements count (Task 18 security r1, 11a): the
 * scanner skips comments, the contents of `script`, `style`, `textarea`, `title` and `template`,
 * and attribute values. It visits each character a bounded number of times and stops at a tag
 * without its closing `>` (11c), so its cost is linear in the input.
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
  const name = html.slice(i, j).toLowerCase();
  const attrs = new Map<string, string>();
  for (;;) {
    while (j < n && (isSpace(html[j]) || html[j] === '/')) j++;
    if (j >= n) return null;
    if (html[j] === '>') return { tag: { name, attrs }, end: j + 1 };
    const keyStart = j;
    while (j < n && !isSpace(html[j]) && html[j] !== '/' && html[j] !== '>' && html[j] !== '=') j++;
    const key = html.slice(keyStart, j).toLowerCase();
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

/** Index of the end of `</name ...>` from `from` (case-insensitive), or -1. */
function closingTagEnd(html: string, lower: string, name: string, from: number): number {
  let k = from;
  for (;;) {
    const at = lower.indexOf('</' + name, k);
    if (at === -1) return -1;
    const after = html[at + 2 + name.length];
    if (after === undefined || isSpace(after) || after === '>' || after === '/') {
      const gt = html.indexOf('>', at);
      return gt === -1 ? -1 : gt + 1;
    }
    k = at + 2;
  }
}

/** The start tags a browser would render as elements, in document order. */
function* tags(html: string): Generator<Tag> {
  const lower = html.toLowerCase();
  const n = html.length;
  let i = 0;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) return;
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      if (end === -1) return;
      i = end + 3;
      continue;
    }
    const c = html[lt + 1];
    if (c === '!' || c === '?' || c === '/') {
      // A doctype, processing instruction or end tag: skip to its `>`.
      const gt = html.indexOf('>', lt + 1);
      if (gt === -1) return;
      i = gt + 1;
      continue;
    }
    if (!isNameStart(c)) {
      i = lt + 1;
      continue;
    }
    const read = readTag(html, lt + 1);
    if (read === null) return;
    yield read.tag;
    i = read.end;
    if (SKIPPED_CONTENT.has(read.tag.name)) {
      const end = closingTagEnd(html, lower, read.tag.name, i);
      if (end === -1) return;
      i = end;
    }
  }
}

/** Entry markers in document order. A marker lacking its id or its hash is ignored. */
export function parseEntryMarkers(html: string): Array<{ id: string; hash: string }> {
  const out: Array<{ id: string; hash: string }> = [];
  for (const { name, attrs } of tags(html)) {
    if (name !== 'span') continue;
    const id = attrs.get('data-cms-entry');
    const hash = attrs.get('data-cms-hash');
    if (id !== undefined && id !== '' && hash !== undefined && hash !== '') out.push({ id, hash });
  }
  return out;
}

/**
 * The entry ids of every entry marker in document order, whatever its hash: a marker with an id
 * and a missing, empty or other hash still shows the entry. `absent` checks use this, so they fail
 * closed on an incomplete marker (Task 18 security r1, 11b).
 */
export function parseEntryMarkerIds(html: string): string[] {
  const out: string[] = [];
  for (const { name, attrs } of tags(html)) {
    if (name !== 'span') continue;
    const id = attrs.get('data-cms-entry');
    if (id !== undefined && id !== '') out.push(id);
  }
  return out;
}

/** The release number, or null when absent, malformed, or when markers disagree. */
export function parseReleaseMarker(html: string): number | null {
  const found = new Set<number>();
  for (const { name, attrs } of tags(html)) {
    if (name !== 'meta' || attrs.get('name') !== 'cms-release') continue;
    const content = attrs.get('content') ?? '';
    if (!/^\d{1,15}$/.test(content)) return null;
    found.add(Number(content));
  }
  if (found.size !== 1) return null;
  return [...found][0] ?? null;
}
