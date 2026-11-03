import { describe, expect, it } from 'vitest';
import { buttonClasses, linkButtonClasses } from '../Button';

describe('linkButtonClasses', () => {
  // Task 31 spec-quality r3: a link styled as a button gets the button's classes plus the
  // underline reset, from one helper, instead of repeating classes at the call site.
  it('is the button look with the link underline removed, and no class twice', () => {
    for (const variant of ['primary', 'secondary', 'danger'] as const) {
      const classes = linkButtonClasses(variant).split(' ');
      expect(classes).toEqual([...buttonClasses(variant).split(' '), 'no-underline']);
      expect(new Set(classes).size).toBe(classes.length);
    }
  });
});
