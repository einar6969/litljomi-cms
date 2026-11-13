import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: unknown }) => <a href={href}>{children as string}</a> }));

const { TopBar, SAVE_SLOT_ID } = await import('../TopBar');

const CSS = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8');

/** The body of the first `selector { … }` rule inside the stylesheet's `@media (min-width: 1024px)` blocks. */
function desktopRule(selector: string): string | undefined {
  for (const block of CSS.split('@media (min-width: 1024px) {').slice(1)) {
    const match = new RegExp(`\\n\\s*${selector.replace('.', '\\.')} \\{([^}]*)\\}`).exec(block);
    if (match) return match[1];
  }
  return undefined;
}

// A10 (probe: "save status and Birta scroll out of view" at 1440): on an entry page the bar with
// the save status and the publish rail stay in view from 1024 px.
describe('the entry page keeps its save status and publish panel in view on a desktop', () => {
  it('marks the bar of a page with a save status', () => {
    const html = renderToStaticMarkup(<TopBar title="T" saves />);
    expect(html).toContain('class="top top-saves"');
    expect(html).toContain(`id="${SAVE_SLOT_ID}"`);
    expect(renderToStaticMarkup(<TopBar title="T" />)).toContain('class="top"');
  });

  it('makes that bar and the rail sticky from 1024 px', () => {
    expect(desktopRule('.top-saves')).toMatch(/position:\s*sticky/);
    expect(desktopRule('.top-saves')).toMatch(/top:\s*0/);
    expect(desktopRule('.rail')).toMatch(/position:\s*sticky/);
    expect(desktopRule('.rail')).toMatch(/overflow-y:\s*auto/);
  });
});
