import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StatusBadge, type BadgeTone } from '../StatusBadge';

const render = (tone: BadgeTone) => renderToStaticMarkup(<StatusBadge tone={tone}>Staða</StatusBadge>);
const classesOf = (html: string, index: number) => [...html.matchAll(/class="([^"]*)"/g)][index]![1]!.split(' ');
const pill = (tone: BadgeTone) => classesOf(render(tone), 0);
const dot = (tone: BadgeTone) => classesOf(render(tone), 1);

describe('StatusBadge tones', () => {
  it('pending pulses; no final tone does', () => {
    expect(dot('pending')).toContain('motion-safe:animate-pulse');
    for (const tone of ['ok', 'neutral', 'warning', 'error'] as const) {
      expect(render(tone), tone).not.toContain('animate-pulse');
    }
  });

  it('neutral ("Tekið af vef") looks like pending without the pulsing dot', () => {
    expect(pill('neutral')).toEqual(pill('pending'));
    expect(dot('neutral')).toEqual(dot('pending').filter((c) => c !== 'motion-safe:animate-pulse'));
  });

  it('warning ("Enginn vefur tengdur") is the warning colour with canvas (white) text and dot', () => {
    expect(pill('warning')).toEqual(expect.arrayContaining(['bg-warning', 'text-canvas']));
    expect(dot('warning')).toContain('bg-canvas');
  });

  it('the text is the status; the dot is hidden from assistive technology', () => {
    const html = render('warning');
    expect(html).toContain('<span>Staða</span>');
    expect(html).toContain('aria-hidden="true"');
  });
});
