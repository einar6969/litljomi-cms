import { describe, expect, it } from 'vitest';
import { buttonClasses, linkButtonClasses } from '../Button';

describe('buttonClasses', () => {
  it('names the kit class of each variant, and no class twice', () => {
    expect(buttonClasses('primary')).toBe('btn btn-go');
    expect(buttonClasses('ink')).toBe('btn btn-ink');
    expect(buttonClasses('secondary')).toBe('btn btn-line');
    expect(buttonClasses('danger')).toBe('btn btn-off');
    expect(buttonClasses('quiet', 'sm')).toBe('btn btn-quiet btn-sm');
  });

  it('a link styled as a button uses the same classes, from one helper', () => {
    for (const variant of ['primary', 'ink', 'secondary', 'quiet', 'danger'] as const) {
      expect(linkButtonClasses(variant)).toBe(buttonClasses(variant));
    }
  });
});
