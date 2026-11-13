// Pasted HTML, tidied before the rich-text parser reads it (spec §5.4: the parser keeps only the v1
// node set; enhancement A10, from the editor probe). The parser itself is not changed: this only
// rewrites what Word and web pages put on the clipboard into the shapes the v1 schema already has.
//
// - Word writes a list as paragraphs marked `mso-list`, each with its bullet or number typed in a
//   span; they become real bullet and numbered lists, nested by Word's level. Paragraphs that start
//   with a typed bullet (•, ·, ▪) become a bullet list too.
// - A level-1 heading becomes level 2 (v1 has levels 2 and 3; the parser made it a paragraph).
// - A table's cells become one paragraph each (the parser ran bare cell text together), and images
//   are taken out. Both are reported, so the editor is told in one line.
import { t } from '@/i18n/is';

/** What a paste lost: the v1 rich text has no images by paste and no tables. */
export type Dropped = { images: boolean; tables: boolean };

const BULLET = /^[\s ]*[•·▪◦‣⁃]+[\s ]+/;
const ORDERED_MARKER = /^\(?(\d{1,6}|[a-z]{1,5}|[A-Z]{1,5})[.)]$/;
const MSO_LIST = /mso-list:\s*[^;\s'"]+\s+level(\d{1,2})/i;
const MSO_IGNORE = /mso-list:\s*ignore/i;
/** Elements whose children are paragraphs, where a run of list paragraphs can be. */
const CONTAINERS = new Set(['BODY', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'BLOCKQUOTE']);

type Item = { level: number; ordered: boolean; start: number };

function rename(el: Element, tag: string): Element {
  const next = el.ownerDocument.createElement(tag);
  next.append(...el.childNodes);
  el.replaceWith(next);
  return next;
}

/** The first text node inside `el`, in document order. */
function firstText(el: Element): Text | null {
  const walker = el.ownerDocument.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
  return walker.nextNode() as Text | null;
}

/** A Word list paragraph's level and kind, with its typed marker removed; null for any other element. */
function listItemOf(el: Element): Item | null {
  if (el.tagName !== 'P') return null;
  const level = MSO_LIST.exec(el.getAttribute('style') ?? '');
  if (level || /\bMsoListParagraph/i.test(el.getAttribute('class') ?? '')) {
    const marker = [...el.querySelectorAll('span')].find((span) => MSO_IGNORE.test(span.getAttribute('style') ?? ''));
    const text = (marker?.textContent ?? '').replace(/[\s ]+/g, '');
    marker?.remove();
    const ordered = ORDERED_MARKER.test(text);
    const number = ordered ? /^\(?(\d+)/.exec(text) : null;
    if (!marker) stripBullet(el);
    return { level: level ? Math.max(1, Number(level[1])) : 1, ordered, start: number ? Number(number[1]) : 1 };
  }
  return stripBullet(el) ? { level: 1, ordered: false, start: 1 } : null;
}

/** Removes a typed bullet at the start of the paragraph's text; false when there is none. */
function stripBullet(el: Element): boolean {
  const text = firstText(el);
  if (!text || !BULLET.test(text.data)) return false;
  text.data = text.data.replace(BULLET, '');
  return true;
}

type Open = { level: number; ordered: boolean; list: Element };

/** Turns each run of list paragraphs among `container`'s children into a nested list. */
function listify(container: Element): void {
  const doc = container.ownerDocument;
  let open: Open[] = [];
  for (const child of [...container.childNodes]) {
    if (child.nodeType === 8 /* comment */ || (child.nodeType === 3 && (child.textContent ?? '').trim() === '')) continue;
    if (child.nodeType !== 1) {
      open = [];
      continue;
    }
    const el = child as Element;
    const item = listItemOf(el);
    if (!item) {
      open = [];
      if (CONTAINERS.has(el.tagName)) listify(el);
      continue;
    }
    while (open.length > 0 && open.at(-1)!.level > item.level) open.pop();
    if (open.length > 0 && open.at(-1)!.level === item.level && open.at(-1)!.ordered !== item.ordered) open.pop();
    let top = open.at(-1);
    if (!top || top.level < item.level) {
      const list = doc.createElement(item.ordered ? 'ol' : 'ul');
      if (item.ordered && item.start > 1) list.setAttribute('start', String(item.start));
      if (top) {
        const last = top.list.lastElementChild ?? top.list.appendChild(doc.createElement('li'));
        last.append(list);
      } else {
        el.before(list);
      }
      top = { level: item.level, ordered: item.ordered, list };
      open.push(top);
    }
    const li = doc.createElement('li');
    const p = doc.createElement('p');
    p.append(...el.childNodes);
    li.append(p);
    top.list.append(li);
    el.remove();
  }
}

/** Replaces a table with its cells, each its own block, in reading order. */
function flattenTable(table: Element): void {
  const doc = table.ownerDocument;
  const cells = [...table.querySelectorAll('td, th')].filter((cell) => cell.closest('table') === table);
  const blocks: Element[] = [];
  for (const cell of cells) {
    if ((cell.textContent ?? '').trim() === '') continue;
    const block = doc.createElement('div');
    block.append(...cell.childNodes);
    blocks.push(block);
  }
  table.replaceWith(...blocks);
}

/** Takes an image out, and the paragraph it leaves empty. */
function removeImage(img: Element): void {
  const parent = img.parentElement;
  img.remove();
  if (parent && parent.tagName === 'P' && (parent.textContent ?? '').trim() === '' && parent.querySelector('img, br') === null) parent.remove();
}

/** The pasted HTML in the shapes the v1 parser keeps, and what was left out. */
export function normalizePastedHtml(html: string): { html: string; dropped: Dropped } {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const body = doc.body;
  const images = [...body.querySelectorAll('img, picture, svg'), ...body.getElementsByTagName('v:imagedata')];
  const tables = [...body.querySelectorAll('table')];
  const dropped: Dropped = { images: images.length > 0, tables: tables.length > 0 };
  for (const image of body.querySelectorAll('img, picture, svg')) if (image.isConnected) removeImage(image);
  for (const table of tables) flattenTable(table);
  for (const h1 of [...body.querySelectorAll('h1')]) rename(h1, 'h2');
  listify(body);
  return { html: body.innerHTML, dropped };
}

/** The one line that tells the editor what a paste left out, or null. */
export function droppedNotice(dropped: Dropped): string | null {
  const r = t.editor.richText;
  if (dropped.images && dropped.tables) return r.droppedBoth;
  if (dropped.images) return r.droppedImages;
  if (dropped.tables) return r.droppedTables;
  return null;
}
