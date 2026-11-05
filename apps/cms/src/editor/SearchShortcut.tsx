'use client';

import { useEffect } from 'react';

/** `/` jumps to the search box, unless the person is already typing; Esc leaves it again. */
export function SearchShortcut({ inputId }: { inputId: string }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const input = document.getElementById(inputId);
      if (!(input instanceof HTMLInputElement)) return;
      if (event.key === 'Escape' && document.activeElement === input) {
        input.blur();
        return;
      }
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      event.preventDefault();
      input.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inputId]);
  return null;
}
