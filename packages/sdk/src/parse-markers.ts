/** Parsers for the markers in markers.tsx; shared by the worker's live check and the sites' tests. */

const TAG = /<(span|meta)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi;
const ATTR = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

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

function* tags(html: string, name: 'span' | 'meta'): Generator<Map<string, string>> {
  for (const m of html.matchAll(TAG)) {
    if ((m[1] ?? '').toLowerCase() !== name) continue;
    const attrs = new Map<string, string>();
    for (const a of (m[2] ?? '').matchAll(ATTR)) {
      const key = (a[1] ?? '').toLowerCase();
      if (!attrs.has(key)) attrs.set(key, decode(a[2] ?? a[3] ?? a[4] ?? ''));
    }
    yield attrs;
  }
}

/** Entry markers in document order. A marker lacking its id or its hash is ignored. */
export function parseEntryMarkers(html: string): Array<{ id: string; hash: string }> {
  const out: Array<{ id: string; hash: string }> = [];
  for (const attrs of tags(html, 'span')) {
    const id = attrs.get('data-cms-entry');
    const hash = attrs.get('data-cms-hash');
    if (id !== undefined && id !== '' && hash !== undefined && hash !== '') out.push({ id, hash });
  }
  return out;
}

/** The release number, or null when absent, malformed, or when markers disagree. */
export function parseReleaseMarker(html: string): number | null {
  const found = new Set<number>();
  for (const attrs of tags(html, 'meta')) {
    if (attrs.get('name') !== 'cms-release') continue;
    const content = attrs.get('content') ?? '';
    if (!/^\d{1,15}$/.test(content)) return null;
    found.add(Number(content));
  }
  if (found.size !== 1) return null;
  return [...found][0] ?? null;
}
