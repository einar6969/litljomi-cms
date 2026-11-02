import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Decision 42.2 (Q7): the CMS's favicon, served by the app router from src/app/icon.svg. The design
// tokens' accent rule: accent only as a fill, ink on accent.
const svg = readFileSync(new URL('../icon.svg', import.meta.url), 'utf8');

describe('the CMS icon', () => {
  it('is a self-contained SVG: an accent square with an ink mark, in the design tokens only', () => {
    expect(svg.trimStart().startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect([...svg.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) => m[0].toLowerCase()).sort()).toEqual(['#171714', '#8ed462']);
    expect(svg).toMatch(/<rect [^>]*fill="#8ed462"/);
    expect(svg).toMatch(/<path [^>]*fill="#171714"/);
    expect(svg).not.toMatch(/stroke=|<text|<image|<script|href=|url\(|@import/i);
  });
});
