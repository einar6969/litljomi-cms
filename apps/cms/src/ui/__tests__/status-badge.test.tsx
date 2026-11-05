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

  it('warning ("Enginn vefur tengdur") and error carry their own tone; ok is the accent', () => {
    expect(pill('warning')).toContain('pill-warning');
    expect(pill('error')).toContain('pill-error');
    expect(pill('ok')).toContain('pill-ok');
  });

  it('the publish panel\'s look is the same tones at full width', () => {
    const html = renderToStaticMarkup(
      <StatusBadge tone="ok" look="state">
        Birt
      </StatusBadge>,
    );
    expect(classesOf(html, 0)).toEqual(['state', 'state-ok']);
  });

  it('the text is the status; the dot is hidden from assistive technology', () => {
    const html = render('warning');
    expect(html).toContain('<span>Staða</span>');
    expect(html).toContain('aria-hidden="true"');
  });
});
